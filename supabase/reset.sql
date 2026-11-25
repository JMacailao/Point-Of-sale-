-- =============================================================================
--  POS SYSTEM — RESET (deletes the POS database so setup.sql can run again)
--
--  !!! WARNING: this PERMANENTLY DELETES every table listed below and ALL of
--  !!! its data (products, sales, users, expenses...). It also deletes tables
--  !!! with these names that belong to ANY other app in this project.
--
--  Use it only on a project whose data you do not need. Then run setup.sql.
--  Images already uploaded to Storage are kept (delete them in Storage if needed).
-- =============================================================================

-- Storage upload rules created by setup.sql
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'objects') then
    drop policy if exists pos_upload_store_assets on storage.objects;
    drop policy if exists pos_upload_product_images on storage.objects;
  end if;
end;
$$;

-- Tables (and their triggers, policies, indexes)
drop table if exists
  public.daily_menus, public.menu_links, public.audit_logs, public.expenses, public.stock_movements, public.payments, public.sale_items, public.sales,
  public.products, public.categories, public.store_members, public.stores, public.role_permissions,
  public.permissions, public.roles, public.system_settings, public.profiles
  cascade;

-- Functions created by setup.sql
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in (
       'adjust_stock','claim_initial_admin','claim_initial_admin_self','complete_store_setup','create_store_member',
       'dashboard_summary','delete_category','get_expense','get_my_context','get_sale','get_setup_status',
       'inventory_report','list_audit_logs','list_categories','list_expenses','list_inventory','list_members',
       'list_movements','list_products','list_roles','list_sale_cashiers','list_sales','lookup_product',
       'process_sale','record_auth_event','refund_sale','sales_report','save_category','save_expense',
       'save_product','set_product_active','update_my_profile','update_store_member','update_store_settings',
       'user_activity','void_expense','get_menu','save_menu','reset_menu_link','get_public_menu')
  loop
    execute format('drop function if exists %s cascade', f.sig);
  end loop;
end;
$$;

-- Private helper schema
drop schema if exists app cascade;

select 'POS database removed. Now run setup.sql.' as result;
