import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  resetDatabase, clearFirebaseAccounts, startApp, stopApp, api, signIn, signUpDirect,
  listFirebaseAccounts, dbQuery, storageUploads, PNG_BYTES,
} from './helpers.js';

const ADMIN = { email: 'owner@store.test', password: 'Secret123' };
const state = {};

before(async () => {
  await resetDatabase();
  await clearFirebaseAccounts();
  await startApp();
});

after(async () => {
  await stopApp();
});

// ===================================================================== SETUP
test('fresh system reports setup not started', async () => {
  const r = await api('GET', '/setup/status');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data, { adminClaimed: false, setupCompleted: false, store: null });
});

test('protected endpoints reject missing and forged tokens', async () => {
  assert.equal((await api('GET', '/products')).status, 401);
  assert.equal((await api('GET', '/auth/me', { token: 'not-a-jwt' })).status, 401);
  // A token that does not come from Firebase is rejected even if well-formed.
  const forged = [Buffer.from('{"alg":"none"}').toString('base64url'),
    Buffer.from(JSON.stringify({ sub: 'x', aud: 'other', iss: 'evil' })).toString('base64url'), ''].join('.');
  assert.equal((await api('GET', '/auth/me', { token: forged })).status, 401);
});

test('admin registration validates input', async () => {
  let r = await api('POST', '/setup/initialize-admin', { body: { email: 'bad', password: 'Secret123' } });
  assert.equal(r.status, 400);
  r = await api('POST', '/setup/initialize-admin', { body: { email: 'a@b.test', password: 'weak' } });
  assert.equal(r.status, 400);
  assert.match(r.body.error.message, /at least 8/);
  r = await api('POST', '/setup/initialize-admin', { body: { email: 'a@b.test', password: 'alllowercase1' } });
  assert.equal(r.status, 400);
});

test('concurrent initial admin registration: exactly one succeeds', async () => {
  const attempts = await Promise.all([ADMIN, ...[1, 2, 3, 4, 5].map((i) => ({ email: `racer${i}@store.test`, password: 'Secret123' }))]
    .map((b) => api('POST', '/setup/initialize-admin', { body: b })));
  const winners = attempts.filter((r) => r.status === 201);
  const losers = attempts.filter((r) => r.status !== 201);
  assert.equal(winners.length, 1, JSON.stringify(attempts.map((a) => a.status)));
  assert.ok(losers.every((r) => r.status === 409 && r.body.error.code === 'SETUP_ALREADY_CLAIMED'));

  const profiles = await dbQuery('select email from profiles');
  assert.equal(profiles.length, 1);
  // Firebase accounts of the losing requests were rolled back.
  const accounts = await listFirebaseAccounts();
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].email, profiles[0].email);
  state.adminEmail = profiles[0].email;
  state.adminPassword = 'Secret123';
});

test('admin registration is permanently closed after the claim', async () => {
  const r = await api('POST', '/setup/initialize-admin', { body: { email: 'late@store.test', password: 'Secret123' } });
  assert.equal(r.status, 409);
  const s = await api('GET', '/setup/status');
  assert.equal(s.body.data.adminClaimed, true);
  assert.equal(s.body.data.setupCompleted, false);
});

test('admin login before store setup resumes the wizard', async () => {
  state.adminToken = await signIn(state.adminEmail, state.adminPassword);
  const r = await api('POST', '/auth/verify', { token: state.adminToken });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.setup.pendingStoreSetup, true);
  assert.equal(r.body.data.store, null);
  const p = await api('GET', '/products', { token: state.adminToken });
  assert.equal(p.status, 403);
  assert.equal(p.body.error.code, 'STORE_SETUP_REQUIRED');
});

test('a Firebase account without a POS profile is rejected', async () => {
  const token = await signUpDirect('stranger@store.test', 'Secret123');
  const r = await api('POST', '/auth/verify', { token });
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, 'PROFILE_NOT_FOUND');
  const s = await api('POST', '/setup/store', { token, body: { store_name: 'Hijack' } });
  assert.equal(s.status, 403);
});

