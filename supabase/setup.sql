-- =============================================================================
--  POS SYSTEM — COMPLETE DATABASE SETUP (single file)
--
--  HOW TO USE
--    Supabase dashboard > SQL Editor > New query > paste this whole file > Run.
--    Run it ONCE on a fresh project.
--
--  Before using the app also enable:
--    Supabase > Authentication > Sign In / Providers > Third-Party Auth >
--    Add provider > Firebase > Project ID: pointofsale-c6771
--
--  Contents
--    1. Schema (tables, constraints, indexes, triggers)
--    2. Roles, permissions, identity helpers, audit logging
--    3. Business functions (setup, sales, refunds, stock, users, reports)
--    4. Row level security & privileges
--    5. Storage buckets
--    6. Browser access (Firebase token -> Supabase), app RPC functions, storage policies
--    7. Today's Menu (shareable public menu link)
--    8. Self-service registration (new account + new store)
-- =============================================================================


-- ############################################################################
-- PRE-CHECK: stop with a clear message (changing nothing) if this project
-- already has the POS database or other tables with the same names.
-- ############################################################################
do $$
declare
  v_existing text;
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'claim_initial_admin_self') then
    raise exception 'The POS database is ALREADY INSTALLED in this project — nothing to do. Continue with the next step (Authentication > Third-Party Auth > Firebase). To wipe it and start over, run supabase/reset.sql first (this deletes all POS data).';
  end if;
  select string_agg(table_name, ', ' order by table_name) into v_existing
    from information_schema.tables
   where table_schema = 'public'
     and table_name in ('system_settings','profiles','roles','permissions','role_permissions','stores','store_members',
                        'categories','products','sales','sale_items','payments','stock_movements','expenses','audit_logs',
                        'menu_links','daily_menus');
  if v_existing is not null then
    raise exception 'This Supabase project already has tables with the same names as the POS tables: %. They probably belong to another app. Use a NEW, empty Supabase project (recommended), or — only if that data is not needed — run supabase/reset.sql first, which DELETES these tables.', v_existing;
  end if;
end;
$$;

-- ############################################################################
-- PART 1 — schema
-- ############################################################################
-- =============================================================================
-- POS SYSTEM — CORE SCHEMA
-- Identity: Firebase Authentication (firebase_uid). No passwords are stored here.
-- Database: Supabase PostgreSQL. Every business record is scoped by store_id.
-- =============================================================================

-- gen_random_uuid() is built into PostgreSQL 13+. pg_trgm powers fast ILIKE search.
-- On Supabase, extensions live in the "extensions" schema.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'extensions') then
    create extension if not exists pg_trgm with schema extensions;
  else
    create extension if not exists pg_trgm;
  end if;
end;
$$;

-- Private schema for helper functions (not exposed through the Supabase API).
create schema if not exists app;

-- New functions must not be executable by PUBLIC unless explicitly granted.
alter default privileges revoke execute on functions from public;

-- -----------------------------------------------------------------------------
-- Generic updated_at trigger
-- -----------------------------------------------------------------------------
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- SYSTEM
-- -----------------------------------------------------------------------------
create table public.system_settings (
  id                        uuid primary key default gen_random_uuid(),
  singleton                 boolean not null default true unique check (singleton),
  setup_completed           boolean not null default false,
  admin_claimed_at          timestamptz,
  initial_admin_profile_id  uuid,
  initialized_at            timestamptz,
  created_at                timestamptz not null default now(),
  constraint setup_requires_admin check (not setup_completed or initial_admin_profile_id is not null)
);

insert into public.system_settings (singleton) values (true);

-- -----------------------------------------------------------------------------
-- IDENTITY / PROFILES
-- -----------------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key default gen_random_uuid(),
  firebase_uid  text not null unique check (length(firebase_uid) between 1 and 128),
  full_name     text check (full_name is null or length(full_name) <= 120),
  email         text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index profiles_email_lower_key on public.profiles (lower(email));
create trigger profiles_touch before update on public.profiles
  for each row execute function app.touch_updated_at();

alter table public.system_settings
  add constraint system_settings_admin_fk foreign key (initial_admin_profile_id)
  references public.profiles(id);

-- -----------------------------------------------------------------------------
-- ROLES & PERMISSIONS
-- -----------------------------------------------------------------------------
create table public.roles (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique check (key ~ '^[a-z_]+$'),
  name        text not null unique,
  description text,
  created_at  timestamptz not null default now()
);

create table public.permissions (
  id              uuid primary key default gen_random_uuid(),
  permission_key  text not null unique check (permission_key ~ '^[a-z_]+\.[a-z_]+$'),
  module          text not null,
  description     text not null
);

create table public.role_permissions (
  id            uuid primary key default gen_random_uuid(),
  role_id       uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  unique (role_id, permission_id)
);

-- -----------------------------------------------------------------------------
-- STORES
-- -----------------------------------------------------------------------------
create table public.stores (
  id                           uuid primary key default gen_random_uuid(),
  store_name                   text not null check (length(btrim(store_name)) between 1 and 120),
  store_address                text check (store_address is null or length(store_address) <= 300),
  contact_number               text check (contact_number is null or length(contact_number) <= 40),
  business_email               text check (business_email is null or business_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  business_type                text check (business_type is null or business_type in
                                 ('retail','grocery','convenience','restaurant','school_canteen','pharmacy','other')),
  logo_url                     text,
  currency                     text not null default 'PHP' check (currency ~ '^[A-Z]{3}$'),
  timezone                     text not null default 'Asia/Manila',
  date_format                  text not null default 'DD/MM/YYYY'
                                 check (date_format in ('DD/MM/YYYY','MM/DD/YYYY','YYYY-MM-DD')),
  receipt_footer               text check (receipt_footer is null or length(receipt_footer) <= 300),
  receipt_paper                text not null default '80mm' check (receipt_paper in ('58mm','80mm','a4')),
  -- Tax settings
  tax_enabled                  boolean not null default false,
  tax_name                     text not null default 'VAT' check (length(tax_name) between 1 and 20),
  tax_rate                     numeric(5,2) not null default 12 check (tax_rate between 0 and 100),
  tax_inclusive                boolean not null default true,
  -- Discount settings
  allow_cashier_discount       boolean not null default false,
  max_discount_percent         numeric(5,2) not null default 20 check (max_discount_percent between 0 and 100),
  -- Inventory settings
  default_low_stock_threshold  integer not null default 5 check (default_low_stock_threshold between 0 and 1000000),
  low_stock_alerts             boolean not null default true,
  -- Internal transaction counter (only modified by process_sale)
  sale_sequence                bigint not null default 0,
  is_active                    boolean not null default true,
  created_by                   uuid references public.profiles(id),
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now()
);
create trigger stores_touch before update on public.stores
  for each row execute function app.touch_updated_at();

create table public.store_members (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.stores(id) on delete restrict,
  profile_id  uuid not null references public.profiles(id) on delete restrict,
  role_id     uuid not null references public.roles(id),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (store_id, profile_id)
);
create index store_members_profile_idx on public.store_members (profile_id);
create trigger store_members_touch before update on public.store_members
  for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- CATALOG
-- -----------------------------------------------------------------------------
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.stores(id) on delete restrict,
  name        text not null check (length(btrim(name)) between 1 and 80),
  description text check (description is null or length(description) <= 300),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index categories_store_name_key on public.categories (store_id, lower(name));
create trigger categories_touch before update on public.categories
  for each row execute function app.touch_updated_at();

create table public.products (
  id              uuid primary key default gen_random_uuid(),
  store_id        uuid not null references public.stores(id) on delete restrict,
  category_id     uuid references public.categories(id) on delete set null,
  name            text not null check (length(btrim(name)) between 1 and 160),
  sku             text check (sku is null or length(sku) between 1 and 64),
  barcode         text check (barcode is null or length(barcode) between 1 and 64),
  description     text check (description is null or length(description) <= 1000),
  image_url       text,
  cost_price      numeric(12,2) not null default 0 check (cost_price >= 0),
  selling_price   numeric(12,2) not null check (selling_price >= 0),
  stock_quantity  integer not null default 0 check (stock_quantity >= 0),
  minimum_stock   integer not null default 0 check (minimum_stock >= 0),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index products_store_sku_key on public.products (store_id, lower(sku)) where sku is not null;
create unique index products_store_barcode_key on public.products (store_id, barcode) where barcode is not null;
create index products_store_active_idx on public.products (store_id, is_active, name);
create index products_category_idx on public.products (category_id);
create index products_name_trgm_idx on public.products using gin (name gin_trgm_ops);
create trigger products_touch before update on public.products
  for each row execute function app.touch_updated_at();

-- Stock may only change through the stock functions, which always write a movement.
create or replace function app.guard_stock_quantity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.allow_stock_write', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' and new.stock_quantity <> 0 then
    raise exception 'STOCK_WRITE_FORBIDDEN: stock must be added through a stock movement'
      using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and new.stock_quantity is distinct from old.stock_quantity then
    raise exception 'STOCK_WRITE_FORBIDDEN: stock must be changed through a stock movement'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger products_guard_stock before insert or update on public.products
  for each row execute function app.guard_stock_quantity();

-- -----------------------------------------------------------------------------
-- SALES
-- -----------------------------------------------------------------------------
create table public.sales (
  id                  uuid primary key default gen_random_uuid(),
  store_id            uuid not null references public.stores(id) on delete restrict,
  transaction_number  text not null,
  client_request_id   uuid not null,
  cashier_id          uuid not null references public.profiles(id),
  subtotal            numeric(12,2) not null check (subtotal >= 0),
  discount_type       text not null default 'none' check (discount_type in ('none','amount','percent')),
  discount_value      numeric(12,2) not null default 0 check (discount_value >= 0),
  discount            numeric(12,2) not null default 0 check (discount >= 0),
  tax_amount          numeric(12,2) not null default 0 check (tax_amount >= 0),
  tax_inclusive       boolean not null default true,
  total_amount        numeric(12,2) not null check (total_amount >= 0),
  payment_method      text not null check (payment_method in ('cash','gcash','maya','other')),
  amount_received     numeric(12,2) not null check (amount_received >= 0),
  change_amount       numeric(12,2) not null check (change_amount >= 0),
  status              text not null default 'completed' check (status in ('completed','refunded')),
  refunded_at         timestamptz,
  refunded_by         uuid references public.profiles(id),
  refund_reason       text,
  created_at          timestamptz not null default now(),
  unique (store_id, transaction_number),
  unique (store_id, client_request_id),
  constraint sales_discount_le_subtotal check (discount <= subtotal),
  constraint sales_received_covers_total check (amount_received >= total_amount),
  constraint sales_change_consistent check (change_amount = amount_received - total_amount),
  constraint sales_refund_consistent check (
    (status = 'refunded') = (refunded_at is not null and refunded_by is not null))
);
create index sales_store_created_idx on public.sales (store_id, created_at desc);
create index sales_store_cashier_idx on public.sales (store_id, cashier_id, created_at desc);
create index sales_txn_trgm_idx on public.sales using gin (transaction_number gin_trgm_ops);

create table public.sale_items (
  id            uuid primary key default gen_random_uuid(),
  sale_id       uuid not null references public.sales(id) on delete restrict,
  store_id      uuid not null references public.stores(id) on delete restrict,
  product_id    uuid not null references public.products(id) on delete restrict,
  product_name  text not null,
  sku           text,
  quantity      integer not null check (quantity > 0),
  unit_price    numeric(12,2) not null check (unit_price >= 0),
  cost_price    numeric(12,2) not null check (cost_price >= 0),
  subtotal      numeric(12,2) not null,
  constraint sale_items_subtotal_consistent check (subtotal = quantity * unit_price)
);
create index sale_items_sale_idx on public.sale_items (sale_id);
create index sale_items_product_idx on public.sale_items (product_id);

create table public.payments (
  id                uuid primary key default gen_random_uuid(),
  sale_id           uuid not null references public.sales(id) on delete restrict,
  store_id          uuid not null references public.stores(id) on delete restrict,
  kind              text not null default 'payment' check (kind in ('payment','refund')),
  payment_method    text not null check (payment_method in ('cash','gcash','maya','other')),
  amount            numeric(12,2) not null,
  reference_number  text check (reference_number is null or length(reference_number) <= 64),
  created_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  constraint payments_sign check ((kind = 'payment' and amount >= 0) or (kind = 'refund' and amount <= 0))
);
create index payments_sale_idx on public.payments (sale_id);

-- -----------------------------------------------------------------------------
-- INVENTORY
-- -----------------------------------------------------------------------------
create table public.stock_movements (
  id                 uuid primary key default gen_random_uuid(),
  store_id           uuid not null references public.stores(id) on delete restrict,
  product_id         uuid not null references public.products(id) on delete restrict,
  movement_type      text not null check (movement_type in ('stock_in','stock_out','sale','return','adjustment')),
  previous_quantity  integer not null,
  quantity_changed   integer not null check (quantity_changed <> 0),
  new_quantity       integer not null check (new_quantity >= 0),
  reason             text check (reason is null or length(reason) <= 300),
  reference_id       uuid,
  performed_by       uuid not null references public.profiles(id),
  created_at         timestamptz not null default now(),
  constraint stock_movements_math check (new_quantity = previous_quantity + quantity_changed)
);
create index stock_movements_store_created_idx on public.stock_movements (store_id, created_at desc);
create index stock_movements_product_idx on public.stock_movements (product_id, created_at desc);

-- -----------------------------------------------------------------------------
-- EXPENSES
-- -----------------------------------------------------------------------------
create table public.expenses (
  id                uuid primary key default gen_random_uuid(),
  store_id          uuid not null references public.stores(id) on delete restrict,
  description       text not null check (length(btrim(description)) between 1 and 200),
  category          text not null check (category in
                      ('rent','utilities','supplies','salaries','transportation','maintenance','other')),
  amount            numeric(12,2) not null check (amount > 0),
  expense_date      date not null default current_date,
  payment_method    text not null default 'cash' check (payment_method in ('cash','gcash','maya','bank_transfer','other')),
  reference_number  text check (reference_number is null or length(reference_number) <= 64),
  notes             text check (notes is null or length(notes) <= 1000),
  recorded_by       uuid not null references public.profiles(id),
  is_voided         boolean not null default false,
  voided_at         timestamptz,
  voided_by         uuid references public.profiles(id),
  void_reason       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint expenses_void_consistent check (is_voided = (voided_at is not null))
);
create index expenses_store_date_idx on public.expenses (store_id, expense_date desc);
create trigger expenses_touch before update on public.expenses
  for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- AUDIT
-- -----------------------------------------------------------------------------
create table public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid references public.stores(id) on delete restrict,
  user_id     uuid references public.profiles(id),
  action      text not null,
  module      text not null,
  record_id   uuid,
  old_values  jsonb,
  new_values  jsonb,
  created_at  timestamptz not null default now()
);
create index audit_logs_store_created_idx on public.audit_logs (store_id, created_at desc);
create index audit_logs_user_idx on public.audit_logs (user_id, created_at desc);
create index audit_logs_record_idx on public.audit_logs (module, record_id);

-- Financial and audit history is append-only: no deletes, and no edits to the
-- immutable tables.
create or replace function app.forbid_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'IMMUTABLE_RECORD: % on % is not allowed', tg_op, tg_table_name
    using errcode = 'P0001';
end;
$$;

create trigger audit_logs_immutable before update or delete on public.audit_logs
  for each row execute function app.forbid_change();
create trigger stock_movements_immutable before update or delete on public.stock_movements
  for each row execute function app.forbid_change();
create trigger sale_items_immutable before update or delete on public.sale_items
  for each row execute function app.forbid_change();
create trigger payments_immutable before update or delete on public.payments
  for each row execute function app.forbid_change();
create trigger sales_no_delete before delete on public.sales
  for each row execute function app.forbid_change();
create trigger expenses_no_delete before delete on public.expenses
  for each row execute function app.forbid_change();

-- A completed sale may only transition to "refunded" (via refund_sale); amounts are frozen.
create or replace function app.guard_sale_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.store_id, new.transaction_number, new.client_request_id, new.cashier_id, new.subtotal,
      new.discount_type, new.discount_value, new.discount, new.tax_amount, new.total_amount,
      new.payment_method, new.amount_received, new.change_amount, new.created_at)
     is distinct from
     (old.store_id, old.transaction_number, old.client_request_id, old.cashier_id, old.subtotal,
      old.discount_type, old.discount_value, old.discount, old.tax_amount, old.total_amount,
      old.payment_method, old.amount_received, old.change_amount, old.created_at) then
    raise exception 'IMMUTABLE_RECORD: completed sale amounts cannot be modified' using errcode = 'P0001';
  end if;
  if old.status = 'refunded' then
    raise exception 'IMMUTABLE_RECORD: refunded sale cannot be modified' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger sales_guard_update before update on public.sales
  for each row execute function app.guard_sale_update();

