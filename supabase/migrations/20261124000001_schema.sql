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
