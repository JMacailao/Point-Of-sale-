import { forbidden } from '../utils/errors.js';

export function hasPermission(req, permission) {
  return Boolean(req.auth?.permissions?.includes(permission));
}

/** Requires ANY of the given permissions in the current store. */
export function requirePermission(...permissions) {
  return function requirePermissionMiddleware(req, _res, next) {
    if (!permissions.some((p) => hasPermission(req, p))) throw forbidden();
    next();
  };
}
