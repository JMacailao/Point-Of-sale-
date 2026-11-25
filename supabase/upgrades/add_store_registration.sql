-- =============================================================================
--  POS SYSTEM — UPGRADE: self-service registration (new account + new store)
--
--  Only for databases installed BEFORE registration existed.
--  (A fresh setup.sql already includes it — do not run this after setup.sql.)
--
--  Supabase dashboard > SQL Editor > New query > paste this whole file > Run.
--  Safe to run more than once.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'claim_initial_admin_self') then
    raise exception 'The POS database is not installed in this project. Run supabase/setup.sql instead (it already includes registration).';
  end if;
end;
$$;

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
