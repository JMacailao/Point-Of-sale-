-- =============================================================================
-- UPGRADE 001 — "Sales by Item" report
-- Run this in the Supabase SQL Editor if setup.sql was installed BEFORE this
-- report existed. Safe to run more than once. (New installs already have it.)
-- =============================================================================

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
