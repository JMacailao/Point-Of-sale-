import { systemQuery } from '../config/database.js';
import { getSetupState, loadAuthContext, serializeContext } from '../services/authContext.js';
import { createFirebaseUser, deleteFirebaseUser } from '../services/firebaseUsers.js';
import { uploadImage, removeImageByUrl, BUCKETS } from '../services/storage.js';
import { writeAudit } from '../services/audit.js';
import { ok, created } from '../utils/http.js';
import { conflict, forbidden } from '../utils/errors.js';

/**
 * Public setup status, used only to decide which screen to show. It is NOT a
 * security control: administrator creation is protected by the atomic claim
 * in claim_initial_admin().
 */
export async function getStatus(_req, res) {
  const state = await getSetupState();
  let store = null;
  if (state.setupCompleted) {
    const { rows } = await systemQuery(
      'select store_name, logo_url from public.stores where is_active order by created_at limit 1');
    store = rows[0] || null;
  }
  ok(res, { adminClaimed: state.adminClaimed, setupCompleted: state.setupCompleted, store });
}

/**
 * Step 1: create the first administrator.
 * 1. Fast-fail if already claimed.  2. Create the Firebase account (Admin SDK).
 * 3. Atomically claim the admin slot in PostgreSQL.  4. If the claim loses a
 * race, delete the Firebase account that was just created.
 */
export async function initializeAdmin(req, res) {
  const { email, password, fullName } = req.body;

  const state = await getSetupState();
  if (state.adminClaimed) {
    throw conflict('The initial administrator has already been registered. Please sign in.', 'SETUP_ALREADY_CLAIMED');
  }

  const user = await createFirebaseUser({ email, password, displayName: fullName });
  let profileId;
  try {
    const { rows } = await systemQuery('select public.claim_initial_admin($1, $2, $3) as profile_id',
      [user.uid, email, fullName ?? null]);
    profileId = rows[0].profile_id;
  } catch (err) {
    await deleteFirebaseUser(user.uid);
    throw err;
  }

  await writeAudit({ userId: profileId, action: 'initialize_admin', module: 'setup', recordId: profileId,
    newValues: { email } });
  req.log?.info({ profileId }, 'initial administrator registered');
  created(res, { profileId, email });
}

/** Step 2: store information. Only the initial administrator, only once. */
export async function setupStore(req, res) {
  if (req.auth.setup.completed) {
    throw conflict('Store setup has already been completed', 'SETUP_ALREADY_COMPLETED');
  }
  if (!req.auth.setup.isInitialAdmin) {
    throw forbidden('Only the initial administrator can complete store setup');
  }

  const logo = await uploadImage(BUCKETS.storeAssets, 'logos', req.file);
  let storeId;
  try {
    storeId = await req.db(async (c) => {
      const { rows } = await c.query('select public.complete_store_setup($1) as id',
        [{ ...req.body, logo_url: logo?.url ?? null }]);
      return rows[0].id;
    });
  } catch (err) {
    if (logo) await removeImageByUrl(BUCKETS.storeAssets, logo.url);
    throw err;
  }

  const ctx = await loadAuthContext(req.firebaseUser.uid, storeId);
  ok(res, serializeContext(ctx));
}
