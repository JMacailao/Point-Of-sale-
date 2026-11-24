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
