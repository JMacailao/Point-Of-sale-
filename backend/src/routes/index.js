import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { imageUpload } from '../middleware/upload.js';
import { setupLimiter, authLimiter, salesLimiter } from '../middleware/rateLimiters.js';
import * as S from '../validators/schemas.js';
import { uuid } from '../validators/common.js';
import { z } from 'zod';
import { getPool } from '../config/database.js';
import { ok } from '../utils/http.js';
import * as setup from '../controllers/setupController.js';
import * as auth from '../controllers/authController.js';
import * as products from '../controllers/productsController.js';
import * as inventory from '../controllers/inventoryController.js';
import * as sales from '../controllers/salesController.js';
import * as users from '../controllers/usersController.js';
import * as expenses from '../controllers/expensesController.js';
import * as dashboard from '../controllers/dashboardController.js';
import * as reports from '../controllers/reportsController.js';
import * as settings from '../controllers/settingsController.js';

const router = Router();
const idParam = validate(z.object({ id: uuid }), 'params');
const authed = authenticate();
const can = requirePermission;

// ---------------------------------------------------------------- health
router.get('/health', async (_req, res) => {
  await getPool().query('select 1');
  ok(res, { status: 'ok' });
});

// ----------------------------------------------------------------- setup
router.get('/setup/status', setup.getStatus);
router.post('/setup/initialize-admin', setupLimiter, validate(S.initializeAdminSchema), setup.initializeAdmin);
router.post('/setup/store', setupLimiter, authenticate({ requireStore: false }), imageUpload('logo'),
  validate(S.storeSetupSchema), setup.setupStore);

// ------------------------------------------------------------------ auth
router.post('/auth/verify', authLimiter, authenticate({ requireStore: false }), auth.verify);
router.get('/auth/me', authenticate({ requireStore: false }), auth.me);
router.post('/auth/logout', authenticate({ requireStore: false }), auth.logout);
router.put('/auth/profile', authenticate({ requireStore: false }), validate(S.profileUpdateSchema), auth.updateProfile);

// ------------------------------------------------------------- dashboard
router.get('/dashboard/summary', authed, can('dashboard.view'), dashboard.summary);
router.get('/dashboard/sales', authed, can('dashboard.view'), dashboard.sales);

// -------------------------------------------------------------- products
router.get('/products', authed, can('products.view', 'pos.use'), validate(S.productListQuery, 'query'), products.list);
router.get('/products/lookup', authed, can('products.view', 'pos.use'), products.lookup);
router.get('/products/:id', authed, can('products.view', 'pos.use'), idParam, products.getOne);
router.post('/products', authed, can('products.manage'), imageUpload('image'), validate(S.productCreateSchema), products.create);
router.put('/products/:id', authed, can('products.manage'), idParam, imageUpload('image'), validate(S.productUpdateSchema), products.update);
router.delete('/products/:id', authed, can('products.manage'), idParam, products.archive);
router.post('/products/:id/restore', authed, can('products.manage'), idParam, products.restore);

// ------------------------------------------------------------ categories
router.get('/categories', authed, can('products.view', 'pos.use'), products.listCategories);
router.post('/categories', authed, can('products.manage'), validate(S.categorySchema), products.createCategory);
router.put('/categories/:id', authed, can('products.manage'), idParam, validate(S.categorySchema), products.updateCategory);
router.delete('/categories/:id', authed, can('products.manage'), idParam, products.deleteCategory);

// ------------------------------------------------------------- inventory
router.get('/inventory', authed, can('inventory.view'), inventory.list);
router.get('/inventory/movements', authed, can('inventory.view'), inventory.movements);
router.post('/inventory/stock-in', authed, can('inventory.manage'), validate(S.stockChangeSchema), inventory.stockIn);
router.post('/inventory/stock-out', authed, can('inventory.manage'), validate(S.stockChangeSchema), inventory.stockOut);
router.post('/inventory/adjustment', authed, can('inventory.manage'), validate(S.stockAdjustmentSchema), inventory.adjustment);

// ----------------------------------------------------------------- sales
router.get('/sales', authed, can('sales.view_all', 'sales.view_own'), sales.list);
router.get('/sales/export', authed, can('sales.view_all', 'sales.view_own'), sales.exportCsv);
router.get('/sales/cashiers', authed, can('sales.view_all'), sales.cashiers);
router.post('/sales', authed, salesLimiter, can('pos.use'), validate(S.saleCreateSchema), sales.create);
router.get('/sales/:id', authed, can('sales.view_all', 'sales.view_own'), idParam, sales.getOne);
router.post('/sales/:id/refund', authed, can('sales.refund'), idParam, validate(S.refundSchema), sales.refund);

// ----------------------------------------------------------------- users
router.get('/users', authed, can('users.manage'), users.list);
router.get('/roles', authed, can('users.manage', 'settings.manage'), users.roles);
router.post('/users', authed, can('users.manage'), validate(S.userCreateSchema), users.create);
router.get('/users/:id', authed, can('users.manage'), idParam, users.getOne);
router.put('/users/:id', authed, can('users.manage'), idParam, validate(S.userUpdateSchema), users.update);
router.put('/users/:id/status', authed, can('users.manage'), idParam, validate(S.userStatusSchema), users.setStatus);
router.get('/users/:id/activity', authed, can('users.manage'), idParam, users.activity);

// -------------------------------------------------------------- expenses
router.get('/expenses', authed, can('expenses.view'), expenses.list);
router.get('/expenses/export', authed, can('expenses.view'), expenses.exportCsv);
router.get('/expenses/:id', authed, can('expenses.view'), idParam, expenses.getOne);
router.post('/expenses', authed, can('expenses.manage'), validate(S.expenseSchema), expenses.create);
router.put('/expenses/:id', authed, can('expenses.manage'), idParam, validate(S.expenseSchema), expenses.update);
router.delete('/expenses/:id', authed, can('expenses.manage'), idParam, validate(S.expenseVoidSchema), expenses.voidExpense);

// --------------------------------------------------------------- reports
router.get('/reports/sales', authed, can('reports.view'), reports.sales);
router.get('/reports/sales/export', authed, can('reports.view'), reports.salesExport);
router.get('/reports/inventory', authed, can('reports.view'), reports.inventory);

// -------------------------------------------------------------- settings
router.get('/settings/store', authed, settings.getStore);
router.put('/settings/store', authed, can('settings.manage'), imageUpload('logo'), validate(S.storeSettingsSchema), settings.updateStore);
router.get('/settings/audit-logs', authed, can('audit.view'), settings.auditLogs);

export default router;
