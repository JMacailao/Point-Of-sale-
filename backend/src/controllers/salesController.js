import { hasPermission } from '../middleware/authorize.js';
import { ok, created, pageMeta, pagination, likePattern } from '../utils/http.js';
import { sendCsv } from '../utils/csv.js';
import { badRequest, notFound } from '../utils/errors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const METHODS = new Set(['cash', 'gcash', 'maya', 'other']);
const STATUSES = new Set(['completed', 'refunded']);

/** Builds WHERE clauses for sales filters. RLS additionally limits cashiers to their own sales. */
function buildFilters(req) {
  const params = [req.storeId, req.auth.store.timezone];
  const where = ['s.store_id = $1', '$2::text is not null'];
  const q = req.query;
  const search = String(q.search || '').trim();
  if (search) {
    params.push(likePattern(search.slice(0, 64)));
    where.push(`s.transaction_number ilike $${params.length}`);
  }
  if (q.from) {
    if (!DATE_RE.test(q.from)) throw badRequest('Invalid start date');
    params.push(q.from);
    where.push(`s.created_at >= ($${params.length}::date)::timestamp at time zone $2`);
  }
  if (q.to) {
    if (!DATE_RE.test(q.to)) throw badRequest('Invalid end date');
    params.push(q.to);
    where.push(`s.created_at < ($${params.length}::date + 1)::timestamp at time zone $2`);
  }
  if (q.cashier_id) {
    if (!UUID_RE.test(q.cashier_id)) throw badRequest('Invalid cashier');
    params.push(q.cashier_id);
    where.push(`s.cashier_id = $${params.length}`);
  }
  if (q.payment_method) {
    if (!METHODS.has(q.payment_method)) throw badRequest('Invalid payment method');
    params.push(q.payment_method);
    where.push(`s.payment_method = $${params.length}`);
  }
  if (q.status) {
    if (!STATUSES.has(q.status)) throw badRequest('Invalid status');
    params.push(q.status);
    where.push(`s.status = $${params.length}`);
  }
  return { params, where };
}

const SALE_LIST_SELECT = `
  select s.id, s.transaction_number, s.created_at, s.cashier_id,
         coalesce(p.full_name, p.email) as cashier_name, s.subtotal, s.discount, s.tax_amount,
         s.total_amount, s.payment_method, s.amount_received, s.change_amount, s.status,
         (select count(*) from public.sale_items si where si.sale_id = s.id) as item_count,
         (select pm.reference_number from public.payments pm where pm.sale_id = s.id and pm.kind = 'payment' limit 1) as reference_number
    from public.sales s
    left join public.profiles p on p.id = s.cashier_id`;

export async function list(req, res) {
  const pg = pagination(req.query);
  const { params, where } = buildFilters(req);
  const { rows, totals } = await req.db(async (c) => {
    const totals = (await c.query(
      `select count(*) filter (where s.status = 'completed') as completed_count,
              coalesce(sum(s.total_amount) filter (where s.status = 'completed'), 0) as completed_total,
              coalesce(sum(s.total_amount) filter (where s.status = 'refunded'), 0) as refunded_total
         from public.sales s where ${where.join(' and ')}`, params)).rows[0];
    const listParams = [...params, pg.pageSize, pg.offset];
    const rows = (await c.query(
      `${SALE_LIST_SELECT.replace('select s.id', 'select count(*) over() as total_count, s.id')}
        where ${where.join(' and ')}
        order by s.created_at desc, s.id
        limit $${listParams.length - 1} offset $${listParams.length}`, listParams)).rows;
    return { rows, totals };
  });
  const total = rows[0]?.total_count ?? 0;
  ok(res, rows.map(({ total_count: _t, ...r }) => r), { ...pageMeta(pg, total), totals });
}

