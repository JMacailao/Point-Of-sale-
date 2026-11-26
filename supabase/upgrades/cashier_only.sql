-- =============================================================================
--  POS SYSTEM — UPGRADE: Cashier role uses the Cashier screen only
--
--  Cashiers lose Dashboard, Products and Revenue & Sales pages; they keep the
--  Cashier screen (with product search, scanning and receipts for the sales
--  they ring up). Administrators are unchanged.
--
--  Only for databases installed BEFORE this change (a fresh setup.sql already
--  includes it). Supabase > SQL Editor > paste this whole file > Run.
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

-- A cashier can always read the sales they rang up (needed for the receipt).
alter policy sales_select on public.sales using (
  store_id in (select app.permitted_store_ids('sales.view_all'))
  or (cashier_id = (select app.current_profile_id())
      and (store_id in (select app.permitted_store_ids('sales.view_own'))
           or store_id in (select app.permitted_store_ids('pos.use'))))
);

delete from public.role_permissions rp
 using public.roles r, public.permissions p
 where rp.role_id = r.id and rp.permission_id = p.id
   and r.key = 'cashier'
   and p.permission_key in ('dashboard.view', 'products.view', 'sales.view_own');

select 'Cashier role now uses the Cashier screen only.' as result;
