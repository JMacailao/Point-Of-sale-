-- =============================================================================
-- ROLES, PERMISSIONS, IDENTITY HELPERS, AUDIT TRIGGERS
-- =============================================================================

insert into public.roles (key, name, description) values
  ('administrator', 'Administrator', 'Full system access'),
  ('cashier',       'Cashier',       'Processes sales and views own transactions');

insert into public.permissions (permission_key, module, description) values
  ('dashboard.view',    'dashboard', 'View dashboard'),
  ('pos.use',           'cashier',   'Use the cashier / POS screen'),
  ('products.view',     'products',  'View products and categories'),
  ('products.manage',   'products',  'Create, edit and archive products and categories'),
  ('inventory.view',    'inventory', 'View inventory and stock movements'),
  ('inventory.manage',  'inventory', 'Stock in, stock out and adjustments'),
  ('users.manage',      'users',     'Create users, assign roles, activate/deactivate'),
  ('sales.view_own',    'sales',     'View own sales transactions'),
  ('sales.view_all',    'sales',     'View all sales transactions'),
  ('sales.discount',    'sales',     'Apply discounts without limit'),
  ('sales.refund',      'sales',     'Refund completed sales'),
  ('expenses.view',     'expenses',  'View expenses'),
  ('expenses.manage',   'expenses',  'Record, edit and void expenses'),
  ('reports.view',      'reports',   'View revenue, profit and stock reports'),
  ('settings.manage',   'settings',  'Manage store and business settings'),
  ('audit.view',        'settings',  'View audit logs and user activity');

-- Administrator: everything
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.key = 'administrator';

-- Cashier: limited
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p
  on p.permission_key in ('dashboard.view','pos.use','products.view','sales.view_own')
where r.key = 'cashier';

-- -----------------------------------------------------------------------------
-- Identity helpers.
-- The verified Firebase UID arrives in request.jwt.claims (set by the backend
-- after Firebase Admin SDK verification, or by Supabase when Firebase is
-- configured as a third-party auth provider). It is never taken from a
-- function argument supplied by a client.
-- -----------------------------------------------------------------------------
create or replace function app.jwt_uid()
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', ''), '');
$$;

create or replace function app.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.profiles p
  where p.firebase_uid = app.jwt_uid() and p.is_active;
$$;

-- Stores in which the current user holds the given permission (active user,
-- active membership, active store).
create or replace function app.permitted_store_ids(p_permission text)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select sm.store_id
  from public.profiles p
  join public.store_members sm on sm.profile_id = p.id and sm.is_active
  join public.stores s on s.id = sm.store_id and s.is_active
  join public.role_permissions rp on rp.role_id = sm.role_id
  join public.permissions pe on pe.id = rp.permission_id
  where p.firebase_uid = app.jwt_uid()
    and p.is_active
    and pe.permission_key = p_permission;
$$;

create or replace function app.member_store_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select sm.store_id
  from public.profiles p
  join public.store_members sm on sm.profile_id = p.id and sm.is_active
  join public.stores s on s.id = sm.store_id and s.is_active
  where p.firebase_uid = app.jwt_uid() and p.is_active;
$$;

create or replace function app.has_permission(p_store_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from app.permitted_store_ids(p_permission) s where s = p_store_id);
$$;

-- Raises unless the current user holds the permission in the store.
create or replace function app.require_permission(p_store_id uuid, p_permission text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.current_profile_id();
begin
  if v_actor is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  if not app.has_permission(p_store_id, p_permission) then
    raise exception 'FORBIDDEN: missing permission %', p_permission using errcode = 'P0001';
  end if;
  return v_actor;
end;
$$;

-- -----------------------------------------------------------------------------
-- Audit logging
-- -----------------------------------------------------------------------------
create or replace function app.write_audit(
  p_store_id uuid, p_user_id uuid, p_action text, p_module text,
  p_record_id uuid, p_old jsonb, p_new jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_logs (store_id, user_id, action, module, record_id, old_values, new_values)
  values (p_store_id, p_user_id, p_action, p_module, p_record_id, p_old, p_new);
$$;

-- Row-level audit trigger for master data tables. The actor is resolved from
-- the verified JWT claims (falls back to app.actor_id for privileged
-- backend operations such as initial setup).
create or replace function app.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_store uuid;
  v_actor uuid;
  v_changed text[];
  v_action text := lower(tg_op);
begin
  if tg_op = 'UPDATE' then
    select array_agg(n.key) into v_changed
    from jsonb_each(v_new) n
    where n.value is distinct from (v_old -> n.key)
      and n.key not in ('updated_at');
    if v_changed is null then
      return new;
    end if;
    -- Stock changes are recorded in stock_movements; sequence changes are internal.
    if tg_table_name = 'products' and v_changed <@ array['stock_quantity'] then
      return new;
    end if;
    if tg_table_name = 'stores' and v_changed <@ array['sale_sequence'] then
      return new;
    end if;
    -- Only keep the changed columns to keep the log readable.
    select jsonb_object_agg(k, v_old -> k) into v_old from unnest(v_changed) k;
    select jsonb_object_agg(k, v_new -> k) into v_new from unnest(v_changed) k;
    if tg_table_name in ('products','expenses','store_members','profiles') and v_changed = array['is_active'] then
      v_action := case when (v_new ->> 'is_active')::boolean then 'activate' else 'deactivate' end;
    end if;
  end if;

  v_store := case tg_table_name
               when 'stores' then (v_row ->> 'id')::uuid
               when 'profiles' then null
               else (v_row ->> 'store_id')::uuid
             end;
  v_actor := coalesce(app.current_profile_id(),
                      nullif(current_setting('app.actor_id', true), '')::uuid);

  perform app.write_audit(v_store, v_actor, v_action, tg_table_name,
                          (v_row ->> 'id')::uuid, v_old, v_new);
  return coalesce(new, old);
end;
$$;

create trigger audit_stores        after insert or update or delete on public.stores        for each row execute function app.audit_row_change();
create trigger audit_store_members after insert or update or delete on public.store_members for each row execute function app.audit_row_change();
create trigger audit_profiles      after insert or update or delete on public.profiles      for each row execute function app.audit_row_change();
create trigger audit_categories    after insert or update or delete on public.categories    for each row execute function app.audit_row_change();
create trigger audit_products      after insert or update or delete on public.products      for each row execute function app.audit_row_change();
create trigger audit_expenses      after insert or update or delete on public.expenses      for each row execute function app.audit_row_change();
