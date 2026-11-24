import { ok, created, pageMeta, pagination } from '../utils/http.js';
import { notFound, conflict, forbidden } from '../utils/errors.js';
import { hasPermission } from '../middleware/authorize.js';
import {
  createFirebaseUser, getFirebaseUserByEmail, deleteFirebaseUser, setFirebaseUserDisabled,
  generatePasswordSetupLink, generateTemporaryPassword,
} from '../services/firebaseUsers.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MEMBER_SELECT = `
  select p.id, p.email, p.full_name, p.is_active as profile_active, sm.is_active, r.key as role, r.name as role_name,
         sm.created_at as member_since, p.created_at,
         (select max(a.created_at) from public.audit_logs a where a.user_id = p.id and a.action = 'login') as last_login_at,
         (select count(*) from public.sales s where s.cashier_id = p.id and s.store_id = sm.store_id) as sales_count
    from public.store_members sm
    join public.profiles p on p.id = sm.profile_id
    join public.roles r on r.id = sm.role_id`;

async function fetchMember(client, storeId, profileId) {
  return (await client.query(`${MEMBER_SELECT} where sm.store_id = $1 and p.id = $2`, [storeId, profileId])).rows[0] || null;
}

export async function list(req, res) {
  const rows = await req.db(async (c) => (await c.query(
    `${MEMBER_SELECT} where sm.store_id = $1 order by sm.is_active desc, lower(coalesce(p.full_name, p.email))`,
    [req.storeId])).rows);
  ok(res, rows);
}

export async function getOne(req, res) {
  if (!UUID_RE.test(req.params.id)) throw notFound('User not found');
  const member = await req.db((c) => fetchMember(c, req.storeId, req.params.id));
  if (!member) throw notFound('User not found');
  ok(res, member);
}

/**
 * Creates a store user:
 * 1. Firebase account created by the Admin SDK (random password, never stored).
 * 2. Supabase profile + membership created atomically by create_store_member().
 * 3. A Firebase password setup link is returned for the administrator, and the
 *    frontend asks Firebase to email the user a password setup message.
 */
export async function create(req, res) {
  const { email, full_name: fullName, role } = req.body;

  let firebaseUser = await getFirebaseUserByEmail(email);
  let createdHere = false;
  if (firebaseUser) {
    // Only link an existing Firebase account whose email ownership is proven,
    // otherwise someone could pre-register another person's email.
    if (!firebaseUser.emailVerified) {
      throw conflict('A sign-in account with this email already exists but is not verified. Remove it in the Firebase console or use a different email.', 'EMAIL_EXISTS');
    }
  } else {
    firebaseUser = await createFirebaseUser({ email, password: generateTemporaryPassword(), displayName: fullName });
    createdHere = true;
  }

  let member;
  try {
    member = await req.db(async (c) => {
      const profileId = (await c.query('select public.create_store_member($1, $2, $3, $4, $5) as id',
        [req.storeId, firebaseUser.uid, email, fullName, role])).rows[0].id;
      return fetchMember(c, req.storeId, profileId);
    });
  } catch (err) {
    if (createdHere) await deleteFirebaseUser(firebaseUser.uid);
    throw err;
  }

  if (firebaseUser.disabled) await setFirebaseUserDisabled(firebaseUser.uid, false);
  const passwordSetupLink = createdHere ? await generatePasswordSetupLink(email) : null;
  created(res, { ...member, passwordSetupLink, existingAccount: !createdHere });
}

export async function update(req, res) {
  if (!UUID_RE.test(req.params.id)) throw notFound('User not found');
  const member = await req.db(async (c) => {
    await c.query('select public.update_store_member($1, $2, $3, $4, null)',
      [req.storeId, req.params.id, req.body.full_name ?? null, req.body.role ?? null]);
    return fetchMember(c, req.storeId, req.params.id);
  });
  ok(res, member);
}

export async function setStatus(req, res) {
  if (!UUID_RE.test(req.params.id)) throw notFound('User not found');
  const { result, member } = await req.db(async (c) => {
    const result = (await c.query('select public.update_store_member($1, $2, null, null, $3) as result',
      [req.storeId, req.params.id, req.body.is_active])).rows[0].result;
    return { result, member: await fetchMember(c, req.storeId, req.params.id) };
  });
  // Mirror the status in Firebase so a deactivated user cannot sign in at all
  // and their existing sessions are revoked.
  await setFirebaseUserDisabled(result.firebase_uid, !result.has_active_membership);
  ok(res, member);
}

export async function activity(req, res) {
  if (!UUID_RE.test(req.params.id)) throw notFound('User not found');
  if (!hasPermission(req, 'audit.view')) throw forbidden();
  const pg = pagination(req.query);
  const rows = await req.db(async (c) => (await c.query(
    `select count(*) over() as total_count, a.id, a.action, a.module, a.record_id, a.old_values, a.new_values, a.created_at
       from public.audit_logs a
      where a.user_id = $1 and (a.store_id = $2 or a.store_id is null)
      order by a.created_at desc, a.id
      limit $3 offset $4`, [req.params.id, req.storeId, pg.pageSize, pg.offset])).rows);
  const total = rows[0]?.total_count ?? 0;
  ok(res, rows.map(({ total_count: _t, ...r }) => r), pageMeta(pg, total));
}

export async function roles(req, res) {
  const rows = await req.db(async (c) => (await c.query(
    `select r.key, r.name, r.description,
            coalesce(array_agg(p.permission_key order by p.permission_key) filter (where p.id is not null), '{}') as permissions
       from public.roles r
       left join public.role_permissions rp on rp.role_id = r.id
       left join public.permissions p on p.id = rp.permission_id
      group by r.id order by r.name`)).rows);
  const permissions = await req.db(async (c) => (await c.query(
    'select permission_key, module, description from public.permissions order by module, permission_key')).rows);
  ok(res, { roles: rows, permissions });
}
