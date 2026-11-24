import { ok, pageMeta, pagination } from '../utils/http.js';
import { uploadImage, removeImageByUrl, BUCKETS } from '../services/storage.js';
import { loadAuthContext } from '../services/authContext.js';
import { notFound, badRequest } from '../utils/errors.js';

const STORE_FIELDS = ['store_name', 'store_address', 'contact_number', 'business_email', 'business_type',
  'currency', 'timezone', 'date_format', 'receipt_footer', 'receipt_paper', 'tax_enabled', 'tax_name', 'tax_rate',
  'tax_inclusive', 'allow_cashier_discount', 'max_discount_percent', 'default_low_stock_threshold',
  'low_stock_alerts'];

export async function getStore(req, res) {
  ok(res, req.auth.store);
}

export async function updateStore(req, res) {
  const b = req.body;
  const logo = await uploadImage(BUCKETS.storeAssets, req.storeId, req.file);
  const previousLogo = req.auth.store.logo_url;
  try {
    const sets = [];
    const params = [];
    for (const key of STORE_FIELDS) {
      if (b[key] !== undefined) {
        params.push(b[key]);
        sets.push(`${key} = $${params.length}`);
      }
    }
    if (logo) {
      params.push(logo.url);
      sets.push(`logo_url = $${params.length}`);
    } else if (b.remove_logo) {
      sets.push('logo_url = null');
    }
    if (!sets.length) throw badRequest('Nothing to update');
    params.push(req.storeId);
    await req.db(async (c) => {
      const result = await c.query(`update public.stores set ${sets.join(', ')} where id = $${params.length}`, params);
      if (result.rowCount === 0) throw notFound('Store not found');
    });
  } catch (err) {
    if (logo) await removeImageByUrl(BUCKETS.storeAssets, logo.url);
    throw err;
  }
  if ((logo || b.remove_logo) && previousLogo) await removeImageByUrl(BUCKETS.storeAssets, previousLogo);
  const ctx = await loadAuthContext(req.firebaseUser.uid, req.storeId);
  ok(res, ctx.store);
}

export async function auditLogs(req, res) {
  const pg = pagination(req.query);
  const params = [req.storeId];
  const where = ['a.store_id = $1'];
  if (req.query.module) {
    params.push(String(req.query.module).slice(0, 40));
    where.push(`a.module = $${params.length}`);
  }
  params.push(pg.pageSize, pg.offset);
  const rows = await req.db(async (c) => (await c.query(
    `select count(*) over() as total_count, a.id, a.action, a.module, a.record_id, a.old_values, a.new_values,
            a.created_at, coalesce(p.full_name, p.email) as user_name
       from public.audit_logs a left join public.profiles p on p.id = a.user_id
      where ${where.join(' and ')}
      order by a.created_at desc, a.id
      limit $${params.length - 1} offset $${params.length}`, params)).rows);
  const total = rows[0]?.total_count ?? 0;
  ok(res, rows.map(({ total_count: _t, ...r }) => r), pageMeta(pg, total));
}
