import { hasPermission } from '../middleware/authorize.js';
import { uploadImage, removeImageByUrl, BUCKETS } from '../services/storage.js';
import { ok, created, pageMeta, likePattern } from '../utils/http.js';
import { notFound, badRequest } from '../utils/errors.js';

const SORT_COLUMNS = {
  name: 'p.name', selling_price: 'p.selling_price', stock_quantity: 'p.stock_quantity',
  created_at: 'p.created_at', sku: 'p.sku',
};

const PRODUCT_SELECT = `
  select p.id, p.store_id, p.category_id, c.name as category_name, p.name, p.sku, p.barcode,
         p.description, p.image_url, p.cost_price, p.selling_price, p.stock_quantity,
         p.minimum_stock, p.is_active, p.created_at, p.updated_at,
         (p.stock_quantity <= p.minimum_stock) as is_low_stock
    from public.products p
    left join public.categories c on c.id = p.category_id`;

/** Cost prices are only visible to users who manage products. */
function present(req, product) {
  if (!product) return product;
  if (hasPermission(req, 'products.manage') || hasPermission(req, 'inventory.manage')) return product;
  const { cost_price: _c, ...rest } = product;
  return rest;
}

async function fetchProduct(client, storeId, id) {
  const { rows } = await client.query(`${PRODUCT_SELECT} where p.id = $1 and p.store_id = $2`, [id, storeId]);
  return rows[0] || null;
}

export async function list(req, res) {
  const q = req.validQuery;
  const params = [req.storeId];
  const where = ['p.store_id = $1'];
  if (q.status === 'active') where.push('p.is_active');
  if (q.status === 'archived') where.push('not p.is_active');
  if (q.search) {
    params.push(likePattern(q.search));
    where.push(`(p.name ilike $${params.length} or p.sku ilike $${params.length} or p.barcode ilike $${params.length})`);
  }
  if (q.category_id) {
    params.push(q.category_id);
    where.push(`p.category_id = $${params.length}`);
  }
  if (q.stock === 'low') where.push('p.stock_quantity <= p.minimum_stock');
  if (q.stock === 'out') where.push('p.stock_quantity = 0');
  if (q.stock === 'in') where.push('p.stock_quantity > 0');

  const order = `${SORT_COLUMNS[q.sort]} ${q.order === 'desc' ? 'desc' : 'asc'} nulls last, p.id`;
  params.push(q.pageSize, (q.page - 1) * q.pageSize);

  const rows = await req.db(async (c) => (await c.query(
    `${PRODUCT_SELECT.replace('select p.id', 'select count(*) over() as total_count, p.id')}
      where ${where.join(' and ')}
      order by ${order}
      limit $${params.length - 1} offset $${params.length}`, params)).rows);

  const total = rows[0]?.total_count ?? 0;
  ok(res, rows.map(({ total_count: _t, ...r }) => present(req, r)), pageMeta(q, total));
}

/** Exact barcode / SKU lookup for barcode scanners. */
export async function lookup(req, res) {
  const code = String(req.query.code || '').trim();
  if (!code || code.length > 64) throw badRequest('A barcode or SKU is required');
  const rows = await req.db(async (c) => (await c.query(
    `${PRODUCT_SELECT}
      where p.store_id = $1 and p.is_active and (p.barcode = $2 or lower(p.sku) = lower($2))
      order by (p.barcode = $2) desc limit 1`, [req.storeId, code])).rows);
  if (!rows[0]) throw notFound(`No active product matches "${code}"`);
  ok(res, present(req, rows[0]));
}

export async function getOne(req, res) {
  const product = await req.db((c) => fetchProduct(c, req.storeId, req.params.id));
  if (!product) throw notFound('Product not found');
  ok(res, present(req, product));
}