test('store setup requires a name, uploads the logo and completes setup', async () => {
  let r = await api('POST', '/setup/store', { token: state.adminToken, body: { store_name: '  ' } });
  assert.equal(r.status, 400);

  const form = new FormData();
  form.set('store_name', 'Aling Nena Store');
  form.set('store_address', '123 Rizal St, Manila');
  form.set('business_type', 'grocery');
  form.set('receipt_footer', 'Salamat po!');
  form.set('logo', new Blob([PNG_BYTES], { type: 'image/png' }), 'logo.png');
  r = await api('POST', '/setup/store', { token: state.adminToken, form });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.store.store_name, 'Aling Nena Store');
  assert.equal(r.body.data.store.currency, 'PHP');
  assert.equal(r.body.data.store.timezone, 'Asia/Manila');
  assert.equal(r.body.data.store.date_format, 'DD/MM/YYYY');
  assert.match(r.body.data.store.logo_url, /\/storage\/v1\/object\/public\/store-assets\/logos\/.+\.png$/);
  assert.equal(r.body.data.role.key, 'administrator');
  assert.ok(r.body.data.permissions.includes('users.manage'));
  assert.equal(storageUploads.length, 1);
  state.storeId = r.body.data.store.id;

  r = await api('POST', '/setup/store', { token: state.adminToken, body: { store_name: 'Again' } });
  assert.equal(r.status, 409);

  const s = await api('GET', '/setup/status');
  assert.deepEqual(s.body.data, { adminClaimed: true, setupCompleted: true,
    store: { store_name: 'Aling Nena Store', logo_url: r.body.data?.store?.logo_url ?? s.body.data.store.logo_url } });
});

test('logo upload rejects files that are not images', async () => {
  const form = new FormData();
  form.set('logo', new Blob([Buffer.from('<?php echo 1;')], { type: 'image/png' }), 'evil.png');
  const r = await api('PUT', '/settings/store', { token: state.adminToken, form });
  assert.equal(r.status, 400);
});

// ================================================================== PRODUCTS
test('products: create, validate, search, barcode lookup, update, archive', async () => {
  const t = state.adminToken;
  let r = await api('POST', '/categories', { token: t, body: { name: 'Beverages' } });
  assert.equal(r.status, 201);
  state.categoryId = r.body.data.id;
  assert.equal((await api('POST', '/categories', { token: t, body: { name: 'beverages' } })).status, 409);

  r = await api('POST', '/products', { token: t, body: {
    name: 'Coke 1.5L', sku: 'COKE-15', barcode: '4801981116195', category_id: state.categoryId,
    cost_price: 58.5, selling_price: 75, minimum_stock: 5, initial_stock: 24 } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.data.stock_quantity, 24);
  assert.equal(r.body.data.category_name, 'Beverages');
  state.cokeId = r.body.data.id;

  const form = new FormData();
  form.set('name', 'Pandesal (10pcs)');
  form.set('sku', 'PAN-10');
  form.set('cost_price', '30');
  form.set('selling_price', '45.50');
  form.set('initial_stock', '10');
  form.set('image', new Blob([PNG_BYTES], { type: 'image/png' }), 'p.png');
  r = await api('POST', '/products', { token: t, form });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.match(r.body.data.image_url, /product-images/);
  assert.equal(r.body.data.minimum_stock, 5, 'store default low-stock threshold applied');
  state.breadId = r.body.data.id;

  r = await api('POST', '/products', { token: t, body: { name: 'Dup', sku: 'coke-15', selling_price: 1 } });
  assert.equal(r.status, 409);
  assert.match(r.body.error.message, /SKU/);
  r = await api('POST', '/products', { token: t, body: { name: 'Bad', selling_price: -1 } });
  assert.equal(r.status, 400);
  r = await api('POST', '/products', { token: t, body: { name: 'Bad', selling_price: 1.005 } });
  assert.equal(r.status, 400);

  r = await api('GET', '/products?search=coke', { token: t });
  assert.equal(r.body.data.length, 1);
  assert.equal(r.body.meta.total, 1);
  r = await api('GET', '/products/lookup?code=4801981116195', { token: t });
  assert.equal(r.body.data.id, state.cokeId);
  r = await api('GET', '/products/lookup?code=pan-10', { token: t });
  assert.equal(r.body.data.id, state.breadId);
  assert.equal((await api('GET', '/products/lookup?code=nothing', { token: t })).status, 404);

  // stock_quantity in an update is ignored (not an updatable field)
  r = await api('PUT', `/products/${state.cokeId}`, { token: t, body: { selling_price: 80, stock_quantity: 9999 } });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.selling_price, 80);
  assert.equal(r.body.data.stock_quantity, 24);
  assert.equal(r.body.data.cost_price, 58.5, 'partial update keeps other fields');

  r = await api('POST', '/products', { token: t, body: { name: 'Old Item', selling_price: 5 } });
  const oldId = r.body.data.id;
  assert.equal((await api('DELETE', `/products/${oldId}`, { token: t })).body.data.is_active, false);
  r = await api('GET', '/products?status=archived', { token: t });
  assert.equal(r.body.data.length, 1);
  assert.equal((await api('POST', `/products/${oldId}/restore`, { token: t })).body.data.is_active, true);
  await api('DELETE', `/products/${oldId}`, { token: t });

  const movements = await dbQuery("select count(*)::int as n from stock_movements where reason = 'Initial stock'");
  assert.equal(movements[0].n, 2);
});

