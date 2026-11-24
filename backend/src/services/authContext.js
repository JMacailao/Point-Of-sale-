import { systemQuery } from '../config/database.js';
import { forbidden } from '../utils/errors.js';

const STORE_COLUMNS = `s.id, s.store_name, s.store_address, s.contact_number, s.business_email, s.business_type,
  s.logo_url, s.currency, s.timezone, s.date_format, s.receipt_footer, s.receipt_paper, s.tax_enabled,
  s.tax_name, s.tax_rate, s.tax_inclusive, s.allow_cashier_discount, s.max_discount_percent,
  s.default_low_stock_threshold, s.low_stock_alerts, s.created_at, s.updated_at`;

export async function getSetupState() {
  const { rows } = await systemQuery(
    'select setup_completed, admin_claimed_at, initial_admin_profile_id from public.system_settings where singleton');
  const row = rows[0] || { setup_completed: false, admin_claimed_at: null, initial_admin_profile_id: null };
  return {
    setupCompleted: row.setup_completed,
    adminClaimed: Boolean(row.admin_claimed_at),
    initialAdminProfileId: row.initial_admin_profile_id,
  };
}

/**
 * Builds the authorization context for a verified Firebase UID: profile,
 * active store memberships, the selected store, role and permissions.
 */
export async function loadAuthContext(firebaseUid, requestedStoreId) {
  const { rows: profiles } = await systemQuery(
    'select id, firebase_uid, email, full_name, is_active, created_at from public.profiles where firebase_uid = $1',
    [firebaseUid]);
  const profile = profiles[0];
  if (!profile) {
    throw forbidden('This account is not registered in the POS system. Contact your administrator.', 'PROFILE_NOT_FOUND');
  }

  const setup = await getSetupState();
  const isInitialAdmin = setup.initialAdminProfileId === profile.id;

  if (!profile.is_active) {
    throw forbidden('Your account has been deactivated. Contact your administrator.', 'ACCOUNT_INACTIVE');
  }

  const { rows: memberships } = await systemQuery(
    `select ${STORE_COLUMNS}, r.key as role_key, r.name as role_name,
            coalesce(array_agg(pe.permission_key order by pe.permission_key)
                     filter (where pe.permission_key is not null), '{}') as permissions
       from public.store_members sm
       join public.stores s on s.id = sm.store_id and s.is_active
       join public.roles r on r.id = sm.role_id
       left join public.role_permissions rp on rp.role_id = r.id
       left join public.permissions pe on pe.id = rp.permission_id
      where sm.profile_id = $1 and sm.is_active
      group by s.id, r.key, r.name
      order by s.created_at`,
    [profile.id]);

  let current = null;
  if (requestedStoreId) {
    current = memberships.find((m) => m.id === requestedStoreId);
    if (!current) throw forbidden('You do not have access to this store', 'STORE_ACCESS_DENIED');
  } else {
    current = memberships[0] || null;
  }

  if (!current && !(isInitialAdmin && !setup.setupCompleted)) {
    throw forbidden('Your account is not assigned to an active store', 'NO_STORE_ACCESS');
  }

  const toStore = (m) => {
    if (!m) return null;
    const { role_key: _rk, role_name: _rn, permissions: _p, ...store } = m;
    return store;
  };

  return {
    profile,
    store: toStore(current),
    role: current ? { key: current.role_key, name: current.role_name } : null,
    permissions: current ? current.permissions : [],
    memberships: memberships.map((m) => ({ storeId: m.id, storeName: m.store_name, role: m.role_name })),
    setup: {
      completed: setup.setupCompleted,
      isInitialAdmin,
      pendingStoreSetup: isInitialAdmin && !setup.setupCompleted,
    },
  };
}

export function serializeContext(ctx) {
  return {
    user: {
      id: ctx.profile.id,
      email: ctx.profile.email,
      fullName: ctx.profile.full_name,
      isActive: ctx.profile.is_active,
    },
    store: ctx.store,
    role: ctx.role,
    permissions: ctx.permissions,
    memberships: ctx.memberships,
    setup: ctx.setup,
  };
}