export async function create(req, res) {
  const b = req.body;
  const image = await uploadImage(BUCKETS.productImages, req.storeId, req.file);
  try {
    const product = await req.db(async (c) => {
      const { rows } = await c.query(
        `insert into public.products (store_id, category_id, name, sku, barcode, description, image_url,
                                      cost_price, selling_price, minimum_stock)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
        [req.storeId, b.category_id ?? null, b.name, b.sku ?? null, b.barcode ?? null, b.description ?? null,
          image?.url ?? null, b.cost_price, b.selling_price,
          b.minimum_stock ?? req.auth.store.default_low_stock_threshold]);
      const id = rows[0].id;
      if (b.initial_stock > 0) {
        await c.query("select public.adjust_stock($1, $2, 'stock_in', $3, 'Initial stock')",
          [req.storeId, id, b.initial_stock]);
      }
      return fetchProduct(c, req.storeId, id);
    });
    created(res, product);
  } catch (err) {
    if (image) await removeImageByUrl(BUCKETS.productImages, image.url);
    throw err;
  }
}

const UPDATABLE = ['category_id', 'name', 'sku', 'barcode', 'description', 'cost_price', 'selling_price',
  'minimum_stock', 'is_active'];

export async function update(req, res) {
  const b = req.body;
  const image = await uploadImage(BUCKETS.productImages, req.storeId, req.file);
  let previousImage;
  try {
    const product = await req.db(async (c) => {
      const existing = await fetchProduct(c, req.storeId, req.params.id);
      if (!existing) throw notFound('Product not found');
      previousImage = existing.image_url;

      const sets = [];
      const params = [];
      for (const key of UPDATABLE) {
        if (b[key] !== undefined) {
          if (key === 'minimum_stock' && b[key] === null) continue;
          params.push(b[key]);
          sets.push(`${key} = $${params.length}`);
        }
      }
      if (image) {
        params.push(image.url);
        sets.push(`image_url = $${params.length}`);
      } else if (b.remove_image) {
        sets.push('image_url = null');
      }
      if (sets.length) {
        params.push(req.params.id, req.storeId);
        const result = await c.query(
          `update public.products set ${sets.join(', ')} where id = $${params.length - 1} and store_id = $${params.length}`,
          params);
        if (result.rowCount === 0) throw notFound('Product not found');
      }
      return fetchProduct(c, req.storeId, req.params.id);
    });
    if ((image || b.remove_image) && previousImage && previousImage !== product.image_url) {
      await removeImageByUrl(BUCKETS.productImages, previousImage);
    }
    ok(res, product);
  } catch (err) {
    if (image) await removeImageByUrl(BUCKETS.productImages, image.url);
    throw err;
  }
}

async function setActive(req, res, isActive) {
  const product = await req.db(async (c) => {
    const result = await c.query('update public.products set is_active = $1 where id = $2 and store_id = $3',
      [isActive, req.params.id, req.storeId]);
    if (result.rowCount === 0) throw notFound('Product not found');
    return fetchProduct(c, req.storeId, req.params.id);
  });
  ok(res, product);
}

/** Products are archived, never hard-deleted (sales history references them). */
export const archive = (req, res) => setActive(req, res, false);
export const restore = (req, res) => setActive(req, res, true);

// ---------------------------------------------------------------- categories
export async function listCategories(req, res) {
  const rows = await req.db(async (c) => (await c.query(
    `select c.id, c.name, c.description, c.created_at,
            count(p.id) filter (where p.is_active) as product_count
       from public.categories c
       left join public.products p on p.category_id = c.id
      where c.store_id = $1
      group by c.id
      order by lower(c.name)`, [req.storeId])).rows);
  ok(res, rows);
}

export async function createCategory(req, res) {
  const row = await req.db(async (c) => (await c.query(
    'insert into public.categories (store_id, name, description) values ($1, $2, $3) returning id, name, description, created_at',
    [req.storeId, req.body.name, req.body.description ?? null])).rows[0]);
  created(res, row);
}

export async function updateCategory(req, res) {
  const row = await req.db(async (c) => (await c.query(
    `update public.categories set name = $1, description = $2
      where id = $3 and store_id = $4 returning id, name, description, created_at`,
    [req.body.name, req.body.description ?? null, req.params.id, req.storeId])).rows[0]);
  if (!row) throw notFound('Category not found');
  ok(res, row);
}

export async function deleteCategory(req, res) {
  const result = await req.db((c) => c.query('delete from public.categories where id = $1 and store_id = $2',
    [req.params.id, req.storeId]));
  if (result.rowCount === 0) throw notFound('Category not found');
  ok(res, { deleted: true });
}
