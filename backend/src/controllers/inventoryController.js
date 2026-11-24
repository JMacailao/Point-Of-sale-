import { ok, pageMeta, pagination, likePattern } from '../utils/http.js';
import { badRequest } from '../utils/errors.js';

export async function list(req, res) {
  const pg = pagination(req.query);
  const params = [req.storeId];
  const where = ['p.store_id = $1', 'p.is_active'];
  const search = String(req.query.search || '').trim();
  if (search) {
    params.push(likePattern(search.slice(0, 100)));
    where.push(`(p.name ilike $${params.length} or p.sku ilike $${params.length} or p.barcode ilike $${params.length})`);
  }
  const filter = req.query.filter;
  if (filter === 'low') where.push('p.stock_quantity <= p.minimum_stock');
  if (filter === 'out') where.push('p.stock_quantity = 0');

  const { items, summary } = await req.db(async (c) => {
    const listParams = [...params, pg.pageSize, pg.offset];
    const items = (await c.query(
      `select count(*) over() as total_count, p.id, p.name, p.sku, p.barcode, p.image_url, p.stock_quantity,
              p.minimum_stock, p.cost_price, p.selling_price, c.name as category_name,
              (p.stock_quantity * p.cost_price) as stock_value,
              (p.stock_quantity <= p.minimum_stock) as is_low_stock,
              (select max(m.created_at) from public.stock_movements m where m.product_id = p.id) as last_movement_at
         from public.products p
         left join public.categories c on c.id = p.category_id
        where ${where.join(' and ')}
        order by (p.stock_quantity <= p.minimum_stock) desc, p.name, p.id
        limit $${listParams.length - 1} offset $${listParams.length}`, listParams)).rows;
    const summary = (await c.query(
      `select count(*) as product_count,
              coalesce(sum(stock_quantity), 0) as total_units,
              coalesce(sum(stock_quantity * cost_price), 0) as stock_value_cost,
              coalesce(sum(stock_quantity * selling_price), 0) as stock_value_retail,
              count(*) filter (where stock_quantity <= minimum_stock) as low_stock_count,
              count(*) filter (where stock_quantity = 0) as out_of_stock_count
         from public.products where store_id = $1 and is_active`, [req.storeId])).rows[0];
    return { items, summary };
  });

  const total = items[0]?.total_count ?? 0;
  ok(res, items.map(({ total_count: _t, ...r }) => r), { ...pageMeta(pg, total), summary });
}

function stockHandler(type) {
  return async (req, res) => {
    const b = req.body;
    const quantity = type === 'adjustment' ? b.counted_quantity : b.quantity;
    if (type === 'stock_out' && !b.reason) throw badRequest('A reason is required for stock out');
    const movement = await req.db(async (c) => (await c.query(
      'select public.adjust_stock($1, $2, $3, $4, $5) as movement',
      [req.storeId, b.product_id, type, quantity, b.reason ?? null])).rows[0].movement);
    ok(res, movement);
  };
}

export const stockIn = stockHandler('stock_in');
export const stockOut = stockHandler('stock_out');
export const adjustment = stockHandler('adjustment');

const MOVEMENT_TYPES = new Set(['stock_in', 'stock_out', 'sale', 'return', 'adjustment']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function movements(req, res) {
  const pg = pagination(req.query);
  const params = [req.storeId, req.auth.store.timezone];
  const where = ['m.store_id = $1'];
  const { product_id: productId, type, from, to } = req.query;
  if (productId) {
    if (!UUID_RE.test(productId)) throw badRequest('Invalid product');
    params.push(productId);
    where.push(`m.product_id = $${params.length}`);
  }
  if (type) {
    if (!MOVEMENT_TYPES.has(type)) throw badRequest('Invalid movement type');
    params.push(type);
    where.push(`m.movement_type = $${params.length}`);
  }
  if (from) {
    if (!DATE_RE.test(from)) throw badRequest('Invalid start date');
    params.push(from);
    where.push(`m.created_at >= ($${params.length}::date)::timestamp at time zone $2`);
  }
  if (to) {
    if (!DATE_RE.test(to)) throw badRequest('Invalid end date');
    params.push(to);
    where.push(`m.created_at < ($${params.length}::date + 1)::timestamp at time zone $2`);
  }
  const search = String(req.query.search || '').trim();
  if (search) {
    params.push(likePattern(search.slice(0, 100)));
    where.push(`(p.name ilike $${params.length} or p.sku ilike $${params.length})`);
  }
  params.push(pg.pageSize, pg.offset);

  const rows = await req.db(async (c) => (await c.query(
    `select count(*) over() as total_count, m.id, m.product_id, p.name as product_name, p.sku,
            m.movement_type, m.previous_quantity, m.quantity_changed, m.new_quantity, m.reason,
            m.reference_id, m.created_at, coalesce(u.full_name, u.email) as performed_by_name
       from public.stock_movements m
       join public.products p on p.id = m.product_id
       left join public.profiles u on u.id = m.performed_by
      where ${where.join(' and ')} and $2::text is not null
      order by m.created_at desc, m.id
      limit $${params.length - 1} offset $${params.length}`, params)).rows);

  const total = rows[0]?.total_count ?? 0;
  ok(res, rows.map(({ total_count: _t, ...r }) => r), pageMeta(pg, total));
}