// ================================================================= INVENTORY
test('inventory: stock in/out/adjustment with movements and negative prevention', async () => {
  const t = state.adminToken;
  let r = await api('POST', '/inventory/stock-in', { token: t, body: { product_id: state.cokeId, quantity: 6, reason: 'Delivery' } });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.data.previous_quantity, r.body.data.quantity_changed, r.body.data.new_quantity], [24, 6, 30]);
  r = await api('POST', '/inventory/stock-out', { token: t, body: { product_id: state.cokeId, quantity: 2 } });
  assert.equal(r.status, 400, 'reason required');
  r = await api('POST', '/inventory/stock-out', { token: t, body: { product_id: state.cokeId, quantity: 500, reason: 'x' } });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'INSUFFICIENT_STOCK');
  r = await api('POST', '/inventory/stock-out', { token: t, body: { product_id: state.cokeId, quantity: 2, reason: 'Expired' } });
  assert.equal(r.body.data.new_quantity, 28);
  r = await api('POST', '/inventory/adjustment', { token: t, body: { product_id: state.cokeId, counted_quantity: 25, reason: 'Count' } });
  assert.equal(r.body.data.quantity_changed, -3);
  r = await api('GET', `/inventory/movements?product_id=${state.cokeId}`, { token: t });
  assert.equal(r.body.data.length, 4);
  assert.equal(r.body.data[0].movement_type, 'adjustment');
  assert.equal(r.body.data[0].performed_by_name, state.adminEmail);
  r = await api('GET', '/inventory', { token: t });
  assert.equal(r.body.meta.summary.total_units, 35);
});

