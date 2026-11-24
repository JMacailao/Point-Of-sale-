import { z } from 'zod';
import {
  uuid, optionalText, requiredText, email, optionalEmail, boolish, money, intField, password, dateString,
} from './common.js';

export const BUSINESS_TYPES = ['retail', 'grocery', 'convenience', 'restaurant', 'school_canteen', 'pharmacy', 'other'];
export const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'];
export const EXPENSE_CATEGORIES = ['rent', 'utilities', 'supplies', 'salaries', 'transportation', 'maintenance', 'other'];
export const EXPENSE_PAYMENT_METHODS = ['cash', 'gcash', 'maya', 'bank_transfer', 'other'];
export const SALE_PAYMENT_METHODS = ['cash', 'gcash', 'maya', 'other'];

const emptyToNull = (schema) => z.preprocess((v) => (v === '' ? null : v), schema);

// ---------------------------------------------------------------- setup ----
export const initializeAdminSchema = z.object({
  email,
  password,
  fullName: optionalText(120),
});

export const storeSetupSchema = z.object({
  store_name: requiredText(120, 'Store name'),
  store_address: optionalText(300),
  contact_number: optionalText(40),
  business_email: optionalEmail,
  business_type: emptyToNull(z.enum(BUSINESS_TYPES).nullable().optional()),
  currency: z.literal('PHP').default('PHP'),
  timezone: z.string().trim().min(1).max(64).default('Asia/Manila'),
  date_format: z.enum(DATE_FORMATS).default('DD/MM/YYYY'),
  receipt_footer: optionalText(300),
});

// ------------------------------------------------------------- settings ----
// Partial update: every field optional, no defaults (so omitted fields are untouched).
export const storeSettingsSchema = z.object({
  store_name: requiredText(120, 'Store name').optional(),
  store_address: optionalText(300),
  contact_number: optionalText(40),
  business_email: optionalEmail,
  business_type: emptyToNull(z.enum(BUSINESS_TYPES).nullable().optional()),
  currency: z.literal('PHP').optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  date_format: z.enum(DATE_FORMATS).optional(),
  receipt_footer: optionalText(300),
  receipt_paper: z.enum(['58mm', '80mm', 'a4']).optional(),
  tax_enabled: boolish.optional(),
  tax_name: z.string().trim().min(1).max(20).optional(),
  tax_rate: z.coerce.number().min(0).max(100).optional(),
  tax_inclusive: boolish.optional(),
  allow_cashier_discount: boolish.optional(),
  max_discount_percent: z.coerce.number().min(0).max(100).optional(),
  default_low_stock_threshold: intField('Low stock threshold', 0, 1_000_000).optional(),
  low_stock_alerts: boolish.optional(),
  remove_logo: boolish.optional(),
});

export const profileUpdateSchema = z.object({ full_name: requiredText(120, 'Full name') });

// ------------------------------------------------------------- products ----
const productBase = {
  name: requiredText(160, 'Product name'),
  sku: optionalText(64),
  barcode: optionalText(64),
  category_id: emptyToNull(uuid.nullable().optional()),
  description: optionalText(1000),
  cost_price: money('Cost price'),
  selling_price: money('Selling price'),
  minimum_stock: emptyToNull(intField('Minimum stock').nullable().optional()),
};

export const productCreateSchema = z.object({
  ...productBase,
  cost_price: money('Cost price').default(0),
  initial_stock: intField('Initial stock').default(0),
});

export const productUpdateSchema = z.object({
  ...productBase,
  is_active: boolish.optional(),
  remove_image: boolish.optional(),
}).partial().refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const productListQuery = z.object({
  search: z.string().trim().max(100).optional(),
  category_id: uuid.optional(),
  status: z.enum(['active', 'archived', 'all']).default('active'),
  stock: z.enum(['all', 'low', 'out', 'in']).default('all'),
  sort: z.enum(['name', 'selling_price', 'stock_quantity', 'created_at', 'sku']).default('name'),
  order: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

export const categorySchema = z.object({
  name: requiredText(80, 'Category name'),
  description: optionalText(300),
});

// ------------------------------------------------------------ inventory ----
export const stockChangeSchema = z.object({
  product_id: uuid,
  quantity: intField('Quantity', 1),
  reason: optionalText(300),
});

export const stockAdjustmentSchema = z.object({
  product_id: uuid,
  counted_quantity: intField('Counted quantity', 0),
  reason: requiredText(300, 'Reason'),
});

// ---------------------------------------------------------------- sales ----
export const saleCreateSchema = z.object({
  client_request_id: uuid,
  items: z.array(z.object({
    product_id: uuid,
    quantity: z.number().int('Quantity must be a whole number').min(1).max(100_000),
  })).min(1, 'The cart is empty').max(300),
  discount_type: z.enum(['none', 'amount', 'percent']).default('none'),
  discount_value: money('Discount').default(0),
  payment_method: z.enum(SALE_PAYMENT_METHODS),
  amount_received: money('Amount received').nullable().optional(),
  reference_number: optionalText(64),
});

export const refundSchema = z.object({ reason: requiredText(300, 'Refund reason') });

// ---------------------------------------------------------------- users ----
export const userCreateSchema = z.object({
  email,
  full_name: requiredText(120, 'Full name'),
  role: z.enum(['administrator', 'cashier']),
});

export const userUpdateSchema = z.object({
  full_name: requiredText(120, 'Full name').optional(),
  role: z.enum(['administrator', 'cashier']).optional(),
}).refine((v) => v.full_name !== undefined || v.role !== undefined, 'Nothing to update');

export const userStatusSchema = z.object({ is_active: z.boolean() });

// ------------------------------------------------------------- expenses ----
export const expenseSchema = z.object({
  description: requiredText(200, 'Description'),
  category: z.enum(EXPENSE_CATEGORIES),
  amount: money('Amount').refine((n) => n > 0, 'Amount must be greater than zero'),
  expense_date: dateString,
  payment_method: z.enum(EXPENSE_PAYMENT_METHODS).default('cash'),
  reference_number: optionalText(64),
  notes: optionalText(1000),
});

export const expenseVoidSchema = z.object({ reason: requiredText(300, 'Reason') });
