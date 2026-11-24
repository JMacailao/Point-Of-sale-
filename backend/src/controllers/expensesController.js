import { ok, created, pageMeta, pagination, likePattern } from '../utils/http.js';
import { sendCsv } from '../utils/csv.js';
import { badRequest, notFound, conflict } from '../utils/errors.js';
import { hasPermission } from '../middleware/authorize.js';
import { EXPENSE_CATEGORIES } from '../validators/schemas.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const SELECT = `
  select e.id, e.description, e.category, e.amount, e.expense_date, e.payment_method, e.reference_number,
         e.notes, e.recorded_by, coalesce(p.full_name, p.email) as recorded_by_name, e.is_voided, e.voided_at,
         e.void_reason, coalesce(v.full_name, v.email) as voided_by_name, e.created_at, e.updated_at
    from public.expenses e
    left join public.profiles p on p.id = e.recorded_by
    left join public.profiles v on v.id = e.voided_by`;

function buildFilters(req) {
  const params = [req.storeId];
  const where = ['e.store_id = $1'];
  const q = req.query;
  if (q.include_voided !== 'true') where.push('not e.is_voided');
  const search = String(q.search || '').trim();
  if (search) {
    params.push(likePattern(search.slice(0, 100)));
    where.push(`(e.description ilike $${params.length} or e.reference_number ilike $${params.length})`);
  }
  if (q.category) {
    if (!EXPENSE_CATEGORIES.includes(q.category)) throw badRequest('Invalid category');
    params.push(q.category);
    where.push(`e.category = $${params.length}`);
  }
  if (q.from) {
    if (!DATE_RE.test(q.from)) throw badRequest('Invalid start date');
    params.push(q.from);
    where.push(`e.expense_date >= $${params.length}::date`);
  }
  if (q.to) {
    if (!DATE_RE.test(q.to)) throw badRequest('Invalid end date');
    params.push(q.to);
    where.push(`e.expense_date <= $${params.length}::date`);
  }
  return { params, where };
}

export async function list(req, res) {
  const pg = pagination(req.query);
  const { params, where } = buildFilters(req);
  const { rows, total_amount } = await req.db(async (c) => {
    const totals = (await c.query(
      `select coalesce(sum(e.amount) filter (where not e.is_voided), 0) as total_amount
         from public.expenses e where ${where.join(' and ')}`, params)).rows[0];
    const listParams = [...params, pg.pageSize, pg.offset];
    const rows = (await c.query(
      `${SELECT.replace('select e.id', 'select count(*) over() as total_count, e.id')}
        where ${where.join(' and ')}
        order by e.expense_date desc, e.created_at desc, e.id
        limit $${listParams.length - 1} offset $${listParams.length}`, listParams)).rows;
    return { rows, total_amount: totals.total_amount };
  });
  const total = rows[0]?.total_count ?? 0;
  ok(res, rows.map(({ total_count: _t, ...r }) => r), { ...pageMeta(pg, total), totalAmount: total_amount });
}

export async function exportCsv(req, res) {
  const { params, where } = buildFilters(req);
  const rows = await req.db(async (c) => (await c.query(
    `${SELECT} where ${where.join(' and ')} order by e.expense_date desc, e.created_at desc limit 20000`, params)).rows);
  sendCsv(res, `expenses-${new Date().toISOString().slice(0, 10)}.csv`, [
    { label: 'Date', value: 'expense_date' },
    { label: 'Description', value: 'description' },
    { label: 'Category', value: 'category' },
    { label: 'Amount', value: (r) => r.amount.toFixed(2) },
    { label: 'Payment Method', value: 'payment_method' },
    { label: 'Reference Number', value: 'reference_number' },
    { label: 'Recorded By', value: 'recorded_by_name' },
    { label: 'Status', value: (r) => (r.is_voided ? 'voided' : 'active') },
    { label: 'Void Reason', value: 'void_reason' },
    { label: 'Notes', value: 'notes' },
  ], rows);
}

export async function getOne(req, res) {
  if (!UUID_RE.test(req.params.id)) throw notFound('Expense not found');
  const result = await req.db(async (c) => {
    const expense = (await c.query(`${SELECT} where e.id = $1 and e.store_id = $2`, [req.params.id, req.storeId])).rows[0];
    if (!expense) return null;
    let history = [];
    if (hasPermission(req, 'audit.view')) {
      history = (await c.query(
        `select a.id, a.action, a.old_values, a.new_values, a.created_at, coalesce(p.full_name, p.email) as user_name
           from public.audit_logs a left join public.profiles p on p.id = a.user_id
          where a.module = 'expenses' and a.record_id = $1 and a.store_id = $2
          order by a.created_at, a.id`, [req.params.id, req.storeId])).rows;
    }
    return { ...expense, history };
  });
  if (!result) throw notFound('Expense not found');
  ok(res, result);
}

export async function create(req, res) {
  const b = req.body;
  const row = await req.db(async (c) => {
    const { rows } = await c.query(
      `insert into public.expenses (store_id, description, category, amount, expense_date, payment_method,
                                    reference_number, notes, recorded_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, app.current_profile_id()) returning id`,
      [req.storeId, b.description, b.category, b.amount, b.expense_date, b.payment_method,
        b.reference_number ?? null, b.notes ?? null]);
    return (await c.query(`${SELECT} where e.id = $1`, [rows[0].id])).rows[0];
  });
  created(res, row);
}

export async function update(req, res) {
  if (!UUID_RE.test(req.params.id)) throw notFound('Expense not found');
  const b = req.body;
  const row = await req.db(async (c) => {
    const existing = (await c.query('select is_voided from public.expenses where id = $1 and store_id = $2',
      [req.params.id, req.storeId])).rows[0];
    if (!existing) throw notFound('Expense not found');
    if (existing.is_voided) throw conflict('A voided expense cannot be edited');
    await c.query(
      `update public.expenses set description = $1, category = $2, amount = $3, expense_date = $4,
              payment_method = $5, reference_number = $6, notes = $7
        where id = $8 and store_id = $9`,
      [b.description, b.category, b.amount, b.expense_date, b.payment_method, b.reference_number ?? null,
        b.notes ?? null, req.params.id, req.storeId]);
    return (await c.query(`${SELECT} where e.id = $1`, [req.params.id])).rows[0];
  });
  ok(res, row);
}

/** Expenses are financial records: "delete" voids the record and keeps it in the audit trail. */
export async function voidExpense(req, res) {
  if (!UUID_RE.test(req.params.id)) throw notFound('Expense not found');
  const row = await req.db(async (c) => {
    const result = await c.query(
      `update public.expenses
          set is_voided = true, voided_at = now(), voided_by = app.current_profile_id(), void_reason = $1
        where id = $2 and store_id = $3 and not is_voided`, [req.body.reason, req.params.id, req.storeId]);
    if (result.rowCount === 0) throw notFound('Expense not found or already voided');
    return (await c.query(`${SELECT} where e.id = $1`, [req.params.id])).rows[0];
  });
  ok(res, row);
}
