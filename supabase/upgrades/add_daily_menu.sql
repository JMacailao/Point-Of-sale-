-- =============================================================================
--  POS SYSTEM — UPGRADE: add "Today's Menu" (shareable menu link)
--
--  Only for databases installed BEFORE the Menu module existed.
--  (A fresh setup.sql already includes it — do not run this after setup.sql.)
--
--  Supabase dashboard > SQL Editor > New query > paste this whole file > Run.
--  Safe to run more than once.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'claim_initial_admin_self') then
    raise exception 'The POS database is not installed in this project. Run supabase/setup.sql instead (it already includes the menu).';
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
