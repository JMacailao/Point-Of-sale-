export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new AppError(400, 'VALIDATION', message, details);
export const unauthorized = (message = 'Authentication required', code = 'UNAUTHENTICATED') =>
  new AppError(401, code, message);
export const forbidden = (message = 'You do not have permission to perform this action', code = 'FORBIDDEN') =>
  new AppError(403, code, message);
export const notFound = (message = 'Not found') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (message, code = 'CONFLICT') => new AppError(409, code, message);

// Codes raised by the database functions ("CODE: detail").
const DB_CODE_STATUS = {
  NOT_AUTHENTICATED: 401,
  FORBIDDEN: 403,
  DISCOUNT_NOT_AUTHORIZED: 403,
  SELF_MODIFICATION: 403,
  STOCK_WRITE_FORBIDDEN: 403,
  VALIDATION: 400,
  PAYMENT_INVALID: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  SETUP_ALREADY_CLAIMED: 409,
  SETUP_ALREADY_COMPLETED: 409,
  INSUFFICIENT_STOCK: 409,
  PRODUCT_UNAVAILABLE: 409,
  ALREADY_REFUNDED: 409,
  DUPLICATE_REQUEST: 409,
  IMMUTABLE_RECORD: 409,
  LAST_ADMIN: 409,
};

const UNIQUE_MESSAGES = {
  products_store_sku_key: 'A product with this SKU already exists',
  products_store_barcode_key: 'A product with this barcode already exists',
  categories_store_name_key: 'A category with this name already exists',
  profiles_email_lower_key: 'A user with this email already exists',
};

/** Converts PostgreSQL errors into AppErrors with safe messages. */
export function fromDatabaseError(err) {
  if (!err || typeof err !== 'object' || !('code' in err)) return null;
  if (err.code === 'P0001' && typeof err.message === 'string') {
    const match = err.message.match(/^([A-Z_]+)(?::\s*(.*))?$/s);
    if (match && DB_CODE_STATUS[match[1]]) {
      const code = match[1];
      const message = match[2] || code.replace(/_/g, ' ').toLowerCase();
      return new AppError(DB_CODE_STATUS[code], code, message.charAt(0).toUpperCase() + message.slice(1));
    }
  }
  switch (err.code) {
    case '23505':
      return conflict(UNIQUE_MESSAGES[err.constraint] || 'This record already exists', 'DUPLICATE');
    case '23503':
      return badRequest('A referenced record does not exist');
    case '23514':
    case '23502':
    case '22001':
    case '22003':
    case '22P02':
    case '22007':
    case '22008':
      return badRequest('Invalid value supplied');
    case '42501':
      return forbidden();
    default:
      return null;
  }
}
