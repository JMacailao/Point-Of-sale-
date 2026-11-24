import { ok } from '../utils/http.js';
import { parseRange } from '../utils/dates.js';

async function summaryFor(req) {
  const { from, to } = parseRange(req.query, req.auth.store.timezone, { maxDays: 366 });
  const data = await req.db(async (c) => (await c.query('select public.dashboard_summary($1, $2, $3) as data',
    [req.storeId, from, to])).rows[0].data);
  return { ...data, range: { from, to }, scope: req.auth.permissions.includes('sales.view_all') ? 'store' : 'own' };
}

export async function summary(req, res) {
  ok(res, await summaryFor(req));
}

export async function sales(req, res) {
  const data = await summaryFor(req);
  ok(res, { range: data.range, series: data.series, scope: data.scope });
}
