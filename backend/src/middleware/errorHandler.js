import { AppError, fromDatabaseError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export function notFoundHandler(_req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  let appErr = err instanceof AppError ? err : fromDatabaseError(err);

  if (!appErr && err?.type === 'entity.parse.failed') {
    appErr = new AppError(400, 'VALIDATION', 'Malformed JSON body');
  }
  if (!appErr && err?.type === 'entity.too.large') {
    appErr = new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  }
  if (!appErr) {
    (req.log || logger).error({ err }, 'unhandled error');
    appErr = new AppError(500, 'INTERNAL', 'An unexpected error occurred. Please try again.');
  } else if (appErr.status >= 500) {
    (req.log || logger).error({ err }, appErr.message);
  }

  const body = { error: { code: appErr.code, message: appErr.message } };
  if (appErr.details) body.error.details = appErr.details;
  res.status(appErr.status).json(body);
}
