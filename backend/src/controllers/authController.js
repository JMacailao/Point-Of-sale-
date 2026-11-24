import { serializeContext } from '../services/authContext.js';
import { writeAudit } from '../services/audit.js';
import { revokeSessions } from '../services/firebaseUsers.js';
import { ok } from '../utils/http.js';

/** Called right after Firebase sign-in: confirms the backend accepts the identity. */
export async function verify(req, res) {
  await writeAudit({ storeId: req.storeId, userId: req.auth.profile.id, action: 'login', module: 'auth',
    recordId: req.auth.profile.id });
  ok(res, serializeContext(req.auth));
}

export async function me(req, res) {
  ok(res, serializeContext(req.auth));
}

export async function logout(req, res) {
  if (req.body?.allDevices === true) {
    await revokeSessions(req.firebaseUser.uid);
  }
  await writeAudit({ storeId: req.storeId, userId: req.auth.profile.id, action: 'logout', module: 'auth',
    recordId: req.auth.profile.id, newValues: { allDevices: req.body?.allDevices === true } });
  ok(res, { loggedOut: true });
}

export async function updateProfile(req, res) {
  await req.db((c) => c.query('select public.update_my_profile($1)', [req.body.full_name]));
  ok(res, { fullName: req.body.full_name });
}
