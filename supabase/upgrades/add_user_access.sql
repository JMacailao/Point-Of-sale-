-- =============================================================================
--  POS SYSTEM — UPGRADE: per-user access (tick what each user can use)
--
--  Only for databases installed BEFORE this feature (a fresh setup.sql
--  already includes it). Supabase > SQL Editor > paste this whole file > Run.
--  Safe to run more than once.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'claim_initial_admin_self') then
    raise exception 'The POS database is not installed in this project. Run supabase/setup.sql instead.';
  end if;
end;
$$;

-- ############################################################################
-- PART 9 — PER-USER ACCESS (checkboxes on each user)
-- ############################################################################
-- =============================================================================
-- An administrator can tick exactly which parts of the POS a non-administrator
-- may use (store_members.permissions). NULL means "use the role's defaults".
-- Administrators always have full access. User management, store settings
-- and the audit log stay administrator-only so staff can never grant
-- themselves more access. Every permission check (row level security and all
-- functions) goes through app.permitted_store_ids, so ticks are enforced by
-- the database, not only hidden in the app.
-- =============================================================================

alter table public.store_members add column if not exists permissions text[];

-- Permissions an administrator may tick for a non-administrator.
create or replace function app.assignable_permissions()
returns text[] language sql immutable set search_path = '' as $$
  select array['pos.use','dashboard.view','products.view','products.manage','inventory.view','inventory.manage',
               'sales.view_own','sales.view_all','sales.discount','sales.refund','expenses.view','expenses.manage',
               'reports.view','menu.manage']::text[];
$$;

-- Effective permissions of a membership: the custom ticks, or the role's defaults.
create or replace function app.member_permissions(p_role_id uuid, p_custom text[])
returns text[] language sql stable security definer set search_path = '' as $$
  select case when p_custom is not null and r.key <> 'administrator' then
           array(select x from unnest(p_custom) x order by x)
         else array(select pe.permission_key from public.role_permissions rp
                    join public.permissions pe on pe.id = rp.permission_id
                    where rp.role_id = p_role_id order by pe.permission_key) end
    from public.roles r where r.id = p_role_id;
$$;

create or replace function app.permitted_store_ids(p_permission text)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select sm.store_id
  from public.profiles p
  join public.store_members sm on sm.profile_id = p.id and sm.is_active
  join public.stores s on s.id = sm.store_id and s.is_active
  where p.firebase_uid = app.jwt_uid()
    and p.is_active
    and p_permission = any(app.member_permissions(sm.role_id, sm.permissions));
$$;