export async function exportCsv(req, res) {
  const { params, where } = buildFilters(req);
  const rows = await req.db(async (c) => (await c.query(
    `${SALE_LIST_SELECT} where ${where.join(' and ')} order by s.created_at desc limit 20000`, params)).rows);
  const tz = req.auth.store.timezone;
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  sendCsv(res, `sales-${new Date().toISOString().slice(0, 10)}.csv`, [
    { label: 'Transaction Number', value: 'transaction_number' },
    { label: `Date/Time (${tz})`, value: (r) => fmt.format(r.created_at).replace(',', '') },
    { label: 'Cashier', value: 'cashier_name' },
    { label: 'Items', value: 'item_count' },
    { label: 'Subtotal', value: (r) => r.subtotal.toFixed(2) },
    { label: 'Discount', value: (r) => r.discount.toFixed(2) },
    { label: 'Tax', value: (r) => r.tax_amount.toFixed(2) },
    { label: 'Total', value: (r) => r.total_amount.toFixed(2) },
    { label: 'Payment Method', value: 'payment_method' },
    { label: 'Reference Number', value: 'reference_number' },
    { label: 'Amount Received', value: (r) => r.amount_received.toFixed(2) },
    { label: 'Change', value: (r) => r.change_amount.toFixed(2) },
    { label: 'Status', value: 'status' },
  ], rows);
}

export async function fetchSaleDetail(client, storeId, saleId) {
  const sale = (await client.query(
    `select s.*, coalesce(p.full_name, p.email) as cashier_name,
            coalesce(r.full_name, r.email) as refunded_by_name
       from public.sales s
       left join public.profiles p on p.id = s.cashier_id
       left join public.profiles r on r.id = s.refunded_by
      where s.id = $1 and s.store_id = $2`, [saleId, storeId])).rows[0];
  if (!sale) return null;
  const items = (await client.query(
    `select id, product_id, product_name, sku, quantity, unit_price, cost_price, subtotal
       from public.sale_items where sale_id = $1 order by product_name, id`, [saleId])).rows;
  const payments = (await client.query(
    `select id, kind, payment_method, amount, reference_number, created_at
       from public.payments where sale_id = $1 order by created_at, id`, [saleId])).rows;
  const { client_request_id: _r, ...rest } = sale;
  return { ...rest, items, payments };
}

function present(req, sale) {
  if (!sale) return sale;
  if (hasPermission(req, 'reports.view')) return sale;
  return { ...sale, items: sale.items.map(({ cost_price: _c, ...i }) => i) };
}

/**
 * Processes a sale atomically through public.process_sale(): prices come from
 * the database, stock is locked and deducted, and sale, items, payment and
 * stock movements are written in a single transaction. client_request_id makes
 * retries idempotent.
 */
export async function create(req, res) {
  const b = req.body;
  const { result, sale } = await req.db(async (c) => {
    const result = (await c.query(
      'select public.process_sale($1, $2, $3, $4, $5, $6, $7, $8) as result',
      [req.storeId, b.client_request_id, JSON.stringify(b.items), b.discount_type, b.discount_value,
        b.payment_method, b.amount_received ?? null, b.reference_number ?? null])).rows[0].result;
    const sale = await fetchSaleDetail(c, req.storeId, result.sale_id);
    return { result, sale };
  });
  if (result.duplicate) return ok(res, { ...present(req, sale), duplicate: true });
  created(res, present(req, sale));
}

export async function getOne(req, res) {
  if (!UUID_RE.test(req.params.id)) throw notFound('Sale not found');
  const sale = await req.db((c) => fetchSaleDetail(c, req.storeId, req.params.id));
  if (!sale) throw notFound('Sale not found');
  ok(res, present(req, sale));
}

export async function refund(req, res) {
  if (!UUID_RE.test(req.params.id)) throw notFound('Sale not found');
  const sale = await req.db(async (c) => {
    await c.query('select public.refund_sale($1, $2, $3)', [req.storeId, req.params.id, req.body.reason]);
    return fetchSaleDetail(c, req.storeId, req.params.id);
  });
  ok(res, present(req, sale));
}

/** Cashier list for filters (only for users who can see all sales). */
export async function cashiers(req, res) {
  const rows = await req.db(async (c) => (await c.query(
    `select p.id, coalesce(p.full_name, p.email) as name
       from public.store_members sm join public.profiles p on p.id = sm.profile_id
      where sm.store_id = $1 order by 2`, [req.storeId])).rows);
  ok(res, rows);
}
