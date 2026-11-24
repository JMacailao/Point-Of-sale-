import { firebaseAuth } from '../config/firebase.js';
import { env } from '../config/env.js';
import { withUser } from '../config/database.js';
import { loadAuthContext } from '../services/authContext.js';
import { unauthorized, forbidden } from '../utils/errors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Verifies the Firebase ID token with the Firebase Admin SDK and attaches the
 * trusted identity + authorization context. Nothing about the user (uid, role,
 * store) is taken from the request body.
 */
export function authenticate({ requireStore = true } = {}) {
  return async function authenticateMiddleware(req, _res, next) {
    const match = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '');
    if (!match) throw unauthorized();

    let decoded;
    try {
      decoded = await firebaseAuth().verifyIdToken(match[1], env.firebase.checkRevoked);
    } catch (err) {
      if (err?.code === 'auth/id-token-expired') throw unauthorized('Your session has expired. Please sign in again.', 'SESSION_EXPIRED');
      if (err?.code === 'auth/id-token-revoked') throw unauthorized('Your session was revoked. Please sign in again.', 'SESSION_REVOKED');
      if (err?.code === 'auth/user-disabled') throw forbidden('Your account has been deactivated.', 'ACCOUNT_INACTIVE');
      throw unauthorized('Invalid authentication token', 'TOKEN_INVALID');
    }

    const requestedStore = req.get('x-store-id');
    if (requestedStore && !UUID_RE.test(requestedStore)) throw forbidden('Invalid store', 'STORE_ACCESS_DENIED');

    const ctx = await loadAuthContext(decoded.uid, requestedStore || null);
    if (requireStore && !ctx.store) {
      throw forbidden('Store setup has not been completed yet', 'STORE_SETUP_REQUIRED');
    }

    req.firebaseUser = { uid: decoded.uid, email: decoded.email };
    req.auth = ctx;
    req.storeId = ctx.store?.id ?? null;
    req.db = (fn) => withUser(decoded.uid, fn);
    next();
  };
}
