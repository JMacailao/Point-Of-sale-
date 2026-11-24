import { ok } from '../utils/http.js';
import { sendCsv } from '../utils/csv.js';
import { parseRange } from '../utils/dates.js';
import { badRequest } from '../utils/errors.js';

const GROUPS = new Set(['day', 'week', 'month', 'year']);

async function salesReport(req) {
  const group = req.query.group || 'day';
  if (!GROUPS.has(group)) throw badRequest('Invalid grouping');
  const { from, to } = parseRange(req.query, req.auth.store.timezone, { maxDays: 3660, defaultDays: 29 });
  const data = await req.db(async (c) => (await c.query('select public.sales_report($1, $2, $3, $4) as data',
    [req.storeId, from, to, group])).rows[0].data);
  return { ...data, range: { from, to } };
}

export async function sales(req, res) {
  ok(res, await salesReport(req));
}

export async function salesExport(req, res) {
  const data = await salesReport(req);
  const money = (k) => (r) => Number(r[k]).toFixed(2);
  sendCsv(res, `sales-report-${data.range.from}-to-${data.range.to}.csv`, [
    { label: `Period (${data.group})`, value: 'period' },
    { label: 'Transactions', value: 'transactions' },
    { label: 'Gross Sales', value: money('gross_sales') },
    { label: 'Discounts', value: money('discounts') },
    { label: 'Refunds', value: money('refunds') },
    { label: 'Net Sales', value: money('net_sales') },
    { label: 'Tax', value: money('tax') },
    { label: 'Revenue (ex. tax)', value: money('revenue_ex_tax') },
    { label: 'Cost of Goods', value: money('cost_of_goods') },
    { label: 'Gross Profit', value: money('gross_profit') },
    { label: 'Expenses', value: money('expenses') },
    { label: 'Net Profit', value: money('net_profit') },
  ], [...data.rows, { period: 'TOTAL', ...data.totals }]);
}

export async function inventory(req, res) {
  const { from, to } = parseRange(req.query, req.auth.store.timezone, { maxDays: 3660, defaultDays: 29 });
  const tz = req.auth.store.timezone;
  const data = await req.db(async (c) => {
    const valuation = (await c.query(
      `select coalesce(c.name, 'Uncategorized') as category, count(*) as products,
              sum(p.stock_quantity) as units, sum(p.stock_quantity * p.cost_price) as value_cost,
              sum(p.stock_quantity * p.selling_price) as value_retail
         from public.products p left join public.categories c on c.id = p.category_id
        where p.store_id = $1 and p.is_active
        group by 1 order by 4 desc nulls last`, [req.storeId])).rows;
    const lowStock = (await c.query(
      `select p.id, p.name, p.sku, p.stock_quantity, p.minimum_stock
         from public.products p
        where p.store_id = $1 and p.is_active and p.stock_quantity <= p.minimum_stock
        order by p.stock_quantity, p.name limit 100`, [req.storeId])).rows;
    const movements = (await c.query(
      `select movement_type, count(*) as count, sum(quantity_changed) as net_quantity
         from public.stock_movements
        where store_id = $1 and created_at >= ($2::date)::timestamp at time zone $4
          and created_at < ($3::date + 1)::timestamp at time zone $4
        group by 1 order by 1`, [req.storeId, from, to, tz])).rows;
    return { valuation, lowStock, movements };
  });
  ok(res, { ...data, range: { from, to } });
}
