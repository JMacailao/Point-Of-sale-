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