-- ############################################################################
-- PART 2 — rbac_and_identity
-- ############################################################################
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

-- ############################################################################
-- PART 3 — business_functions
-- ############################################################################
-- =============================================================================
-- BUSINESS FUNCTIONS
--
-- Error convention: exceptions are raised with errcode P0001 and a message of
-- the form "CODE: human readable detail". The backend maps CODE to an HTTP
-- status code.
--
-- Every function that changes data derives the acting user from the verified
-- JWT claims (app.current_profile_id()). No function trusts a user id, role or
-- price supplied by the client.
-- =============================================================================

-- Validate time zones on stores.
create or replace function app.validate_store()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'VALIDATION: invalid time zone %', new.timezone using errcode = 'P0001';
  end if;
  new.store_name := btrim(new.store_name);
  return new;
end;
$$;
create trigger stores_validate before insert or update on public.stores
  for each row execute function app.validate_store();

-- -----------------------------------------------------------------------------
-- INITIAL SETUP
-- -----------------------------------------------------------------------------

-- Atomically claims the initial administrator slot. Only callable by the
-- trusted backend (service role); the Firebase UID passed here comes from an
-- account the backend itself just created with the Firebase Admin SDK.
-- The conditional UPDATE takes a row lock on the singleton settings row, so if
-- two requests race, the second one re-checks admin_claimed_at after the first
-- commits and fails with SETUP_ALREADY_CLAIMED.
create or replace function public.claim_initial_admin(p_firebase_uid text, p_email text, p_full_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings_id uuid;
  v_profile_id uuid := gen_random_uuid();
begin
  if coalesce(btrim(p_firebase_uid), '') = '' or coalesce(btrim(p_email), '') = '' then
    raise exception 'VALIDATION: firebase uid and email are required' using errcode = 'P0001';
  end if;

  update public.system_settings
     set admin_claimed_at = now()
   where singleton and admin_claimed_at is null and not setup_completed
  returning id into v_settings_id;

  if v_settings_id is null then
    raise exception 'SETUP_ALREADY_CLAIMED: the initial administrator has already been registered'
      using errcode = 'P0001';
  end if;

  perform set_config('app.actor_id', v_profile_id::text, true);

  insert into public.profiles (id, firebase_uid, email, full_name)
  values (v_profile_id, btrim(p_firebase_uid), lower(btrim(p_email)), nullif(btrim(coalesce(p_full_name, '')), ''));

  update public.system_settings set initial_admin_profile_id = v_profile_id where id = v_settings_id;

  return v_profile_id;
end;
$$;

-- Creates the store for the initial administrator and completes setup.
-- Callable only by the initial administrator (identity from JWT claims).
create or replace function public.complete_store_setup(p_store jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.current_profile_id();
  v_settings public.system_settings%rowtype;
  v_store_id uuid;
  v_admin_role uuid;
begin
  if v_actor is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  select * into v_settings from public.system_settings where singleton for update;

  if v_settings.setup_completed then
    raise exception 'SETUP_ALREADY_COMPLETED: store setup has already been completed' using errcode = 'P0001';
  end if;
  if v_settings.initial_admin_profile_id is distinct from v_actor then
    raise exception 'FORBIDDEN: only the initial administrator can complete store setup' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_store ->> 'store_name'), '') = '' then
    raise exception 'VALIDATION: store name is required' using errcode = 'P0001';
  end if;

  insert into public.stores (
    store_name, store_address, contact_number, business_email, business_type, logo_url,
    currency, timezone, date_format, receipt_footer, created_by)
  values (
    btrim(p_store ->> 'store_name'),
    nullif(btrim(coalesce(p_store ->> 'store_address', '')), ''),
    nullif(btrim(coalesce(p_store ->> 'contact_number', '')), ''),
    nullif(lower(btrim(coalesce(p_store ->> 'business_email', ''))), ''),
    nullif(btrim(coalesce(p_store ->> 'business_type', '')), ''),
    nullif(btrim(coalesce(p_store ->> 'logo_url', '')), ''),
    coalesce(nullif(p_store ->> 'currency', ''), 'PHP'),
    coalesce(nullif(p_store ->> 'timezone', ''), 'Asia/Manila'),
    coalesce(nullif(p_store ->> 'date_format', ''), 'DD/MM/YYYY'),
    nullif(btrim(coalesce(p_store ->> 'receipt_footer', '')), ''),
    v_actor)
  returning id into v_store_id;

  select id into v_admin_role from public.roles where key = 'administrator';
  insert into public.store_members (store_id, profile_id, role_id) values (v_store_id, v_actor, v_admin_role);

  update public.system_settings
     set setup_completed = true, initialized_at = now()
   where id = v_settings.id;

  return v_store_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- SALES
-- -----------------------------------------------------------------------------
create or replace function public.process_sale(
  p_store_id          uuid,
  p_client_request_id uuid,
  p_items             jsonb,
  p_discount_type     text    default 'none',
  p_discount_value    numeric default 0,
  p_payment_method    text    default 'cash',
  p_amount_received   numeric default null,
  p_reference_number  text    default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor        uuid;
  v_store        public.stores%rowtype;
  v_existing     public.sales%rowtype;
  v_line         record;
  v_prod         public.products%rowtype;
  v_lines        jsonb := '[]'::jsonb;
  v_l            jsonb;
  v_subtotal     numeric(12,2) := 0;
  v_discount     numeric(12,2) := 0;
  v_discount_pct numeric;
  v_taxable      numeric(12,2);
  v_tax          numeric(12,2) := 0;
  v_total        numeric(12,2);
  v_received     numeric(12,2);
  v_ref          text := nullif(btrim(coalesce(p_reference_number, '')), '');
  v_type         text := coalesce(p_discount_type, 'none');
  v_value        numeric := coalesce(p_discount_value, 0);
  v_seq          bigint;
  v_txn          text;
  v_sale_id      uuid;
begin
  v_actor := app.require_permission(p_store_id, 'pos.use');

  -- ---- Input validation ----------------------------------------------------
  if p_client_request_id is null then
    raise exception 'VALIDATION: client_request_id is required' using errcode = 'P0001';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'VALIDATION: the cart is empty' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) > 300 then
    raise exception 'VALIDATION: too many cart lines' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) e
    where case
      when jsonb_typeof(e) <> 'object' then true
      when jsonb_typeof(e -> 'product_id') is distinct from 'string' then true
      when jsonb_typeof(e -> 'quantity') is distinct from 'number' then true
      when (e ->> 'product_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then true
      when (e ->> 'quantity')::numeric <> trunc((e ->> 'quantity')::numeric) then true
      when (e ->> 'quantity')::numeric not between 1 and 100000 then true
      else false end) then
    raise exception 'VALIDATION: invalid cart item' using errcode = 'P0001';
  end if;
  if v_type not in ('none','amount','percent') then
    raise exception 'VALIDATION: invalid discount type' using errcode = 'P0001';
  end if;
  if v_value < 0 or v_value <> round(v_value, 2) then
    raise exception 'VALIDATION: invalid discount value' using errcode = 'P0001';
  end if;
  if p_payment_method is null or p_payment_method not in ('cash','gcash','maya','other') then
    raise exception 'VALIDATION: invalid payment method' using errcode = 'P0001';
  end if;
  if p_amount_received is not null and (p_amount_received < 0 or p_amount_received <> round(p_amount_received, 2)
                                        or p_amount_received > 99999999) then
    raise exception 'PAYMENT_INVALID: invalid amount received' using errcode = 'P0001';
  end if;
  if v_ref is not null and length(v_ref) > 64 then
    raise exception 'VALIDATION: reference number is too long' using errcode = 'P0001';
  end if;

  -- ---- Serialize per store (sequence + idempotency) ------------------------
  select * into v_store from public.stores where id = p_store_id and is_active for update;
  if not found then
    raise exception 'NOT_FOUND: store not found' using errcode = 'P0001';
  end if;

  select * into v_existing from public.sales
   where store_id = p_store_id and client_request_id = p_client_request_id;
  if found then
    if v_existing.cashier_id <> v_actor then
      raise exception 'DUPLICATE_REQUEST: this request id was already used' using errcode = 'P0001';
    end if;
    return jsonb_build_object('sale_id', v_existing.id,
                              'transaction_number', v_existing.transaction_number,
                              'duplicate', true);
  end if;

  -- ---- Lock products (stable order avoids deadlocks) and price from DB -----
  for v_line in
    select (e ->> 'product_id')::uuid as product_id, sum((e ->> 'quantity')::int)::int as qty
    from jsonb_array_elements(p_items) e
    group by 1
    order by 1
  loop
    select * into v_prod from public.products
     where id = v_line.product_id and store_id = p_store_id
     for update;
    if not found or not v_prod.is_active then
      raise exception 'PRODUCT_UNAVAILABLE: a product in the cart is no longer available' using errcode = 'P0001';
    end if;
    if v_prod.stock_quantity < v_line.qty then
      raise exception 'INSUFFICIENT_STOCK: "%" has only % in stock', v_prod.name, v_prod.stock_quantity
        using errcode = 'P0001';
    end if;
    v_subtotal := v_subtotal + v_prod.selling_price * v_line.qty;
    v_lines := v_lines || jsonb_build_object(
      'product_id', v_prod.id, 'name', v_prod.name, 'sku', v_prod.sku, 'qty', v_line.qty,
      'price', v_prod.selling_price, 'cost', v_prod.cost_price, 'stock', v_prod.stock_quantity);
  end loop;

  if v_subtotal > 99999999 then
    raise exception 'VALIDATION: sale total is too large' using errcode = 'P0001';
  end if;

  -- ---- Discount -------------------------------------------------------------
  if v_type = 'amount' then
    if v_value > v_subtotal then
      raise exception 'VALIDATION: discount exceeds subtotal' using errcode = 'P0001';
    end if;
    v_discount := v_value;
  elsif v_type = 'percent' then
    if v_value > 100 then
      raise exception 'VALIDATION: discount percent cannot exceed 100' using errcode = 'P0001';
    end if;
    v_discount := round(v_subtotal * v_value / 100, 2);
  else
    v_value := 0;
  end if;

  if v_discount > 0 and not app.has_permission(p_store_id, 'sales.discount') then
    v_discount_pct := case when v_subtotal = 0 then 0 else v_discount * 100 / v_subtotal end;
    if not v_store.allow_cashier_discount then
      raise exception 'DISCOUNT_NOT_AUTHORIZED: you are not allowed to apply discounts' using errcode = 'P0001';
    end if;
    if v_discount_pct > v_store.max_discount_percent then
      raise exception 'DISCOUNT_NOT_AUTHORIZED: discount exceeds the % %% limit', v_store.max_discount_percent
        using errcode = 'P0001';
    end if;
  end if;

  -- ---- Tax --------------------------------------------------------------------
  v_taxable := v_subtotal - v_discount;
  if v_store.tax_enabled and v_store.tax_rate > 0 then
    if v_store.tax_inclusive then
      v_tax := round(v_taxable * v_store.tax_rate / (100 + v_store.tax_rate), 2);
      v_total := v_taxable;
    else
      v_tax := round(v_taxable * v_store.tax_rate / 100, 2);
      v_total := v_taxable + v_tax;
    end if;
  else
    v_total := v_taxable;
  end if;

  -- ---- Payment ----------------------------------------------------------------
  if p_payment_method = 'cash' then
    if p_amount_received is null or p_amount_received < v_total then
      raise exception 'PAYMENT_INVALID: amount received is less than the total due' using errcode = 'P0001';
    end if;
    v_received := p_amount_received;
  elsif p_payment_method in ('gcash','maya') then
    if v_ref is null or length(v_ref) < 4 then
      raise exception 'PAYMENT_INVALID: a reference number is required for e-wallet payments' using errcode = 'P0001';
    end if;
    if p_amount_received is not null and p_amount_received <> v_total then
      raise exception 'PAYMENT_INVALID: e-wallet amount must equal the total due' using errcode = 'P0001';
    end if;
    v_received := v_total;
  else
    v_received := coalesce(p_amount_received, v_total);
    if v_received < v_total then
      raise exception 'PAYMENT_INVALID: amount received is less than the total due' using errcode = 'P0001';
    end if;
  end if;

  -- ---- Persist ----------------------------------------------------------------
  update public.stores set sale_sequence = sale_sequence + 1 where id = p_store_id
  returning sale_sequence into v_seq;
  v_txn := 'TXN-' || to_char(now() at time zone v_store.timezone, 'YYYYMMDD') || '-' || lpad(v_seq::text, 6, '0');

  insert into public.sales (
    store_id, transaction_number, client_request_id, cashier_id, subtotal, discount_type,
    discount_value, discount, tax_amount, tax_inclusive, total_amount, payment_method,
    amount_received, change_amount)
  values (
    p_store_id, v_txn, p_client_request_id, v_actor, v_subtotal, v_type,
    v_value, v_discount, v_tax, v_store.tax_inclusive, v_total, p_payment_method,
    v_received, v_received - v_total)
  returning id into v_sale_id;

  insert into public.payments (sale_id, store_id, kind, payment_method, amount, reference_number, created_by)
  values (v_sale_id, p_store_id, 'payment', p_payment_method, v_total, v_ref, v_actor);

  perform set_config('app.allow_stock_write', 'on', true);
  for v_l in select * from jsonb_array_elements(v_lines)
  loop
    insert into public.sale_items (sale_id, store_id, product_id, product_name, sku, quantity, unit_price, cost_price, subtotal)
    values (v_sale_id, p_store_id, (v_l ->> 'product_id')::uuid, v_l ->> 'name', v_l ->> 'sku',
            (v_l ->> 'qty')::int, (v_l ->> 'price')::numeric, (v_l ->> 'cost')::numeric,
            (v_l ->> 'qty')::int * (v_l ->> 'price')::numeric);

    update public.products
       set stock_quantity = stock_quantity - (v_l ->> 'qty')::int
     where id = (v_l ->> 'product_id')::uuid;

    insert into public.stock_movements (store_id, product_id, movement_type, previous_quantity,
                                        quantity_changed, new_quantity, reason, reference_id, performed_by)
    values (p_store_id, (v_l ->> 'product_id')::uuid, 'sale', (v_l ->> 'stock')::int,
            -(v_l ->> 'qty')::int, (v_l ->> 'stock')::int - (v_l ->> 'qty')::int,
            'Sale ' || v_txn, v_sale_id, v_actor);
  end loop;
  perform set_config('app.allow_stock_write', '', true);

  perform app.write_audit(p_store_id, v_actor, 'create', 'sales', v_sale_id, null,
    jsonb_build_object('transaction_number', v_txn, 'total_amount', v_total,
                       'discount', v_discount, 'payment_method', p_payment_method));

  return jsonb_build_object('sale_id', v_sale_id, 'transaction_number', v_txn, 'duplicate', false);