// ===================================================================== USERS
test('users: admin creates a cashier with a Firebase account and setup link', async () => {
  const t = state.adminToken;
  let r = await api('POST', '/users', { token: t, body: { email: 'Cashier@Store.test', full_name: 'Carla Cruz', role: 'cashier' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.data.email, 'cashier@store.test');
  assert.equal(r.body.data.role, 'cashier');
  assert.match(r.body.data.passwordSetupLink, /oobCode=/);
  state.cashierId = r.body.data.id;

  r = await api('POST', '/users', { token: t, body: { email: 'cashier@store.test', full_name: 'Again', role: 'cashier' } });
  assert.equal(r.status, 409);

  // No password is stored in PostgreSQL.
  const cols = await dbQuery("select column_name from information_schema.columns where table_schema='public' and column_name ilike '%pass%'");
  assert.equal(cols.length, 0);

  // Simulate the cashier completing the password setup link.
  const { firebaseAuth } = await import('../src/config/firebase.js');
  const fbUser = await firebaseAuth().getUserByEmail('cashier@store.test');
  await firebaseAuth().updateUser(fbUser.uid, { password: 'Cashier123' });
  state.cashierToken = await signIn('cashier@store.test', 'Cashier123');

  r = await api('POST', '/auth/verify', { token: state.cashierToken });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.role.key, 'cashier');
  assert.deepEqual(r.body.data.permissions.sort(), ['dashboard.view', 'pos.use', 'products.view', 'sales.view_own']);
});

test('cashier permissions are enforced by the API', async () => {
  const t = state.cashierToken;
  for (const [m, u, b] of [
    ['GET', '/users'], ['GET', '/inventory'], ['GET', '/reports/sales'], ['GET', '/expenses'],
    ['POST', '/products', { name: 'X', selling_price: 1 }],
    ['PUT', '/settings/store', { store_name: 'Hacked' }],
    ['POST', '/users', { email: 'evil@store.test', full_name: 'Evil', role: 'administrator' }],
    ['PUT', `/users/${state.cashierId}`, { role: 'administrator' }],
    ['POST', '/inventory/stock-in', { product_id: state.cokeId, quantity: 1 }],
    ['GET', '/settings/audit-logs'],
  ]) {
    const r = await api(m, u, { token: t, body: b });
    assert.equal(r.status, 403, `${m} ${u} should be forbidden, got ${r.status}`);
  }
  const p = await api('GET', '/products', { token: t });
  assert.equal(p.status, 200);
  assert.ok(p.body.data.length > 0);
  assert.ok(!('cost_price' in p.body.data[0]), 'cost price hidden from cashiers');
});

test('admin cannot change their own role or deactivate themselves', async () => {
  const me = await api('GET', '/auth/me', { token: state.adminToken });
  const r = await api('PUT', `/users/${me.body.data.user.id}`, { token: state.adminToken, body: { role: 'cashier' } });
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, 'SELF_MODIFICATION');
  const s = await api('PUT', `/users/${me.body.data.user.id}/status`, { token: state.adminToken, body: { is_active: false } });
  assert.equal(s.status, 403);
});

// ===================================================================== SALES
test('sales: correct totals, change, stock deduction and receipt data', async () => {
  const t = state.cashierToken;
  const requestId = randomUUID();
  const body = {
    client_request_id: requestId,
    items: [{ product_id: state.cokeId, quantity: 2 }, { product_id: state.breadId, quantity: 3 }],
    payment_method: 'cash', amount_received: 500,
    // A client cannot set prices or the cashier: these fields are ignored.
    unit_price: 0.01, cashier_id: randomUUID(), total_amount: 1,
  };
  const r = await api('POST', '/sales', { token: t, body });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const sale = r.body.data;
  // 2 x 80.00 + 3 x 45.50 = 296.50
  assert.equal(sale.subtotal, 296.5);
  assert.equal(sale.discount, 0);
  assert.equal(sale.total_amount, 296.5);
  assert.equal(sale.amount_received, 500);
  assert.equal(sale.change_amount, 203.5);
  assert.equal(sale.cashier_name, 'Carla Cruz');
  assert.equal(sale.items.length, 2);
  assert.ok(!('cost_price' in sale.items[0]), 'cost snapshot hidden from cashier');
  assert.match(sale.transaction_number, /^TXN-\d{8}-000001$/);
  state.sale1 = sale;

  // Retrying the same request (e.g. double click / network retry) does not create a second sale.
  const retry = await api('POST', '/sales', { token: t, body });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.data.duplicate, true);
  assert.equal(retry.body.data.id, sale.id);

  const stock = await dbQuery('select id, stock_quantity from products where id = any($1)', [[state.cokeId, state.breadId]]);
  assert.equal(stock.find((p) => p.id === state.cokeId).stock_quantity, 23);
  assert.equal(stock.find((p) => p.id === state.breadId).stock_quantity, 7);
  const cost = await dbQuery('select cost_price from sale_items where sale_id = $1 and product_id = $2', [sale.id, state.cokeId]);
  assert.equal(Number(cost[0].cost_price), 58.5);
});