create or replace function public.get_my_context(p_store_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid      text := app.jwt_uid();
  v_profile  public.profiles%rowtype;
  v_settings public.system_settings%rowtype;
  v_store    uuid;
  v_members  jsonb;
  v_current  record;
  v_is_init  boolean;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED: please sign in' using errcode = 'P0001';
  end if;
  select * into v_profile from public.profiles where firebase_uid = v_uid;
  if not found then
    raise exception 'PROFILE_NOT_FOUND: this account is not registered in the POS system. Contact your administrator.'
      using errcode = 'P0001';
  end if;
  if not v_profile.is_active then
    raise exception 'ACCOUNT_INACTIVE: your account has been deactivated. Contact your administrator.'
      using errcode = 'P0001';
  end if;
  select * into v_settings from public.system_settings where singleton;
  v_is_init := v_settings.initial_admin_profile_id = v_profile.id;

  select coalesce(jsonb_agg(jsonb_build_object('storeId', s.id, 'storeName', s.store_name, 'role', r.name)
                            order by s.created_at), '[]'::jsonb)
    into v_members
    from public.store_members sm
    join public.stores s on s.id = sm.store_id and s.is_active
    join public.roles r on r.id = sm.role_id
   where sm.profile_id = v_profile.id and sm.is_active;

  if p_store_id is not null then
    if not exists (select 1 from jsonb_array_elements(v_members) m where (m ->> 'storeId')::uuid = p_store_id) then
      raise exception 'STORE_ACCESS_DENIED: you do not have access to this store' using errcode = 'P0001';
    end if;
    v_store := p_store_id;
  else
    v_store := (v_members -> 0 ->> 'storeId')::uuid;
  end if;

  if v_store is null and not (v_is_init and not v_settings.setup_completed) then
    raise exception 'NO_STORE_ACCESS: your account is not assigned to an active store' using errcode = 'P0001';
  end if;

  select to_jsonb(s) - 'sale_sequence' - 'created_by' as store, r.key as role_key, r.name as role_name,
         to_jsonb(app.member_permissions(sm.role_id, sm.permissions)) as permissions
    into v_current
    from public.stores s
    join public.store_members sm on sm.store_id = s.id and sm.profile_id = v_profile.id
    join public.roles r on r.id = sm.role_id
   where s.id = v_store;

  return jsonb_build_object(
    'user', jsonb_build_object('id', v_profile.id, 'email', v_profile.email, 'fullName', v_profile.full_name,
                               'isActive', v_profile.is_active),
    'store', v_current.store,
    'role', case when v_current.role_key is null then null
                 else jsonb_build_object('key', v_current.role_key, 'name', v_current.role_name) end,
    'permissions', coalesce(v_current.permissions, '[]'::jsonb),
    'memberships', v_members,
    'setup', jsonb_build_object('completed', v_settings.setup_completed, 'isInitialAdmin', v_is_init,
                                'pendingStoreSetup', v_is_init and not v_settings.setup_completed));
end;
$$;

create or replace function public.list_members(p_store_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
begin
  perform app.require_permission(p_store_id, 'users.manage');
  return coalesce((select jsonb_agg(r order by r.is_active desc, lower(coalesce(r.full_name, r.email))) from (
    select p.id, p.email, p.full_name, sm.is_active, r.key as role, r.name as role_name,
           to_jsonb(app.member_permissions(sm.role_id, sm.permissions)) as permissions,
           (sm.permissions is not null and r.key <> 'administrator') as custom_access,
           sm.created_at as member_since,
           (select max(a.created_at) from public.audit_logs a where a.user_id = p.id and a.action = 'login') as last_login_at,
           (select count(*) from public.sales s where s.cashier_id = p.id and s.store_id = sm.store_id) as sales_count
      from public.store_members sm
      join public.profiles p on p.id = sm.profile_id
      join public.roles r on r.id = sm.role_id
     where sm.store_id = p_store_id) r), '[]'::jsonb);
end;
$$;

-- Sets the ticked access of a non-administrator (NULL = role defaults).
-- "Manage" ticks include the matching "view".
create or replace function public.set_member_access(p_store_id uuid, p_profile_id uuid, p_permissions text[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor  uuid := app.require_permission(p_store_id, 'users.manage');
  v_member public.store_members%rowtype;
  v_role   text;
  v_bad    text;
  v_perms  text[];
begin
  select sm.* into v_member from public.store_members sm where sm.store_id = p_store_id and sm.profile_id = p_profile_id for update;
  if not found then perform app.raise('NOT_FOUND: user is not a member of this store'); end if;
  select key into v_role from public.roles where id = v_member.role_id;
  if v_role = 'administrator' then perform app.raise('VALIDATION: administrators always have full access'); end if;

  if p_permissions is not null then
    select x into v_bad from unnest(p_permissions) x where not (x = any(app.assignable_permissions())) limit 1;
    if v_bad is not null then perform app.raise(format('VALIDATION: this access cannot be given: %s', v_bad)); end if;
    select array(select distinct x from unnest(p_permissions || array(
             select replace(m, '.manage', '.view') from unnest(p_permissions) m where m like '%.manage' and m <> 'menu.manage')) x
           order by x) into v_perms;
    if cardinality(v_perms) = 0 then perform app.raise('VALIDATION: tick at least one area'); end if;
  end if;

  update public.store_members set permissions = v_perms where id = v_member.id;
  perform app.write_audit(p_store_id, v_actor, 'access_update', 'store_members', p_profile_id,
    jsonb_build_object('permissions', v_member.permissions), jsonb_build_object('permissions', v_perms));
  return to_jsonb(app.member_permissions(v_member.role_id, v_perms));
end;
$$;

revoke all on function app.assignable_permissions(), app.member_permissions(uuid, text[]),
  public.set_member_access(uuid, uuid, text[]) from public;
grant execute on function app.assignable_permissions(), app.member_permissions(uuid, text[]) to anon, authenticated, service_role;
grant execute on function public.set_member_access(uuid, uuid, text[]), public.get_my_context(uuid), public.list_members(uuid)
  to anon, authenticated;