end;
$$;

-- Full refund: restocks every item, records a negative payment, keeps the sale.
create or replace function public.refund_sale(p_store_id uuid, p_sale_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_sale  public.sales%rowtype;
  v_item  record;
  v_prev  integer;
begin
  v_actor := app.require_permission(p_store_id, 'sales.refund');

  if coalesce(btrim(p_reason), '') = '' or length(p_reason) > 300 then
    raise exception 'VALIDATION: a refund reason (max 300 characters) is required' using errcode = 'P0001';
  end if;

  select * into v_sale from public.sales where id = p_sale_id and store_id = p_store_id for update;
  if not found then
    raise exception 'NOT_FOUND: sale not found' using errcode = 'P0001';
  end if;
  if v_sale.status <> 'completed' then
    raise exception 'ALREADY_REFUNDED: this sale has already been refunded' using errcode = 'P0001';
  end if;

  perform set_config('app.allow_stock_write', 'on', true);
  for v_item in
    select product_id, sum(quantity)::int as qty from public.sale_items
    where sale_id = p_sale_id group by product_id order by product_id
  loop
    select stock_quantity into v_prev from public.products where id = v_item.product_id for update;
    update public.products set stock_quantity = stock_quantity + v_item.qty where id = v_item.product_id;
    insert into public.stock_movements (store_id, product_id, movement_type, previous_quantity,
                                        quantity_changed, new_quantity, reason, reference_id, performed_by)
    values (p_store_id, v_item.product_id, 'return', v_prev, v_item.qty, v_prev + v_item.qty,
            'Refund ' || v_sale.transaction_number || ': ' || btrim(p_reason), p_sale_id, v_actor);
  end loop;
  perform set_config('app.allow_stock_write', '', true);

  update public.sales
     set status = 'refunded', refunded_at = now(), refunded_by = v_actor, refund_reason = btrim(p_reason)
   where id = p_sale_id;

  insert into public.payments (sale_id, store_id, kind, payment_method, amount, created_by)
  values (p_sale_id, p_store_id, 'refund', v_sale.payment_method, -v_sale.total_amount, v_actor);

  perform app.write_audit(p_store_id, v_actor, 'refund', 'sales', p_sale_id,
    jsonb_build_object('status', 'completed'),
    jsonb_build_object('status', 'refunded', 'reason', btrim(p_reason), 'amount', v_sale.total_amount));

  return jsonb_build_object('sale_id', p_sale_id, 'status', 'refunded');
end;
$$;

-- -----------------------------------------------------------------------------
-- INVENTORY
-- -----------------------------------------------------------------------------
-- p_type: stock_in (adds p_quantity), stock_out (removes p_quantity),
--         adjustment (sets the counted quantity to p_quantity).
create or replace function public.adjust_stock(
  p_store_id uuid, p_product_id uuid, p_type text, p_quantity integer, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid;
  v_prod    public.products%rowtype;
  v_change  integer;
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
  v_mov     public.stock_movements%rowtype;
begin
  v_actor := app.require_permission(p_store_id, 'inventory.manage');

  if p_type is null or p_type not in ('stock_in','stock_out','adjustment') then
    raise exception 'VALIDATION: invalid movement type' using errcode = 'P0001';
  end if;
  if p_quantity is null or p_quantity < 0 or p_quantity > 1000000 then
    raise exception 'VALIDATION: invalid quantity' using errcode = 'P0001';
  end if;
  if v_reason is not null and length(v_reason) > 300 then
    raise exception 'VALIDATION: reason is too long' using errcode = 'P0001';
  end if;
  if p_type in ('stock_out','adjustment') and v_reason is null then
    raise exception 'VALIDATION: a reason is required for stock out and adjustments' using errcode = 'P0001';
  end if;

  select * into v_prod from public.products where id = p_product_id and store_id = p_store_id for update;
  if not found then
    raise exception 'NOT_FOUND: product not found' using errcode = 'P0001';
  end if;

  if p_type = 'stock_in' then
    if p_quantity < 1 then
      raise exception 'VALIDATION: quantity must be at least 1' using errcode = 'P0001';
    end if;
    v_change := p_quantity;
  elsif p_type = 'stock_out' then
    if p_quantity < 1 then
      raise exception 'VALIDATION: quantity must be at least 1' using errcode = 'P0001';
    end if;
    if v_prod.stock_quantity - p_quantity < 0 then
      raise exception 'INSUFFICIENT_STOCK: only % in stock', v_prod.stock_quantity using errcode = 'P0001';
    end if;
    v_change := -p_quantity;
  else
    v_change := p_quantity - v_prod.stock_quantity;
    if v_change = 0 then
      raise exception 'VALIDATION: the counted quantity equals the current stock' using errcode = 'P0001';
    end if;
  end if;

  perform set_config('app.allow_stock_write', 'on', true);
  update public.products set stock_quantity = stock_quantity + v_change where id = p_product_id;
  perform set_config('app.allow_stock_write', '', true);

  insert into public.stock_movements (store_id, product_id, movement_type, previous_quantity,
                                      quantity_changed, new_quantity, reason, performed_by)
  values (p_store_id, p_product_id, p_type, v_prod.stock_quantity, v_change,
          v_prod.stock_quantity + v_change, v_reason, v_actor)
  returning * into v_mov;

  return to_jsonb(v_mov);
end;
$$;

-- -----------------------------------------------------------------------------
-- USERS
-- -----------------------------------------------------------------------------
-- Adds a user (whose Firebase account was created by the backend) to a store.
create or replace function public.create_store_member(
  p_store_id uuid, p_firebase_uid text, p_email text, p_full_name text, p_role_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid;
  v_role    uuid;
  v_profile uuid;
begin
  v_actor := app.require_permission(p_store_id, 'users.manage');

  select id into v_role from public.roles where key = p_role_key;
  if v_role is null then
    raise exception 'VALIDATION: invalid role' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_full_name), '') = '' then
    raise exception 'VALIDATION: full name is required' using errcode = 'P0001';
  end if;

  select id into v_profile from public.profiles where firebase_uid = p_firebase_uid;
  if v_profile is null then
    if exists (select 1 from public.profiles where lower(email) = lower(btrim(p_email))) then
      raise exception 'CONFLICT: a profile with this email already exists' using errcode = 'P0001';
    end if;
    insert into public.profiles (firebase_uid, email, full_name)
    values (p_firebase_uid, lower(btrim(p_email)), btrim(p_full_name))
    returning id into v_profile;
  else
    update public.profiles set is_active = true where id = v_profile and not is_active;
  end if;

  if exists (select 1 from public.store_members where store_id = p_store_id and profile_id = v_profile) then
    raise exception 'CONFLICT: this user is already a member of the store' using errcode = 'P0001';
  end if;

  insert into public.store_members (store_id, profile_id, role_id) values (p_store_id, v_profile, v_role);
  return v_profile;
end;
$$;

-- Updates a member's name, role and/or active state. Returns the Firebase UID
-- and whether the account has no remaining active memberships (so the backend
-- can disable / re-enable the Firebase account).
create or replace function public.update_store_member(
  p_store_id uuid, p_profile_id uuid, p_full_name text default null,
  p_role_key text default null, p_is_active boolean default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor        uuid;
  v_member       public.store_members%rowtype;
  v_admin_role   uuid;
  v_new_role     uuid;
  v_new_active   boolean;
  v_other_admins integer;
  v_firebase_uid text;
  v_active_count integer;
begin
  v_actor := app.require_permission(p_store_id, 'users.manage');

  -- Lock all memberships of the store so concurrent demotions cannot remove
  -- the last administrator.
  perform 1 from public.store_members where store_id = p_store_id for update;

  select * into v_member from public.store_members where store_id = p_store_id and profile_id = p_profile_id;
  if not found then
    raise exception 'NOT_FOUND: user is not a member of this store' using errcode = 'P0001';
  end if;

  select id into v_admin_role from public.roles where key = 'administrator';
  v_new_role := v_member.role_id;
  if p_role_key is not null then
    select id into v_new_role from public.roles where key = p_role_key;
    if v_new_role is null then
      raise exception 'VALIDATION: invalid role' using errcode = 'P0001';
    end if;
  end if;
  v_new_active := coalesce(p_is_active, v_member.is_active);

  if p_profile_id = v_actor and (v_new_role <> v_member.role_id or v_new_active <> v_member.is_active) then
    raise exception 'SELF_MODIFICATION: you cannot change your own role or status' using errcode = 'P0001';
  end if;

  if v_member.role_id = v_admin_role and v_member.is_active
     and (v_new_role <> v_admin_role or not v_new_active) then
    select count(*) into v_other_admins from public.store_members
     where store_id = p_store_id and role_id = v_admin_role and is_active and profile_id <> p_profile_id;
    if v_other_admins = 0 then
      raise exception 'LAST_ADMIN: the store must keep at least one active administrator' using errcode = 'P0001';
    end if;
  end if;

  if p_full_name is not null then
    if btrim(p_full_name) = '' or length(p_full_name) > 120 then
      raise exception 'VALIDATION: invalid full name' using errcode = 'P0001';
    end if;
    update public.profiles set full_name = btrim(p_full_name) where id = p_profile_id;
  end if;

  update public.store_members set role_id = v_new_role, is_active = v_new_active
   where id = v_member.id;

  select count(*) into v_active_count from public.store_members where profile_id = p_profile_id and is_active;
  update public.profiles set is_active = (v_active_count > 0) where id = p_profile_id;

  select firebase_uid into v_firebase_uid from public.profiles where id = p_profile_id;
  return jsonb_build_object('firebase_uid', v_firebase_uid, 'has_active_membership', v_active_count > 0);
end;
$$;

create or replace function public.update_my_profile(p_full_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.current_profile_id();
begin
  if v_actor is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_full_name), '') = '' or length(p_full_name) > 120 then
    raise exception 'VALIDATION: invalid full name' using errcode = 'P0001';
  end if;
  update public.profiles set full_name = btrim(p_full_name) where id = v_actor;
end;
$$;

-- -----------------------------------------------------------------------------
-- DASHBOARD & REPORTS (SECURITY INVOKER: row level security applies, so a
-- cashier's figures only include the sales they are allowed to see).
-- -----------------------------------------------------------------------------
create or replace function app.range_bounds(p_store_id uuid, p_from date, p_to date, p_max_days integer,
                                            out tz text, out range_start timestamptz, out range_end timestamptz)
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_from is null or p_to is null or p_to < p_from or (p_to - p_from) > p_max_days then
    raise exception 'VALIDATION: invalid date range' using errcode = 'P0001';
  end if;
  select s.timezone into tz from public.stores s where s.id = p_store_id;
  if tz is null then
    raise exception 'NOT_FOUND: store not found' using errcode = 'P0001';
  end if;
  range_start := p_from::timestamp at time zone tz;
  range_end   := (p_to + 1)::timestamp at time zone tz;
end;
$$;

create or replace function public.dashboard_summary(p_store_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  b record;
  v_result jsonb;
begin
  perform app.require_permission(p_store_id, 'dashboard.view');
  select * into b from app.range_bounds(p_store_id, p_from, p_to, 366);

  with s as (
    select * from public.sales
    where store_id = p_store_id and created_at >= b.range_start and created_at < b.range_end
  ),
  daily as (
    select (created_at at time zone b.tz)::date as day, sum(total_amount) as total, count(*) as cnt
    from s where status = 'completed' group by 1
  )
  select jsonb_build_object(
    'total_sales',     coalesce((select sum(total_amount) from s where status = 'completed'), 0),
    'cash_sales',      coalesce((select sum(total_amount) from s where status = 'completed' and payment_method = 'cash'), 0),
    'non_cash_sales',  coalesce((select sum(total_amount) from s where status = 'completed' and payment_method <> 'cash'), 0),
    'transactions',    (select count(*) from s where status = 'completed'),
    'refunded_count',  (select count(*) from s where status = 'refunded'),
    'items_sold',      coalesce((select sum(si.quantity) from public.sale_items si join s on s.id = si.sale_id
                                 where s.status = 'completed'), 0),
    'total_products',  (select count(*) from public.products where store_id = p_store_id and is_active),
    'low_stock_count', (select count(*) from public.products
                        where store_id = p_store_id and is_active and stock_quantity <= minimum_stock),
    'recent_sales',    coalesce((select jsonb_agg(r order by r.created_at desc) from (
                          select s.id, s.transaction_number, s.total_amount, s.payment_method, s.status,
                                 s.created_at, p.full_name as cashier_name, p.email as cashier_email
                          from s left join public.profiles p on p.id = s.cashier_id
                          order by s.created_at desc limit 8) r), '[]'::jsonb),
    'best_sellers',    coalesce((select jsonb_agg(r order by r.quantity desc, r.revenue desc) from (
                          select si.product_id, si.product_name, sum(si.quantity)::int as quantity,
                                 sum(si.subtotal) as revenue
                          from public.sale_items si join s on s.id = si.sale_id
                          where s.status = 'completed'
                          group by si.product_id, si.product_name
                          order by 3 desc, 4 desc limit 5) r), '[]'::jsonb),
    'series',          (select jsonb_agg(jsonb_build_object('date', d::date,
                                 'total', coalesce(daily.total, 0), 'transactions', coalesce(daily.cnt, 0))
                               order by d)
                        from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d
                        left join daily on daily.day = d::date)
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.sales_report(p_store_id uuid, p_from date, p_to date, p_group text default 'day')
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  b record;
  v_result jsonb;
begin
  perform app.require_permission(p_store_id, 'reports.view');
  if p_group not in ('day','week','month','year') then
    raise exception 'VALIDATION: invalid grouping' using errcode = 'P0001';
  end if;
  select * into b from app.range_bounds(p_store_id, p_from, p_to, 3660);

  with s as (
    select s.*, date_trunc(p_group, s.created_at at time zone b.tz)::date as period
    from public.sales s
    where s.store_id = p_store_id and s.created_at >= b.range_start and s.created_at < b.range_end
  ),
  cogs as (
    select s.period, sum(si.quantity * si.cost_price) as cogs
    from s join public.sale_items si on si.sale_id = s.id
    where s.status = 'completed' group by s.period
  ),
  exp as (
    select date_trunc(p_group, e.expense_date::timestamp)::date as period, sum(e.amount) as total
    from public.expenses e
    where e.store_id = p_store_id and not e.is_voided and e.expense_date between p_from and p_to
    group by 1
  ),
  sales_by_period as (
    select period,
           count(*) filter (where status = 'completed')                    as transactions,
           count(*) filter (where status = 'refunded')                     as refund_count,
           sum(subtotal)                                                    as gross_sales,
           sum(discount)                                                    as discounts,
           coalesce(sum(total_amount) filter (where status = 'refunded'), 0) as refunds,
           coalesce(sum(tax_amount)   filter (where status = 'completed'), 0) as tax,
           coalesce(sum(total_amount) filter (where status = 'completed'), 0) as net_sales
    from s group by period
  ),
  periods as (
    select period from sales_by_period union select period from exp
  ),
  rows as (
    select p.period,
           coalesce(sp.transactions, 0) as transactions,
           coalesce(sp.refund_count, 0) as refund_count,
           coalesce(sp.gross_sales, 0)  as gross_sales,
           coalesce(sp.discounts, 0)    as discounts,
           coalesce(sp.refunds, 0)      as refunds,
           coalesce(sp.tax, 0)          as tax,
           coalesce(sp.net_sales, 0)    as net_sales,
           coalesce(sp.net_sales, 0) - coalesce(sp.tax, 0) as revenue_ex_tax,
           coalesce(c.cogs, 0)          as cost_of_goods,
           coalesce(sp.net_sales, 0) - coalesce(sp.tax, 0) - coalesce(c.cogs, 0) as gross_profit,
           coalesce(e.total, 0)         as expenses,
           coalesce(sp.net_sales, 0) - coalesce(sp.tax, 0) - coalesce(c.cogs, 0) - coalesce(e.total, 0) as net_profit
    from periods p
    left join sales_by_period sp on sp.period = p.period
    left join cogs c on c.period = p.period
    left join exp e on e.period = p.period
  )
  select jsonb_build_object(
    'group', p_group,
    'rows', coalesce((select jsonb_agg(to_jsonb(r) order by r.period) from rows r), '[]'::jsonb),
    'totals', (select jsonb_build_object(
                 'transactions',   coalesce(sum(transactions), 0),
                 'refund_count',   coalesce(sum(refund_count), 0),
                 'gross_sales',    coalesce(sum(gross_sales), 0),
                 'discounts',      coalesce(sum(discounts), 0),
                 'refunds',        coalesce(sum(refunds), 0),
                 'tax',            coalesce(sum(tax), 0),
                 'net_sales',      coalesce(sum(net_sales), 0),
                 'revenue_ex_tax', coalesce(sum(revenue_ex_tax), 0),
                 'cost_of_goods',  coalesce(sum(cost_of_goods), 0),
                 'gross_profit',   coalesce(sum(gross_profit), 0),
                 'expenses',       coalesce(sum(expenses), 0),
                 'net_profit',     coalesce(sum(net_profit), 0)) from rows),
    'payment_methods', coalesce((select jsonb_agg(r order by r.total desc) from (
                          select payment_method, count(*) as transactions, sum(total_amount) as total
                          from s where status = 'completed' group by payment_method) r), '[]'::jsonb),
    'top_products', coalesce((select jsonb_agg(r order by r.revenue desc) from (
                          select si.product_id, si.product_name, sum(si.quantity)::int as quantity,
                                 sum(si.subtotal) as revenue, sum(si.quantity * si.cost_price) as cost,
                                 sum(si.subtotal) - sum(si.quantity * si.cost_price) as profit
                          from s join public.sale_items si on si.sale_id = s.id
                          where s.status = 'completed'
                          group by si.product_id, si.product_name
                          order by 4 desc limit 10) r), '[]'::jsonb),
    'cashiers', coalesce((select jsonb_agg(r order by r.total desc) from (
                          select s.cashier_id, coalesce(p.full_name, p.email) as cashier_name,
                                 count(*) filter (where s.status = 'completed') as transactions,
                                 coalesce(sum(s.total_amount) filter (where s.status = 'completed'), 0) as total
                          from s left join public.profiles p on p.id = s.cashier_id
                          group by s.cashier_id, p.full_name, p.email) r), '[]'::jsonb),
    'expense_categories', coalesce((select jsonb_agg(r order by r.total desc) from (
                          select e.category, sum(e.amount) as total, count(*) as count
                          from public.expenses e
                          where e.store_id = p_store_id and not e.is_voided and e.expense_date between p_from and p_to
                          group by e.category) r), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

-- ############################################################################
-- PART 4 — rls_and_grants
-- ############################################################################
-- =============================================================================
-- ROW LEVEL SECURITY & PRIVILEGES
--
-- Access model
--   * anon:          no access to anything.
--   * authenticated: a request whose Firebase identity was verified. The
--                    backend runs every user request inside a transaction with
--                    `SET LOCAL ROLE authenticated` and request.jwt.claims set
--                    to the verified Firebase UID, so these policies are
--                    enforced on all user-driven queries. (The same policies
--                    also work if Firebase is configured as a Supabase
--                    third-party auth provider.)
--   * service_role / postgres: trusted backend only, used for initial setup
--                    and identity lookup. Never exposed to browsers.
--
-- Multi-table writes (sales, refunds, stock, membership) are only possible
-- through SECURITY DEFINER functions that check permissions themselves.
-- =============================================================================

alter table public.system_settings  enable row level security;
alter table public.profiles         enable row level security;
alter table public.roles            enable row level security;
alter table public.permissions      enable row level security;
alter table public.role_permissions enable row level security;
alter table public.stores           enable row level security;
alter table public.store_members    enable row level security;
alter table public.categories       enable row level security;
alter table public.products         enable row level security;
alter table public.sales            enable row level security;
alter table public.sale_items       enable row level security;
alter table public.payments         enable row level security;
alter table public.stock_movements  enable row level security;
alter table public.expenses         enable row level security;
alter table public.audit_logs       enable row level security;

-- ---------------------------------------------------------------------------
-- Table privileges
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated, service_role;
revoke all on all tables in schema public from public, anon, authenticated;
grant all on all tables in schema public to service_role;

grant select on public.profiles, public.roles, public.permissions, public.role_permissions,
                public.stores, public.store_members, public.categories, public.products,
                public.sales, public.sale_items, public.payments, public.stock_movements,
                public.expenses, public.audit_logs
  to authenticated;

-- Store settings (identity, counters and ownership columns are not writable).
grant update (store_name, store_address, contact_number, business_email, business_type, logo_url,
              currency, timezone, date_format, receipt_footer, receipt_paper,
              tax_enabled, tax_name, tax_rate, tax_inclusive,
              allow_cashier_discount, max_discount_percent,
              default_low_stock_threshold, low_stock_alerts)
  on public.stores to authenticated;

grant insert (store_id, name, description) on public.categories to authenticated;
grant update (name, description) on public.categories to authenticated;
grant delete on public.categories to authenticated;

-- stock_quantity is intentionally NOT writable: stock only changes through
-- adjust_stock / process_sale / refund_sale, which always record a movement.
grant insert (store_id, category_id, name, sku, barcode, description, image_url,
              cost_price, selling_price, minimum_stock, is_active)
  on public.products to authenticated;
grant update (category_id, name, sku, barcode, description, image_url,
              cost_price, selling_price, minimum_stock, is_active)
  on public.products to authenticated;

grant insert (store_id, description, category, amount, expense_date, payment_method,
              reference_number, notes, recorded_by)
  on public.expenses to authenticated;
grant update (description, category, amount, expense_date, payment_method, reference_number, notes,
              is_voided, voided_at, voided_by, void_reason)
  on public.expenses to authenticated;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------
-- Revoke only on this project's functions (extension functions are left alone).
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end;
$$;

grant usage on schema app to authenticated, service_role;
grant execute on function
  app.jwt_uid(), app.current_profile_id(), app.permitted_store_ids(text), app.member_store_ids(),
  app.has_permission(uuid, text), app.require_permission(uuid, text),
  app.range_bounds(uuid, date, date, integer)
  to authenticated, service_role;

grant execute on function
  public.complete_store_setup(jsonb),
  public.process_sale(uuid, uuid, jsonb, text, numeric, text, numeric, text),
  public.refund_sale(uuid, uuid, text),
  public.adjust_stock(uuid, uuid, text, integer, text),
  public.create_store_member(uuid, text, text, text, text),
  public.update_store_member(uuid, uuid, text, text, boolean),
  public.update_my_profile(text),
  public.dashboard_summary(uuid, date, date),
  public.sales_report(uuid, date, date, text)
  to authenticated;

-- Initial administrator claim: trusted backend only.
grant execute on function public.claim_initial_admin(text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Policies (authenticated)
-- ---------------------------------------------------------------------------

-- system_settings: no policies => no access except the trusted backend.

create policy profiles_select on public.profiles for select to authenticated
using (
  firebase_uid = (select app.jwt_uid())
  or id in (select sm.profile_id from public.store_members sm
            where sm.store_id in (select app.member_store_ids()))
);

create policy roles_select on public.roles for select to authenticated using (true);
create policy permissions_select on public.permissions for select to authenticated using (true);
create policy role_permissions_select on public.role_permissions for select to authenticated using (true);

create policy stores_select on public.stores for select to authenticated
using (id in (select app.member_store_ids()));
create policy stores_update on public.stores for update to authenticated
using (id in (select app.permitted_store_ids('settings.manage')))
with check (id in (select app.permitted_store_ids('settings.manage')));

create policy store_members_select on public.store_members for select to authenticated
using (store_id in (select app.member_store_ids()));

-- Catalog: visible to anyone who can view products or sell.
create policy categories_select on public.categories for select to authenticated
using (store_id in (select app.permitted_store_ids('products.view'))
       or store_id in (select app.permitted_store_ids('pos.use')));
create policy categories_insert on public.categories for insert to authenticated
with check (store_id in (select app.permitted_store_ids('products.manage')));
create policy categories_update on public.categories for update to authenticated
using (store_id in (select app.permitted_store_ids('products.manage')))
with check (store_id in (select app.permitted_store_ids('products.manage')));
create policy categories_delete on public.categories for delete to authenticated
using (store_id in (select app.permitted_store_ids('products.manage')));

create policy products_select on public.products for select to authenticated
using (store_id in (select app.permitted_store_ids('products.view'))
       or store_id in (select app.permitted_store_ids('pos.use')));
create policy products_insert on public.products for insert to authenticated
with check (store_id in (select app.permitted_store_ids('products.manage'))
            and (category_id is null or exists (
                  select 1 from public.categories c where c.id = category_id and c.store_id = products.store_id)));
create policy products_update on public.products for update to authenticated
using (store_id in (select app.permitted_store_ids('products.manage')))
with check (store_id in (select app.permitted_store_ids('products.manage'))
            and (category_id is null or exists (
                  select 1 from public.categories c where c.id = category_id and c.store_id = products.store_id)));

-- Sales: all sales with sales.view_all, otherwise only the user's own sales.
create policy sales_select on public.sales for select to authenticated
using (
  store_id in (select app.permitted_store_ids('sales.view_all'))
  or (cashier_id = (select app.current_profile_id())
      and store_id in (select app.permitted_store_ids('sales.view_own')))
);
create policy sale_items_select on public.sale_items for select to authenticated
using (exists (select 1 from public.sales s where s.id = sale_items.sale_id));
create policy payments_select on public.payments for select to authenticated
using (exists (select 1 from public.sales s where s.id = payments.sale_id));

create policy stock_movements_select on public.stock_movements for select to authenticated
using (store_id in (select app.permitted_store_ids('inventory.view')));

create policy expenses_select on public.expenses for select to authenticated
using (store_id in (select app.permitted_store_ids('expenses.view')));
create policy expenses_insert on public.expenses for insert to authenticated
with check (store_id in (select app.permitted_store_ids('expenses.manage'))
            and recorded_by = (select app.current_profile_id()));
create policy expenses_update on public.expenses for update to authenticated
using (store_id in (select app.permitted_store_ids('expenses.manage')) and not is_voided)
with check (store_id in (select app.permitted_store_ids('expenses.manage'))
            and (not is_voided or voided_by = (select app.current_profile_id())));

create policy audit_logs_select on public.audit_logs for select to authenticated
using (store_id in (select app.permitted_store_ids('audit.view'))
       or (store_id is null and user_id in (
             select sm.profile_id from public.store_members sm
             where sm.store_id in (select app.permitted_store_ids('audit.view')))));

-- ############################################################################
-- PART 5 — storage
-- ############################################################################
-- =============================================================================
-- SUPABASE STORAGE BUCKETS
-- Logos and product images are served publicly (the login page shows the
-- store logo before sign-in). Writes are performed only by the backend with
-- the service role key after permission checks; no storage policies grant
-- write access to anon/authenticated users.
-- =============================================================================
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values
      ('store-assets',   'store-assets',   true, 2097152, array['image/png','image/jpeg','image/webp']),
      ('product-images', 'product-images', true, 2097152, array['image/png','image/jpeg','image/webp'])
    on conflict (id) do nothing;
  end if;
end;
$$;

-- ############################################################################
-- PART 6 — browser_direct_access
-- ############################################################################
-- =============================================================================
-- NO-BACKEND MODE: the browser calls Supabase directly.
--
-- Identity: Supabase "Third-Party Auth" with Firebase (Supabase dashboard >
-- Authentication > Sign In / Providers > Third-Party Auth > Firebase). Supabase
-- verifies every Firebase ID token's signature and project before a query runs
-- and exposes its claims in request.jwt.claims. Firebase tokens carry no "role"
-- claim, so requests run as the Postgres "anon" role: every policy and function
-- below therefore keys off the VERIFIED Firebase UID (app.jwt_uid()), never off
-- the role. A request without a valid Firebase token has no UID and sees nothing.
--
-- All app operations are RPC functions. Read/write functions that touch
-- business tables are SECURITY INVOKER (row level security still applies);
-- multi-table operations are SECURITY DEFINER and check permissions themselves.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Identity: only accept tokens issued by THIS Firebase project.
-- ---------------------------------------------------------------------------
create or replace function app.firebase_project_id()
returns text language sql immutable set search_path = '' as $$ select 'pointofsale-c6771'::text $$;

create or replace function app.jwt_claims()
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

create or replace function app.jwt_uid()
returns text language sql stable set search_path = '' as $$
  select case
           when c ->> 'iss' = 'https://securetoken.google.com/' || app.firebase_project_id()
            and c ->> 'aud' = app.firebase_project_id()
           then nullif(c ->> 'sub', '')
         end
  from (select app.jwt_claims() as c) x;
$$;

create or replace function app.is_pending_initial_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.system_settings
                 where singleton and not setup_completed
                   and initial_admin_profile_id = app.current_profile_id());
$$;

-- Bare "CODE" messages for list functions' simple errors.
create or replace function app.raise(p_message text)
returns void language plpgsql set search_path = '' as $$
begin
  raise exception '%', p_message using errcode = 'P0001';
end;
$$;

-- ---------------------------------------------------------------------------
-- Let verified Firebase requests (role "anon") use the same privileges and
-- policies as "authenticated". RLS + app.jwt_uid() decide what they can see.
-- ---------------------------------------------------------------------------
grant usage on schema public, app to anon;

grant select on public.profiles, public.roles, public.permissions, public.role_permissions,
                public.stores, public.store_members, public.categories, public.products,
                public.sales, public.sale_items, public.payments, public.stock_movements,
                public.expenses, public.audit_logs
  to anon;
grant update (store_name, store_address, contact_number, business_email, business_type, logo_url,
              currency, timezone, date_format, receipt_footer, receipt_paper,
              tax_enabled, tax_name, tax_rate, tax_inclusive,
              allow_cashier_discount, max_discount_percent,
              default_low_stock_threshold, low_stock_alerts)
  on public.stores to anon;
grant insert (store_id, name, description) on public.categories to anon;
grant update (name, description) on public.categories to anon;
grant delete on public.categories to anon;
grant insert (store_id, category_id, name, sku, barcode, description, image_url,
              cost_price, selling_price, minimum_stock, is_active)
  on public.products to anon;
grant update (category_id, name, sku, barcode, description, image_url,
              cost_price, selling_price, minimum_stock, is_active)
  on public.products to anon;
grant insert (store_id, description, category, amount, expense_date, payment_method,
              reference_number, notes, recorded_by)
  on public.expenses to anon;
grant update (description, category, amount, expense_date, payment_method, reference_number, notes,
              is_voided, voided_at, voided_by, void_reason)
  on public.expenses to anon;

do $$
declare
  p record;
begin
  for p in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('alter policy %I on public.%I to anon, authenticated', p.policyname, p.tablename);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- SETUP & SESSION
-- ---------------------------------------------------------------------------

-- Public, used only to pick the first screen. Not a security control.
create or replace function public.get_setup_status()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'adminClaimed', ss.admin_claimed_at is not null,
    'setupCompleted', ss.setup_completed,
    'store', case when ss.setup_completed then (
               select jsonb_build_object('store_name', s.store_name, 'logo_url', s.logo_url)
               from public.stores s where s.is_active order by s.created_at limit 1) end)
  from public.system_settings ss where ss.singleton;
$$;

-- Step 1 of setup: the caller (a freshly created Firebase account) atomically
-- claims the single administrator slot. Identity comes from the verified token.
create or replace function public.claim_initial_admin_self(p_full_name text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid   text := app.jwt_uid();
  v_email text := lower(btrim(app.jwt_claims() ->> 'email'));
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  if coalesce(v_email, '') = '' then
    raise exception 'VALIDATION: the account has no email address' using errcode = 'P0001';
  end if;
  return public.claim_initial_admin(v_uid, v_email, p_full_name);
end;
$$;

-- Session context for the signed-in user (what the old /api/auth/me returned).
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
         coalesce((select jsonb_agg(pe.permission_key order by pe.permission_key)
                   from public.role_permissions rp join public.permissions pe on pe.id = rp.permission_id
                   where rp.role_id = r.id), '[]'::jsonb) as permissions
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

create or replace function public.record_auth_event(p_action text, p_store_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app.current_profile_id();
begin
  if v_actor is null or p_action not in ('login', 'logout') then return; end if;
  if p_store_id is not null and not exists (
      select 1 from app.member_store_ids() s where s = p_store_id) then
    p_store_id := null;
  end if;
  perform app.write_audit(p_store_id, v_actor, p_action, 'auth', v_actor, null, null);
end;
$$;

-- ---------------------------------------------------------------------------
-- PRODUCTS & CATEGORIES (SECURITY INVOKER: RLS applies)
-- ---------------------------------------------------------------------------
create or replace function app.product_json(p public.products, p_category_name text, p_show_cost boolean)
returns jsonb language sql stable set search_path = '' as $$
  select (to_jsonb(p) || jsonb_build_object('category_name', p_category_name,
                                             'is_low_stock', p.stock_quantity <= p.minimum_stock))
         - case when p_show_cost then '' else 'cost_price' end;
$$;

create or replace function public.list_products(
  p_store_id uuid, p_search text default null, p_category_id uuid default null,
  p_status text default 'active', p_stock text default 'all', p_sort text default 'name',
  p_order text default 'asc', p_limit integer default 20, p_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_cost  boolean := app.has_permission(p_store_id, 'products.manage') or app.has_permission(p_store_id, 'inventory.manage');
  v_like  text := case when coalesce(btrim(p_search), '') = '' then null
                       else '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
  v_res   jsonb;
begin
  if p_sort not in ('name','selling_price','stock_quantity','created_at','sku') or p_order not in ('asc','desc') then
    perform app.raise('VALIDATION: invalid sort');
  end if;
  with f as (
    select p.*, c.name as category_name
      from public.products p left join public.categories c on c.id = p.category_id
     where p.store_id = p_store_id
       and (p_status = 'all' or (p_status = 'active' and p.is_active) or (p_status = 'archived' and not p.is_active))
       and (v_like is null or p.name ilike v_like or p.sku ilike v_like or p.barcode ilike v_like)
       and (p_category_id is null or p.category_id = p_category_id)
       and (p_stock = 'all' or (p_stock = 'low' and p.stock_quantity <= p.minimum_stock)
            or (p_stock = 'out' and p.stock_quantity = 0) or (p_stock = 'in' and p.stock_quantity > 0))
  ), page as (
    select * from f
     order by
       case when p_order = 'asc' then case p_sort when 'name' then lower(f.name) when 'sku' then lower(f.sku) end end asc nulls last,
       case when p_order = 'desc' then case p_sort when 'name' then lower(f.name) when 'sku' then lower(f.sku) end end desc nulls last,
       case when p_order = 'asc' then case p_sort when 'selling_price' then f.selling_price when 'stock_quantity' then f.stock_quantity end end asc nulls last,
       case when p_order = 'desc' then case p_sort when 'selling_price' then f.selling_price when 'stock_quantity' then f.stock_quantity end end desc nulls last,
       case when p_order = 'asc' and p_sort = 'created_at' then f.created_at end asc,
       case when p_order = 'desc' and p_sort = 'created_at' then f.created_at end desc,
       f.id
     limit least(greatest(p_limit, 1), 500) offset greatest(p_offset, 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'rows', coalesce((select jsonb_agg(app.product_json(
               (select x from public.products x where x.id = page.id), page.category_name, v_cost)) from page), '[]'::jsonb))
  into v_res;
  -- keep the ordering produced by the page query
  select jsonb_set(v_res, '{rows}', coalesce((
    select jsonb_agg(r order by ord) from jsonb_array_elements(v_res -> 'rows') with ordinality t(r, ord)), '[]'::jsonb))
  into v_res;
  return v_res;
end;
$$;

create or replace function public.lookup_product(p_store_id uuid, p_code text)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_cost boolean := app.has_permission(p_store_id, 'products.manage');
  v_res  jsonb;
begin
  select app.product_json(p, c.name, v_cost) into v_res
    from public.products p left join public.categories c on c.id = p.category_id
   where p.store_id = p_store_id and p.is_active
     and (p.barcode = btrim(p_code) or lower(p.sku) = lower(btrim(p_code)))
   order by (p.barcode = btrim(p_code)) desc limit 1;
  if v_res is null then
    perform app.raise(format('NOT_FOUND: no active product matches "%s"', left(btrim(p_code), 64)));
  end if;
  return v_res;
end;
$$;

-- Creates (p_id null) or updates a product. Initial stock is recorded as a
-- Stock In movement in the same transaction.
create or replace function public.save_product(p_store_id uuid, p_id uuid, p_data jsonb, p_initial_stock integer default 0)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_id  uuid := p_id;
  v_min integer;
  v_res jsonb;
begin
  perform app.require_permission(p_store_id, 'products.manage');
  if coalesce(btrim(p_data ->> 'name'), '') = '' then perform app.raise('VALIDATION: product name is required'); end if;
  if (p_data ->> 'selling_price') is null then perform app.raise('VALIDATION: selling price is required'); end if;

  if v_id is null then
    select default_low_stock_threshold into v_min from public.stores where id = p_store_id;
    insert into public.products (store_id, category_id, name, sku, barcode, description, image_url,
                                 cost_price, selling_price, minimum_stock)
    values (p_store_id, nullif(p_data ->> 'category_id', '')::uuid, btrim(p_data ->> 'name'),
            nullif(btrim(coalesce(p_data ->> 'sku', '')), ''), nullif(btrim(coalesce(p_data ->> 'barcode', '')), ''),
            nullif(btrim(coalesce(p_data ->> 'description', '')), ''), nullif(p_data ->> 'image_url', ''),
            coalesce(nullif(p_data ->> 'cost_price', '')::numeric, 0), (p_data ->> 'selling_price')::numeric,
            coalesce(nullif(p_data ->> 'minimum_stock', '')::integer, v_min))
    returning id into v_id;
    if coalesce(p_initial_stock, 0) > 0 then
      perform public.adjust_stock(p_store_id, v_id, 'stock_in', p_initial_stock, 'Initial stock');
    end if;
  else
    update public.products set
      category_id   = nullif(p_data ->> 'category_id', '')::uuid,
      name          = btrim(p_data ->> 'name'),
      sku           = nullif(btrim(coalesce(p_data ->> 'sku', '')), ''),
      barcode       = nullif(btrim(coalesce(p_data ->> 'barcode', '')), ''),
      description   = nullif(btrim(coalesce(p_data ->> 'description', '')), ''),
      image_url     = case when p_data ? 'image_url' then nullif(p_data ->> 'image_url', '') else image_url end,
      cost_price    = coalesce(nullif(p_data ->> 'cost_price', '')::numeric, 0),
      selling_price = (p_data ->> 'selling_price')::numeric,
      minimum_stock = coalesce(nullif(p_data ->> 'minimum_stock', '')::integer, minimum_stock)
    where id = v_id and store_id = p_store_id;
    if not found then perform app.raise('NOT_FOUND: product not found'); end if;
  end if;

  select app.product_json(p, c.name, true) into v_res
    from public.products p left join public.categories c on c.id = p.category_id where p.id = v_id;
  return v_res;
end;
$$;

create or replace function public.set_product_active(p_store_id uuid, p_id uuid, p_active boolean)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform app.require_permission(p_store_id, 'products.manage');
  update public.products set is_active = p_active where id = p_id and store_id = p_store_id;
  if not found then perform app.raise('NOT_FOUND: product not found'); end if;
end;
$$;

create or replace function public.list_categories(p_store_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(r order by lower(r.name)), '[]'::jsonb) from (
    select c.id, c.name, c.description, c.created_at,
           (select count(*) from public.products p where p.category_id = c.id and p.is_active) as product_count
      from public.categories c where c.store_id = p_store_id) r;
$$;

create or replace function public.save_category(p_store_id uuid, p_id uuid, p_name text, p_description text default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid := p_id;
begin
  perform app.require_permission(p_store_id, 'products.manage');
  if coalesce(btrim(p_name), '') = '' then perform app.raise('VALIDATION: category name is required'); end if;
  if v_id is null then
    insert into public.categories (store_id, name, description)
    values (p_store_id, btrim(p_name), nullif(btrim(coalesce(p_description, '')), '')) returning id into v_id;
  else
    update public.categories set name = btrim(p_name), description = nullif(btrim(coalesce(p_description, '')), '')
     where id = v_id and store_id = p_store_id;
    if not found then perform app.raise('NOT_FOUND: category not found'); end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.delete_category(p_store_id uuid, p_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform app.require_permission(p_store_id, 'products.manage');
  delete from public.categories where id = p_id and store_id = p_store_id;
  if not found then perform app.raise('NOT_FOUND: category not found'); end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- INVENTORY
-- ---------------------------------------------------------------------------
create or replace function public.list_inventory(p_store_id uuid, p_search text default null, p_filter text default 'all',
                                                 p_limit integer default 25, p_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_like text := case when coalesce(btrim(p_search), '') = '' then null
                      else '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
  v_res jsonb;
begin
  perform app.require_permission(p_store_id, 'inventory.view');
  with f as (
    select p.id, p.name, p.sku, p.barcode, p.image_url, p.stock_quantity, p.minimum_stock, p.cost_price,
           p.selling_price, c.name as category_name, (p.stock_quantity * p.cost_price) as stock_value,
           (p.stock_quantity <= p.minimum_stock) as is_low_stock,
           (select max(m.created_at) from public.stock_movements m where m.product_id = p.id) as last_movement_at
      from public.products p left join public.categories c on c.id = p.category_id
     where p.store_id = p_store_id and p.is_active
       and (v_like is null or p.name ilike v_like or p.sku ilike v_like or p.barcode ilike v_like)
       and (p_filter = 'all' or (p_filter = 'low' and p.stock_quantity <= p.minimum_stock)
            or (p_filter = 'out' and p.stock_quantity = 0))
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'rows', coalesce((select jsonb_agg(to_jsonb(x) order by x.is_low_stock desc, lower(x.name), x.id) from (
               select * from f order by is_low_stock desc, lower(name), id
               limit least(greatest(p_limit, 1), 500) offset greatest(p_offset, 0)) x), '[]'::jsonb),
    'summary', (select jsonb_build_object(
                  'product_count', count(*), 'total_units', coalesce(sum(stock_quantity), 0),
                  'stock_value_cost', coalesce(sum(stock_quantity * cost_price), 0),
                  'stock_value_retail', coalesce(sum(stock_quantity * selling_price), 0),
                  'low_stock_count', count(*) filter (where stock_quantity <= minimum_stock),
                  'out_of_stock_count', count(*) filter (where stock_quantity = 0))
                from public.products where store_id = p_store_id and is_active))
  into v_res;
  return v_res;
end;
$$;

create or replace function public.list_movements(p_store_id uuid, p_product_id uuid default null, p_type text default null,
                                                 p_from date default null, p_to date default null, p_search text default null,
                                                 p_limit integer default 25, p_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_tz   text;
  v_like text := case when coalesce(btrim(p_search), '') = '' then null
                      else '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
  v_res  jsonb;
begin
  perform app.require_permission(p_store_id, 'inventory.view');
  select timezone into v_tz from public.stores where id = p_store_id;
  with f as (
    select m.id, m.product_id, p.name as product_name, p.sku, m.movement_type, m.previous_quantity,
           m.quantity_changed, m.new_quantity, m.reason, m.reference_id, m.created_at,
           coalesce(u.full_name, u.email) as performed_by_name
      from public.stock_movements m
      join public.products p on p.id = m.product_id
      left join public.profiles u on u.id = m.performed_by
     where m.store_id = p_store_id
       and (p_product_id is null or m.product_id = p_product_id)
       and (p_type is null or m.movement_type = p_type)
       and (p_from is null or m.created_at >= p_from::timestamp at time zone v_tz)
       and (p_to is null or m.created_at < (p_to + 1)::timestamp at time zone v_tz)
       and (v_like is null or p.name ilike v_like or p.sku ilike v_like)
  )
  select jsonb_build_object('total', (select count(*) from f),
    'rows', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id) from (
              select * from f order by created_at desc, id
              limit least(greatest(p_limit, 1), 500) offset greatest(p_offset, 0)) x), '[]'::jsonb))
  into v_res;
  return v_res;
end;
$$;

create or replace function public.inventory_report(p_store_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  b record;
begin
  perform app.require_permission(p_store_id, 'reports.view');
  select * into b from app.range_bounds(p_store_id, p_from, p_to, 3660);
  return jsonb_build_object(
    'valuation', coalesce((select jsonb_agg(r order by r.value_cost desc) from (
        select coalesce(c.name, 'Uncategorized') as category, count(*) as products, sum(p.stock_quantity) as units,
               sum(p.stock_quantity * p.cost_price) as value_cost, sum(p.stock_quantity * p.selling_price) as value_retail
          from public.products p left join public.categories c on c.id = p.category_id
         where p.store_id = p_store_id and p.is_active group by 1) r), '[]'::jsonb),
    'lowStock', coalesce((select jsonb_agg(r order by r.stock_quantity, r.name) from (
        select id, name, sku, stock_quantity, minimum_stock from public.products
         where store_id = p_store_id and is_active and stock_quantity <= minimum_stock limit 100) r), '[]'::jsonb),
    'movements', coalesce((select jsonb_agg(r order by r.movement_type) from (
        select movement_type, count(*) as count, sum(quantity_changed) as net_quantity
          from public.stock_movements
         where store_id = p_store_id and created_at >= b.range_start and created_at < b.range_end
         group by 1) r), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- SALES
-- ---------------------------------------------------------------------------
create or replace function public.list_sales(p_store_id uuid, p_search text default null, p_from date default null,
                                             p_to date default null, p_cashier_id uuid default null,
                                             p_payment_method text default null, p_status text default null,
                                             p_limit integer default 20, p_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_tz   text;
  v_like text := case when coalesce(btrim(p_search), '') = '' then null
                      else '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
  v_res  jsonb;
begin
  if not (app.has_permission(p_store_id, 'sales.view_all') or app.has_permission(p_store_id, 'sales.view_own')) then
    perform app.raise('FORBIDDEN: you cannot view sales');
  end if;
  select timezone into v_tz from public.stores where id = p_store_id;
  -- RLS limits users without sales.view_all to their own sales.
  with f as (
    select s.id, s.transaction_number, s.created_at, s.cashier_id, coalesce(p.full_name, p.email) as cashier_name,
           s.subtotal, s.discount, s.tax_amount, s.total_amount, s.payment_method, s.amount_received,
           s.change_amount, s.status,
           (select count(*) from public.sale_items si where si.sale_id = s.id) as item_count,
           (select pm.reference_number from public.payments pm where pm.sale_id = s.id and pm.kind = 'payment' limit 1) as reference_number
      from public.sales s left join public.profiles p on p.id = s.cashier_id
     where s.store_id = p_store_id
       and (v_like is null or s.transaction_number ilike v_like)
       and (p_from is null or s.created_at >= p_from::timestamp at time zone v_tz)
       and (p_to is null or s.created_at < (p_to + 1)::timestamp at time zone v_tz)
       and (p_cashier_id is null or s.cashier_id = p_cashier_id)
       and (p_payment_method is null or s.payment_method = p_payment_method)
       and (p_status is null or s.status = p_status)
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'totals', (select jsonb_build_object(
                 'completed_count', count(*) filter (where status = 'completed'),
                 'completed_total', coalesce(sum(total_amount) filter (where status = 'completed'), 0),
                 'refunded_total', coalesce(sum(total_amount) filter (where status = 'refunded'), 0)) from f),
    'rows', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id) from (
              select * from f order by created_at desc, id
              limit least(greatest(p_limit, 1), 20000) offset greatest(p_offset, 0)) x), '[]'::jsonb))
  into v_res;
  return v_res;
end;
$$;

create or replace function public.get_sale(p_store_id uuid, p_sale_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_res  jsonb;
  v_cost boolean := app.has_permission(p_store_id, 'reports.view');
begin
  select (to_jsonb(s) - 'client_request_id') || jsonb_build_object(
           'cashier_name', coalesce(p.full_name, p.email),
           'refunded_by_name', coalesce(r.full_name, r.email),
           'items', coalesce((select jsonb_agg((to_jsonb(si) - case when v_cost then '' else 'cost_price' end)
                                               order by si.product_name, si.id)
                              from public.sale_items si where si.sale_id = s.id), '[]'::jsonb),
           'payments', coalesce((select jsonb_agg(to_jsonb(pm) order by pm.created_at, pm.id)
                                 from public.payments pm where pm.sale_id = s.id), '[]'::jsonb))
    into v_res
    from public.sales s
    left join public.profiles p on p.id = s.cashier_id
    left join public.profiles r on r.id = s.refunded_by
   where s.id = p_sale_id and s.store_id = p_store_id;
  if v_res is null then perform app.raise('NOT_FOUND: sale not found'); end if;
  return v_res;
end;
$$;

create or replace function public.list_sale_cashiers(p_store_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
begin
  perform app.require_permission(p_store_id, 'sales.view_all');
  return coalesce((select jsonb_agg(r order by r.name) from (
    select p.id, coalesce(p.full_name, p.email) as name
      from public.store_members sm join public.profiles p on p.id = sm.profile_id
     where sm.store_id = p_store_id) r), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- USERS
-- ---------------------------------------------------------------------------
create or replace function public.list_members(p_store_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
begin
  perform app.require_permission(p_store_id, 'users.manage');
  return coalesce((select jsonb_agg(r order by r.is_active desc, lower(coalesce(r.full_name, r.email))) from (
    select p.id, p.email, p.full_name, sm.is_active, r.key as role, r.name as role_name,
           sm.created_at as member_since,
           (select max(a.created_at) from public.audit_logs a where a.user_id = p.id and a.action = 'login') as last_login_at,
           (select count(*) from public.sales s where s.cashier_id = p.id and s.store_id = sm.store_id) as sales_count
      from public.store_members sm
      join public.profiles p on p.id = sm.profile_id
      join public.roles r on r.id = sm.role_id
     where sm.store_id = p_store_id) r), '[]'::jsonb);
end;
$$;

create or replace function public.user_activity(p_store_id uuid, p_profile_id uuid, p_limit integer default 15, p_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
begin
  perform app.require_permission(p_store_id, 'audit.view');
  return jsonb_build_object(
    'total', (select count(*) from public.audit_logs a where a.user_id = p_profile_id and (a.store_id = p_store_id or a.store_id is null)),
    'rows', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id) from (
              select a.id, a.action, a.module, a.record_id, a.old_values, a.new_values, a.created_at
                from public.audit_logs a
               where a.user_id = p_profile_id and (a.store_id = p_store_id or a.store_id is null)
               order by a.created_at desc, a.id
               limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0)) x), '[]'::jsonb));
end;
$$;

create or replace function public.list_roles()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'roles', (select jsonb_agg(r order by r.name) from (
               select ro.key, ro.name, ro.description,
                      coalesce((select jsonb_agg(pe.permission_key order by pe.permission_key)
                                from public.role_permissions rp join public.permissions pe on pe.id = rp.permission_id
                                where rp.role_id = ro.id), '[]'::jsonb) as permissions
                 from public.roles ro) r),
    'permissions', (select jsonb_agg(p order by p.module, p.permission_key) from (
               select permission_key, module, description from public.permissions) p));
$$;

-- ---------------------------------------------------------------------------
-- EXPENSES
-- ---------------------------------------------------------------------------
create or replace function public.list_expenses(p_store_id uuid, p_search text default null, p_category text default null,
                                                p_from date default null, p_to date default null,
                                                p_include_voided boolean default false,
                                                p_limit integer default 20, p_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_like text := case when coalesce(btrim(p_search), '') = '' then null
                      else '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
  v_res jsonb;
begin
  perform app.require_permission(p_store_id, 'expenses.view');
  with f as (
    select e.id, e.description, e.category, e.amount, e.expense_date, e.payment_method, e.reference_number, e.notes,
           e.recorded_by, coalesce(p.full_name, p.email) as recorded_by_name, e.is_voided, e.voided_at, e.void_reason,
           coalesce(v.full_name, v.email) as voided_by_name, e.created_at, e.updated_at
      from public.expenses e
      left join public.profiles p on p.id = e.recorded_by
      left join public.profiles v on v.id = e.voided_by
     where e.store_id = p_store_id
       and (p_include_voided or not e.is_voided)
       and (v_like is null or e.description ilike v_like or e.reference_number ilike v_like)
       and (p_category is null or e.category = p_category)
       and (p_from is null or e.expense_date >= p_from)
       and (p_to is null or e.expense_date <= p_to)
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'total_amount', (select coalesce(sum(amount) filter (where not is_voided), 0) from f),
    'rows', coalesce((select jsonb_agg(to_jsonb(x) order by x.expense_date desc, x.created_at desc, x.id) from (
              select * from f order by expense_date desc, created_at desc, id
              limit least(greatest(p_limit, 1), 20000) offset greatest(p_offset, 0)) x), '[]'::jsonb))
  into v_res;
  return v_res;
end;
$$;

create or replace function public.get_expense(p_store_id uuid, p_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_res jsonb;
begin
  select to_jsonb(e) || jsonb_build_object(
           'recorded_by_name', coalesce(p.full_name, p.email),
           'voided_by_name', coalesce(v.full_name, v.email),
           'history', coalesce((select jsonb_agg(h order by h.created_at, h.id) from (
                        select a.id, a.action, a.old_values, a.new_values, a.created_at,
                               coalesce(u.full_name, u.email) as user_name
                          from public.audit_logs a left join public.profiles u on u.id = a.user_id
                         where a.module = 'expenses' and a.record_id = e.id and a.store_id = p_store_id) h), '[]'::jsonb))
    into v_res
    from public.expenses e
    left join public.profiles p on p.id = e.recorded_by
    left join public.profiles v on v.id = e.voided_by
   where e.id = p_id and e.store_id = p_store_id;
  if v_res is null then perform app.raise('NOT_FOUND: expense not found'); end if;
  return v_res;
end;
$$;

create or replace function public.save_expense(p_store_id uuid, p_id uuid, p_data jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid := p_id;
begin
  perform app.require_permission(p_store_id, 'expenses.manage');
  if coalesce(btrim(p_data ->> 'description'), '') = '' then perform app.raise('VALIDATION: description is required'); end if;
  if coalesce(nullif(p_data ->> 'amount', '')::numeric, 0) <= 0 then perform app.raise('VALIDATION: amount must be greater than zero'); end if;
  if v_id is null then
    insert into public.expenses (store_id, description, category, amount, expense_date, payment_method,
                                 reference_number, notes, recorded_by)
    values (p_store_id, btrim(p_data ->> 'description'), p_data ->> 'category', (p_data ->> 'amount')::numeric,
            coalesce(nullif(p_data ->> 'expense_date', '')::date, current_date),
            coalesce(nullif(p_data ->> 'payment_method', ''), 'cash'),
            nullif(btrim(coalesce(p_data ->> 'reference_number', '')), ''),
            nullif(btrim(coalesce(p_data ->> 'notes', '')), ''), app.current_profile_id())
    returning id into v_id;
  else
    if exists (select 1 from public.expenses where id = v_id and store_id = p_store_id and is_voided) then
      perform app.raise('CONFLICT: a voided expense cannot be edited');
    end if;
    update public.expenses set
      description = btrim(p_data ->> 'description'), category = p_data ->> 'category',
      amount = (p_data ->> 'amount')::numeric, expense_date = (p_data ->> 'expense_date')::date,
      payment_method = coalesce(nullif(p_data ->> 'payment_method', ''), 'cash'),
      reference_number = nullif(btrim(coalesce(p_data ->> 'reference_number', '')), ''),
      notes = nullif(btrim(coalesce(p_data ->> 'notes', '')), '')
    where id = v_id and store_id = p_store_id;
    if not found then perform app.raise('NOT_FOUND: expense not found'); end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.void_expense(p_store_id uuid, p_id uuid, p_reason text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform app.require_permission(p_store_id, 'expenses.manage');
  if coalesce(btrim(p_reason), '') = '' then perform app.raise('VALIDATION: a reason is required'); end if;
  update public.expenses
     set is_voided = true, voided_at = now(), voided_by = app.current_profile_id(), void_reason = btrim(p_reason)
   where id = p_id and store_id = p_store_id and not is_voided;
  if not found then perform app.raise('NOT_FOUND: expense not found or already voided'); end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- SETTINGS & AUDIT
-- ---------------------------------------------------------------------------
-- Updates only the keys present in p_data.
create or replace function public.update_store_settings(p_store_id uuid, p_data jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_res jsonb;
  d jsonb := p_data;
begin
  perform app.require_permission(p_store_id, 'settings.manage');
  if d ? 'store_name' and coalesce(btrim(d ->> 'store_name'), '') = '' then
    perform app.raise('VALIDATION: store name is required');
  end if;
  update public.stores s set
    store_name     = case when d ? 'store_name' then btrim(d ->> 'store_name') else s.store_name end,
    store_address  = case when d ? 'store_address' then nullif(btrim(coalesce(d ->> 'store_address', '')), '') else s.store_address end,
    contact_number = case when d ? 'contact_number' then nullif(btrim(coalesce(d ->> 'contact_number', '')), '') else s.contact_number end,
    business_email = case when d ? 'business_email' then nullif(lower(btrim(coalesce(d ->> 'business_email', ''))), '') else s.business_email end,
    business_type  = case when d ? 'business_type' then nullif(d ->> 'business_type', '') else s.business_type end,
    logo_url       = case when d ? 'logo_url' then nullif(d ->> 'logo_url', '') else s.logo_url end,
    timezone       = case when d ? 'timezone' then d ->> 'timezone' else s.timezone end,
    date_format    = case when d ? 'date_format' then d ->> 'date_format' else s.date_format end,
    receipt_footer = case when d ? 'receipt_footer' then nullif(btrim(coalesce(d ->> 'receipt_footer', '')), '') else s.receipt_footer end,
    receipt_paper  = case when d ? 'receipt_paper' then d ->> 'receipt_paper' else s.receipt_paper end,
    tax_enabled    = case when d ? 'tax_enabled' then (d ->> 'tax_enabled')::boolean else s.tax_enabled end,
    tax_name       = case when d ? 'tax_name' then btrim(d ->> 'tax_name') else s.tax_name end,
    tax_rate       = case when d ? 'tax_rate' then (d ->> 'tax_rate')::numeric else s.tax_rate end,
    tax_inclusive  = case when d ? 'tax_inclusive' then (d ->> 'tax_inclusive')::boolean else s.tax_inclusive end,
    allow_cashier_discount = case when d ? 'allow_cashier_discount' then (d ->> 'allow_cashier_discount')::boolean else s.allow_cashier_discount end,
    max_discount_percent   = case when d ? 'max_discount_percent' then (d ->> 'max_discount_percent')::numeric else s.max_discount_percent end,
    default_low_stock_threshold = case when d ? 'default_low_stock_threshold' then (d ->> 'default_low_stock_threshold')::integer else s.default_low_stock_threshold end,
    low_stock_alerts = case when d ? 'low_stock_alerts' then (d ->> 'low_stock_alerts')::boolean else s.low_stock_alerts end
  where s.id = p_store_id
  returning to_jsonb(s) - 'sale_sequence' - 'created_by' into v_res;
  if v_res is null then perform app.raise('NOT_FOUND: store not found'); end if;
  return v_res;
end;
$$;

create or replace function public.list_audit_logs(p_store_id uuid, p_module text default null,
                                                  p_limit integer default 25, p_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
begin
  perform app.require_permission(p_store_id, 'audit.view');
  return jsonb_build_object(
    'total', (select count(*) from public.audit_logs a where a.store_id = p_store_id and (p_module is null or a.module = p_module)),
    'rows', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id) from (
              select a.id, a.action, a.module, a.record_id, a.old_values, a.new_values, a.created_at,
                     coalesce(p.full_name, p.email) as user_name
                from public.audit_logs a left join public.profiles p on p.id = a.user_id
               where a.store_id = p_store_id and (p_module is null or a.module = p_module)
               order by a.created_at desc, a.id
               limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0)) x), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges for browser requests (anon role carrying a verified
-- Firebase token). Everything else stays revoked.
-- ---------------------------------------------------------------------------
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke all on function %s from public', f.sig);
  end loop;
end;
$$;

grant execute on function
  app.jwt_claims(), app.jwt_uid(), app.firebase_project_id(), app.current_profile_id(),
  app.permitted_store_ids(text), app.member_store_ids(), app.has_permission(uuid, text),
  app.require_permission(uuid, text), app.range_bounds(uuid, date, date, integer),
  app.is_pending_initial_admin(), app.raise(text), app.product_json(public.products, text, boolean)
  to anon, authenticated;

grant execute on function
  public.get_setup_status(),
  public.claim_initial_admin_self(text),
  public.get_my_context(uuid),
  public.record_auth_event(text, uuid),
  public.complete_store_setup(jsonb),
  public.process_sale(uuid, uuid, jsonb, text, numeric, text, numeric, text),
  public.refund_sale(uuid, uuid, text),
  public.adjust_stock(uuid, uuid, text, integer, text),
  public.create_store_member(uuid, text, text, text, text),
  public.update_store_member(uuid, uuid, text, text, boolean),
  public.update_my_profile(text),
  public.dashboard_summary(uuid, date, date),
  public.sales_report(uuid, date, date, text),
  public.list_products(uuid, text, uuid, text, text, text, text, integer, integer),
  public.lookup_product(uuid, text),
  public.save_product(uuid, uuid, jsonb, integer),
  public.set_product_active(uuid, uuid, boolean),
  public.list_categories(uuid),
  public.save_category(uuid, uuid, text, text),
  public.delete_category(uuid, uuid),
  public.list_inventory(uuid, text, text, integer, integer),
  public.list_movements(uuid, uuid, text, date, date, text, integer, integer),
  public.inventory_report(uuid, date, date),
  public.list_sales(uuid, text, date, date, uuid, text, text, integer, integer),
  public.get_sale(uuid, uuid),
  public.list_sale_cashiers(uuid),
  public.list_members(uuid),
  public.user_activity(uuid, uuid, integer, integer),
  public.list_roles(),
  public.list_expenses(uuid, text, text, date, date, boolean, integer, integer),
  public.get_expense(uuid, uuid),
  public.save_expense(uuid, uuid, jsonb),
  public.void_expense(uuid, uuid, text),
  public.update_store_settings(uuid, jsonb),
  public.list_audit_logs(uuid, text, integer, integer)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- STORAGE: browser uploads (store logos, product images).
--   store-assets/<store_id>/<file>       requires settings.manage
--   store-assets/setup/<profile_id>/<f>  initial admin during setup only
--   product-images/<store_id>/<file>     requires products.manage
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'objects') then
    execute $p$
      create policy pos_upload_store_assets on storage.objects for insert to anon, authenticated
      with check (
        bucket_id = 'store-assets' and app.current_profile_id() is not null and (
          (storage.foldername(name))[1] in (select s::text from app.permitted_store_ids('settings.manage') s)
          or ((storage.foldername(name))[1] = 'setup'
              and (storage.foldername(name))[2] = app.current_profile_id()::text
              and app.is_pending_initial_admin())))
    $p$;
    execute $p$
      create policy pos_upload_product_images on storage.objects for insert to anon, authenticated
      with check (
        bucket_id = 'product-images' and app.current_profile_id() is not null
        and (storage.foldername(name))[1] in (select s::text from app.permitted_store_ids('products.manage') s))
    $p$;
  end if;
end;
$$;


-- ############################################################################
-- PART 7 — TODAY'S MENU (shareable public menu)
-- ############################################################################
-- =============================================================================
-- An administrator picks which products are available on a given day. Each
-- store has ONE secret share link (menu.html?s=<token>) that always shows
-- today's menu in the store's time zone, so it can be posted once on
-- Messenger / Facebook and stays valid. Customers need no account: the public
-- function below returns only menu data (name, description, picture, price,
-- sold out) — never cost, stock counts or anything else. Resetting the link
-- makes the old one stop working.
-- =============================================================================

insert into public.permissions (permission_key, module, description)
values ('menu.manage', 'menu', 'Choose the products on the shareable daily menu')
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.permission_key = 'menu.manage'
 where r.key = 'administrator'
on conflict (role_id, permission_id) do nothing;

create table if not exists public.menu_links (
  store_id    uuid primary key references public.stores(id) on delete restrict,
  token       text not null unique check (token ~ '^[a-f0-9]{32}$'),
  created_at  timestamptz not null default now()
);

create table if not exists public.daily_menus (
  store_id       uuid not null references public.stores(id) on delete restrict,
  menu_date      date not null,
  product_ids    uuid[] not null default '{}' check (cardinality(product_ids) <= 500),
  note           text check (note is null or length(note) <= 500),
  mark_sold_out  boolean not null default true,
  updated_by     uuid references public.profiles(id),
  updated_at     timestamptz not null default now(),
  primary key (store_id, menu_date)
);

-- No policies and no table privileges: these tables are only reachable
-- through the functions below.
alter table public.menu_links  enable row level security;
alter table public.daily_menus enable row level security;
revoke all on public.menu_links, public.daily_menus from public, anon, authenticated;
grant all on public.menu_links, public.daily_menus to service_role;

-- Returns the store's share token, creating it on first use.
create or replace function app.menu_token(p_store_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_token text;
begin
  insert into public.menu_links (store_id, token)
  values (p_store_id, replace(gen_random_uuid()::text, '-', ''))
  on conflict (store_id) do nothing;
  select token into v_token from public.menu_links where store_id = p_store_id;
  return v_token;
end;
$$;

create or replace function app.store_today(p_store_id uuid)
returns date language sql stable security definer set search_path = '' as $$
  select (now() at time zone s.timezone)::date from public.stores s where s.id = p_store_id;
$$;

-- Menu for one day (admin screen). p_date null = today in the store's time zone.
create or replace function public.get_menu(p_store_id uuid, p_date date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_today date;
  v_date  date;
  v_menu  public.daily_menus%rowtype;
begin
  perform app.require_permission(p_store_id, 'menu.manage');
  v_today := app.store_today(p_store_id);
  v_date := coalesce(p_date, v_today);
  select * into v_menu from public.daily_menus where store_id = p_store_id and menu_date = v_date;
  return jsonb_build_object(
    'date', v_date,
    'today', v_today,
    'saved', v_menu.store_id is not null,
    'product_ids', to_jsonb(coalesce(v_menu.product_ids, '{}'::uuid[])),
    'note', v_menu.note,
    'mark_sold_out', coalesce(v_menu.mark_sold_out, true),
    'updated_at', v_menu.updated_at,
    'updated_by_name', (select coalesce(p.full_name, p.email) from public.profiles p where p.id = v_menu.updated_by),
    'token', app.menu_token(p_store_id));
end;
$$;

-- Saves the products available on a day (order is kept; unknown ids are dropped).
create or replace function public.save_menu(p_store_id uuid, p_date date, p_product_ids uuid[],
                                            p_note text default null, p_mark_sold_out boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app.require_permission(p_store_id, 'menu.manage');
  v_ids   uuid[];
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_date is null then perform app.raise('VALIDATION: choose a date'); end if;
  if cardinality(coalesce(p_product_ids, '{}')) > 500 then perform app.raise('VALIDATION: a menu can hold at most 500 products'); end if;
  if length(v_note) > 500 then perform app.raise('VALIDATION: the note can be at most 500 characters'); end if;

  select coalesce(array_agg(x.id order by x.ord), '{}') into v_ids from (
    select distinct on (u.id) u.id, u.ord
      from unnest(coalesce(p_product_ids, '{}')) with ordinality u(id, ord)
      join public.products p on p.id = u.id and p.store_id = p_store_id and p.is_active
     order by u.id, u.ord) x;

  insert into public.daily_menus (store_id, menu_date, product_ids, note, mark_sold_out, updated_by, updated_at)
  values (p_store_id, p_date, v_ids, v_note, coalesce(p_mark_sold_out, true), v_actor, now())
  on conflict (store_id, menu_date) do update
     set product_ids = excluded.product_ids, note = excluded.note, mark_sold_out = excluded.mark_sold_out,
         updated_by = excluded.updated_by, updated_at = excluded.updated_at;

  perform app.write_audit(p_store_id, v_actor, 'menu.save', 'menu', null, null,
    jsonb_build_object('date', p_date, 'products', cardinality(v_ids), 'note', v_note));
  return public.get_menu(p_store_id, p_date);
end;
$$;

-- Replaces the share link; the old link stops working immediately.
create or replace function public.reset_menu_link(p_store_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app.require_permission(p_store_id, 'menu.manage');
  v_token text := replace(gen_random_uuid()::text, '-', '');
begin
  insert into public.menu_links (store_id, token) values (p_store_id, v_token)
  on conflict (store_id) do update set token = excluded.token, created_at = now();
  perform app.write_audit(p_store_id, v_actor, 'menu.reset_link', 'menu', null, null, null);
  return v_token;
end;
$$;

-- PUBLIC (no sign-in): the menu customers see through the share link.
create or replace function public.get_public_menu(p_token text, p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_store public.stores%rowtype;
  v_today date;
  v_date  date;
  v_menu  public.daily_menus%rowtype;
begin
  select s.* into v_store
    from public.menu_links l join public.stores s on s.id = l.store_id and s.is_active
   where l.token = lower(btrim(coalesce(p_token, '')));
  if v_store.id is null then
    perform app.raise('NOT_FOUND: this menu link is not valid. Ask the store for a new link.');
  end if;
  v_today := (now() at time zone v_store.timezone)::date;
  v_date := coalesce(p_date, v_today);
  select * into v_menu from public.daily_menus where store_id = v_store.id and menu_date = v_date;

  return jsonb_build_object(
    'store', jsonb_build_object('name', v_store.store_name, 'logo_url', v_store.logo_url,
                                'address', v_store.store_address, 'contact_number', v_store.contact_number,
                                'currency', v_store.currency, 'timezone', v_store.timezone),
    'date', v_date,
    'today', v_today,
    'note', v_menu.note,
    'updated_at', v_menu.updated_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'name', p.name, 'description', p.description, 'image_url', p.image_url,
               'price', p.selling_price, 'category', c.name,
               'sold_out', v_menu.mark_sold_out and p.stock_quantity <= 0)
             order by u.ord)
        from unnest(v_menu.product_ids) with ordinality u(id, ord)
        join public.products p on p.id = u.id and p.store_id = v_store.id and p.is_active
        left join public.categories c on c.id = p.category_id), '[]'::jsonb));
end;
$$;

revoke all on function app.menu_token(uuid), app.store_today(uuid),
  public.get_menu(uuid, date), public.save_menu(uuid, date, uuid[], text, boolean),
  public.reset_menu_link(uuid), public.get_public_menu(text, date)
  from public;
grant execute on function
  public.get_menu(uuid, date), public.save_menu(uuid, date, uuid[], text, boolean),
  public.reset_menu_link(uuid), public.get_public_menu(text, date)
  to anon, authenticated;


-- ############################################################################
-- PART 8 — SELF-SERVICE REGISTRATION (new account + new store)
-- ############################################################################
-- =============================================================================
-- After the first-run setup, anyone can create an account together with their
-- OWN store and becomes that store's administrator. Every business record is
-- scoped by store_id and row level security only shows stores the user is a
-- member of, so stores never see each other's products, stock, sales,
-- expenses, users or audit logs.
-- One account = one store: staff of an existing store cannot register another.
-- =============================================================================

create or replace function public.register_store(p_full_name text, p_store jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid      text := app.jwt_uid();
  v_email    text := lower(btrim(coalesce(app.jwt_claims() ->> 'email', '')));
  v_name     text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_profile  public.profiles%rowtype;
  v_store_id uuid;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED: please sign in' using errcode = 'P0001';
  end if;
  if v_email = '' then
    raise exception 'VALIDATION: the account has no email address' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.system_settings where singleton and setup_completed) then
    raise exception 'SETUP_NOT_COMPLETED: finish the first-run setup before registering more stores' using errcode = 'P0001';
  end if;
  if v_name is null or length(v_name) > 120 then
    raise exception 'VALIDATION: your name is required (up to 120 characters)' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_store ->> 'store_name'), '') = '' then
    raise exception 'VALIDATION: store name is required' using errcode = 'P0001';
  end if;

  select * into v_profile from public.profiles where firebase_uid = v_uid for update;
  if found then
    if exists (select 1 from public.store_members where profile_id = v_profile.id) then
      raise exception 'ALREADY_REGISTERED: this account already belongs to a store. Sign in instead.' using errcode = 'P0001';
    end if;
    if not v_profile.is_active then
      raise exception 'ACCOUNT_INACTIVE: your account has been deactivated' using errcode = 'P0001';
    end if;
    update public.profiles set full_name = v_name where id = v_profile.id;
  else
    if exists (select 1 from public.profiles where lower(email) = v_email) then
      raise exception 'CONFLICT: an account with this email already exists' using errcode = 'P0001';
    end if;
    insert into public.profiles (firebase_uid, email, full_name) values (v_uid, v_email, v_name)
    returning * into v_profile;
  end if;
  perform set_config('app.actor_id', v_profile.id::text, true);

  insert into public.stores (
    store_name, store_address, contact_number, business_email, business_type,
    currency, timezone, date_format, receipt_footer, created_by)
  values (
    btrim(p_store ->> 'store_name'),
    nullif(btrim(coalesce(p_store ->> 'store_address', '')), ''),
    nullif(btrim(coalesce(p_store ->> 'contact_number', '')), ''),
    nullif(lower(btrim(coalesce(p_store ->> 'business_email', ''))), ''),
    nullif(btrim(coalesce(p_store ->> 'business_type', '')), ''),
    'PHP',
    coalesce(nullif(p_store ->> 'timezone', ''), 'Asia/Manila'),
    coalesce(nullif(p_store ->> 'date_format', ''), 'DD/MM/YYYY'),
    coalesce(nullif(btrim(coalesce(p_store ->> 'receipt_footer', '')), ''), 'Thank you for your purchase!'),
    v_profile.id)
  returning id into v_store_id;

  insert into public.store_members (store_id, profile_id, role_id)
  select v_store_id, v_profile.id, r.id from public.roles r where r.key = 'administrator';

  perform app.write_audit(v_store_id, v_profile.id, 'register', 'setup', v_store_id, null,
    jsonb_build_object('store_name', btrim(p_store ->> 'store_name'), 'email', v_email));
  return v_store_id;
end;
$$;

-- Login-page branding: with several stores the login page is shared, so it
-- shows the generic title instead of one store's name and logo.
create or replace function public.get_setup_status()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'adminClaimed', ss.admin_claimed_at is not null,
    'setupCompleted', ss.setup_completed,
    'store', case when ss.setup_completed and (select count(*) from public.stores s where s.is_active) = 1 then (
               select jsonb_build_object('store_name', s.store_name, 'logo_url', s.logo_url)
               from public.stores s where s.is_active limit 1) end)
  from public.system_settings ss where ss.singleton;
$$;

revoke all on function public.register_store(text, jsonb) from public;
grant execute on function public.register_store(text, jsonb), public.get_setup_status() to anon, authenticated;

-- ############################################################################
-- PART 9 — sales by item report
-- ############################################################################
-- Total sales per item for a date range (store time zone). Completed sales count
-- toward quantity/sales/cost/profit; refunded quantities are shown separately.
-- Sales are item price x quantity before sale-level discounts (shown in totals).
create or replace function public.sales_by_item(
  p_store_id uuid, p_from date, p_to date, p_include_unsold boolean default false)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  b record;
  v_result jsonb;
begin
  perform app.require_permission(p_store_id, 'reports.view');
  select * into b from app.range_bounds(p_store_id, p_from, p_to, 3660);

  with s as (
    select id, status, discount from public.sales
     where store_id = p_store_id and created_at >= b.range_start and created_at < b.range_end
  ),
  sold as (
    select si.product_id,
           coalesce(sum(si.quantity) filter (where s.status = 'completed'), 0)::int       as quantity,
           coalesce(sum(si.subtotal) filter (where s.status = 'completed'), 0)            as sales,
           coalesce(sum(si.quantity * si.cost_price) filter (where s.status = 'completed'), 0) as cost,
           count(distinct s.id) filter (where s.status = 'completed')                     as transactions,
           coalesce(sum(si.quantity) filter (where s.status = 'refunded'), 0)::int        as refunded_quantity,
           max(si.product_name)                                                           as sold_as
      from s join public.sale_items si on si.sale_id = s.id
     group by si.product_id
  ),
  rows as (
    select p.id as product_id,
           p.name as product_name,
           p.sku,
           p.barcode,
           c.name as category_name,
           p.is_active,
           p.stock_quantity,
           coalesce(sold.quantity, 0)          as quantity,
           coalesce(sold.transactions, 0)      as transactions,
           coalesce(sold.sales, 0)             as sales,
           coalesce(sold.cost, 0)              as cost,
           coalesce(sold.sales, 0) - coalesce(sold.cost, 0) as profit,
           case when coalesce(sold.quantity, 0) > 0 then round(sold.sales / sold.quantity, 2) else 0 end as average_price,
           coalesce(sold.refunded_quantity, 0) as refunded_quantity
      from public.products p
      left join sold on sold.product_id = p.id
      left join public.categories c on c.id = p.category_id
     where p.store_id = p_store_id
       and (sold.product_id is not null or (p_include_unsold and p.is_active))
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(r) order by r.sales desc, r.quantity desc, lower(r.product_name)) from rows r), '[]'::jsonb),
    'totals', (select jsonb_build_object(
                 'items',             count(*),
                 'items_sold',        count(*) filter (where quantity > 0),
                 'quantity',          coalesce(sum(quantity), 0),
                 'sales',             coalesce(sum(sales), 0),
                 'cost',              coalesce(sum(cost), 0),
                 'profit',            coalesce(sum(profit), 0),
                 'refunded_quantity', coalesce(sum(refunded_quantity), 0),
                 'discounts',         (select coalesce(sum(discount), 0) from s where status = 'completed'))
               from rows))
  into v_result;
  return v_result;
end;
$$;

revoke all on function public.sales_by_item(uuid, date, date, boolean) from public;
grant execute on function public.sales_by_item(uuid, date, date, boolean) to anon, authenticated;