test('sales: overselling, invalid payments and unauthorized discounts are rejected', async () => {
  const t = state.cashierToken;
  const base = { items: [{ product_id: state.breadId, quantity: 1 }], payment_method: 'cash', amount_received: 1000 };
  let r = await api('POST', '/sales', { token: t, body: { ...base, client_request_id: randomUUID(), items: [{ product_id: state.breadId, quantity: 8 }] } });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'INSUFFICIENT_STOCK');
  r = await api('POST', '/sales', { token: t, body: { ...base, client_request_id: randomUUID(), amount_received: 10 } });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'PAYMENT_INVALID');
  r = await api('POST', '/sales', { token: t, body: { ...base, client_request_id: randomUUID(), payment_method: 'gcash', amount_received: null } });
  assert.equal(r.body.error.code, 'PAYMENT_INVALID');
  r = await api('POST', '/sales', { token: t, body: { ...base, client_request_id: randomUUID(), discount_type: 'amount', discount_value: 5 } });
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, 'DISCOUNT_NOT_AUTHORIZED');
  r = await api('POST', '/sales', { token: t, body: { ...base, client_request_id: randomUUID(), items: [] } });
  assert.equal(r.status, 400);
  r = await api('POST', '/sales', { token: t, body: { ...base, client_request_id: randomUUID(), items: [{ product_id: state.breadId, quantity: 0 }] } });
  assert.equal(r.status, 400);
  const stock = await dbQuery('select stock_quantity from products where id = $1', [state.breadId]);
  assert.equal(stock[0].stock_quantity, 7, 'failed sales did not touch stock');
});

test('sales: concurrent checkouts cannot oversell the last units', async () => {
  // 7 bread left: 5 concurrent sales of 2 => at most 3 can succeed.
  const results = await Promise.all([1, 2, 3, 4, 5].map(() => api('POST', '/sales', { token: state.adminToken, body: {
    client_request_id: randomUUID(), items: [{ product_id: state.breadId, quantity: 2 }], payment_method: 'cash', amount_received: 100 } })));
  const okCount = results.filter((r) => r.status === 201).length;
  assert.equal(okCount, 3, JSON.stringify(results.map((r) => r.status)));
  const stock = await dbQuery('select stock_quantity from products where id = $1', [state.breadId]);
  assert.equal(stock[0].stock_quantity, 1);
});

