import { systemQuery } from '../config/database.js';
import { logger } from '../utils/logger.js';

/** Writes an audit entry from trusted backend code (login/logout, etc.). */
export async function writeAudit({ storeId = null, userId = null, action, module, recordId = null, oldValues = null, newValues = null }) {
  try {
    await systemQuery('select app.write_audit($1, $2, $3, $4, $5, $6, $7)',
      [storeId, userId, action, module, recordId, oldValues, newValues]);
  } catch (err) {
    logger.error({ err }, 'failed to write audit log');
  }
}