test('sales: admin discount with GCash reference', async () => {
  const r = await api('POST', '/sales', { token: state.adminToken, body: {
    client_request_id: randomUUID(), items: [{ product_id: state.cokeId, quantity: 5 }],
    discount_type: 'percent', discount_value: 10, payment_method: 'gcash', reference_number: '1023456789' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.data.subtotal, 400);
  assert.equal(r.body.data.discount, 40);
  assert.equal(r.body.data.total_amount, 360);
  assert.equal(r.body.data.change_amount, 0);
  assert.equal(r.body.data.payments[0].reference_number, '1023456789');
  assert.ok('cost_price' in r.body.data.items[0]);
});

test('sales visibility: cashiers see only their own sales', async () => {
  const c = await api('GET', '/sales', { token: state.cashierToken });
  assert.equal(c.status, 200);
  assert.equal(c.body.data.length, 1);
  assert.equal(c.body.data[0].id, state.sale1.id);
  const a = await api('GET', '/sales', { token: state.adminToken });
  assert.equal(a.body.meta.total, 5);
  const adminSale = a.body.data.find((s) => s.cashier_id !== state.cashierId);
  assert.equal((await api('GET', `/sales/${adminSale.id}`, { token: state.cashierToken })).status, 404);
  const filtered = await api('GET', '/sales?payment_method=gcash', { token: state.adminToken });
  assert.equal(filtered.body.data.length, 1);
  const csv = await api('GET', '/sales/export', { token: state.adminToken });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.body, /Transaction Number,/);
  assert.equal(csv.body.trim().split('\r\n').length, 6);
});

test('refunds: only authorized users, once, with restock', async () => {
  let r = await api('POST', `/sales/${state.sale1.id}/refund`, { token: state.cashierToken, body: { reason: 'Changed mind' } });
  assert.equal(r.status, 403);
  r = await api('POST', `/sales/${state.sale1.id}/refund`, { token: state.adminToken, body: {} });
  assert.equal(r.status, 400);
  r = await api('POST', `/sales/${state.sale1.id}/refund`, { token: state.adminToken, body: { reason: 'Customer returned items' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.status, 'refunded');
  assert.equal(r.body.data.refunded_by_name, state.adminEmail);
  r = await api('POST', `/sales/${state.sale1.id}/refund`, { token: state.adminToken, body: { reason: 'Again' } });
  assert.equal(r.status, 409);
  const stock = await dbQuery('select stock_quantity from products where id = $1', [state.breadId]);
  assert.equal(stock[0].stock_quantity, 4);
});

// ================================================================== EXPENSES
test('expenses: create, edit with audit history, void, export', async () => {
  const t = state.adminToken;
  let r = await api('POST', '/expenses', { token: t, body: {
    description: 'Meralco bill', category: 'utilities', amount: 1500, expense_date: '2026-11-20', payment_method: 'cash' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const id = r.body.data.id;
  r = await api('POST', '/expenses', { token: t, body: { description: 'x', category: 'invalid', amount: 1, expense_date: '2026-11-20' } });
  assert.equal(r.status, 400);
  r = await api('PUT', `/expenses/${id}`, { token: t, body: {
    description: 'Meralco bill (Nov)', category: 'utilities', amount: 1650.75, expense_date: '2026-11-20', payment_method: 'gcash', reference_number: 'GC1' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.amount, 1650.75);
  r = await api('GET', `/expenses/${id}`, { token: t });
  assert.equal(r.body.data.history.length, 2);
  assert.equal(r.body.data.history[1].old_values.amount, 1500);
  assert.equal(r.body.data.history[1].new_values.amount, 1650.75);
  r = await api('GET', '/expenses', { token: t });
  assert.equal(r.body.meta.totalAmount, 1650.75);
  r = await api('DELETE', `/expenses/${id}`, { token: t, body: { reason: 'Duplicate entry' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.is_voided, true);
  assert.equal((await api('PUT', `/expenses/${id}`, { token: t, body: {
    description: 'x', category: 'utilities', amount: 1, expense_date: '2026-11-20' } })).status, 409);
  r = await api('GET', '/expenses', { token: t });
  assert.equal(r.body.data.length, 0);
  r = await api('GET', '/expenses?include_voided=true', { token: t });
  assert.equal(r.body.data.length, 1);
  await api('POST', '/expenses', { token: t, body: { description: 'Store rent', category: 'rent', amount: 100, expense_date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date()) } });
  const csv = await api('GET', '/expenses/export', { token: t });
  assert.match(csv.body, /Store rent/);
});

// ============================================================ DASHBOARD/REPORTS
test('dashboard and reports use real data and separate revenue from profit', async () => {
  const d = await api('GET', '/dashboard/summary', { token: state.adminToken });
  assert.equal(d.status, 200);
  // completed today: 3 x 91.00 (bread) + 360.00 = 633.00
  assert.equal(d.body.data.total_sales, 633);
  assert.equal(d.body.data.transactions, 4);
  assert.equal(d.body.data.refunded_count, 1);
  assert.equal(d.body.data.total_products, 2);
  assert.equal(d.body.data.low_stock_count, 1);
  assert.equal(d.body.data.best_sellers[0].product_name, 'Pandesal (10pcs)');

  const cd = await api('GET', '/dashboard/summary', { token: state.cashierToken });
  assert.equal(cd.body.data.total_sales, 0, 'cashier dashboard scoped to own (refunded) sale');
  assert.equal(cd.body.data.scope, 'own');

  const r = await api('GET', '/reports/sales?group=month', { token: state.adminToken });
  assert.equal(r.status, 200);
  const tot = r.body.data.totals;
  assert.equal(tot.net_sales, 633);
  assert.equal(tot.refunds, 296.5);
  assert.equal(tot.discounts, 40);
  assert.equal(tot.gross_sales, 296.5 + 273 + 400);
  // COGS: 3 x 2 x 30 (bread) + 5 x 58.5 (coke) = 472.50
  assert.equal(tot.cost_of_goods, 472.5);
  assert.equal(tot.gross_profit, 633 - 472.5);
  assert.equal(tot.expenses, 100);
  assert.equal(tot.net_profit, 633 - 472.5 - 100);

  const csv = await api('GET', '/reports/sales/export?group=day', { token: state.adminToken });
  assert.match(csv.body, /TOTAL/);
  const inv = await api('GET', '/reports/inventory', { token: state.adminToken });
  assert.equal(inv.status, 200);
  assert.equal(inv.body.data.lowStock.length, 1);
});

// ================================================================= SETTINGS
test('settings: admin updates business settings; invalid values rejected', async () => {
  const t = state.adminToken;
  let r = await api('PUT', '/settings/store', { token: t, body: { tax_enabled: true, tax_rate: 12, tax_inclusive: true, receipt_paper: '58mm' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.tax_enabled, true);
  assert.equal(r.body.data.store_name, 'Aling Nena Store', 'untouched fields preserved');
  r = await api('PUT', '/settings/store', { token: t, body: { timezone: 'Mars/Olympus' } });
  assert.equal(r.status, 400);
  r = await api('PUT', '/settings/store', { token: t, body: { tax_rate: 150 } });
  assert.equal(r.status, 400);
  const logs = await api('GET', '/settings/audit-logs?module=stores', { token: t });
  assert.ok(logs.body.data.some((l) => l.new_values?.tax_enabled === true));
});

// ================================================================= SECURITY
test('cross-store access via X-Store-Id is denied', async () => {
  const otherStore = (await dbQuery("insert into stores (store_name) values ('Other') returning id"))[0].id;
  const r = await api('GET', '/products', { token: state.adminToken, headers: { 'x-store-id': otherStore } });
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, 'STORE_ACCESS_DENIED');
  const bad = await api('GET', '/products', { token: state.adminToken, headers: { 'x-store-id': "' or 1=1 --" } });
  assert.equal(bad.status, 403);
});

test('deactivated users lose access immediately and cannot sign in', async () => {
  let r = await api('PUT', `/users/${state.cashierId}/status`, { token: state.adminToken, body: { is_active: false } });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.is_active, false);
  r = await api('GET', '/auth/me', { token: state.cashierToken });
  assert.ok([401, 403].includes(r.status), `expected 401/403, got ${r.status}`);
  await assert.rejects(() => signIn('cashier@store.test', 'Cashier123'), /USER_DISABLED/);

  // Re-activation restores access.
  r = await api('PUT', `/users/${state.cashierId}/status`, { token: state.adminToken, body: { is_active: true } });
  assert.equal(r.status, 200);
  const token = await signIn('cashier@store.test', 'Cashier123');
  assert.equal((await api('GET', '/auth/me', { token })).status, 200);
});

test('logout is audited', async () => {
  const r = await api('POST', '/auth/logout', { token: state.adminToken, body: {} });
  assert.equal(r.status, 200);
  const rows = await dbQuery("select count(*)::int as n from audit_logs where action = 'logout'");
  assert.equal(rows[0].n, 1);
});
