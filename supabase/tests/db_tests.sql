-- =============================================================================
-- Database test suite (run on a fresh local database after the migrations).
--   ./supabase/tests/run_db_tests.sh
-- Each block impersonates a user the same way the backend does:
--   SET LOCAL ROLE authenticated + request.jwt.claims = {"sub": <firebase uid>}
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

create schema if not exists test_helpers;
create or replace function test_helpers.expect_error(p_sql text, p_prefix text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm not like p_prefix || '%' then
      raise exception 'expected error "%" but got "%" for: %', p_prefix, sqlerrm, p_sql;
    end if;
    return;
  end;
  raise exception 'expected error "%" but statement succeeded: %', p_prefix, p_sql;
end $$;
create or replace function test_helpers.assert(p_cond boolean, p_msg text)
returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'ASSERTION FAILED: %', p_msg; end if;
end $$;
grant usage on schema test_helpers to authenticated, anon, service_role;
grant execute on all functions in schema test_helpers to authenticated, anon, service_role;
create table test_helpers.vars (k text primary key, v text);
grant all on test_helpers.vars to authenticated;

\echo '1. initial administrator claim is atomic and single-use'
set role service_role;
select public.claim_initial_admin('uid-admin', 'Admin@Example.com', 'Ada Admin') is not null;
select test_helpers.expect_error($$select public.claim_initial_admin('uid-intruder', 'x@example.com')$$, 'SETUP_ALREADY_CLAIMED');
reset role;
select test_helpers.assert((select count(*) = 1 from profiles), 'exactly one profile after claim');
select test_helpers.assert((select email = 'admin@example.com' from profiles), 'email normalized');

\echo '2. anon and authenticated cannot claim admin or read system settings'
begin;
set local role anon;
select test_helpers.expect_error($$select public.claim_initial_admin('a','b@c.de')$$, 'permission denied');
select test_helpers.expect_error($$select * from public.products$$, 'permission denied');
rollback;
begin;
select set_config('request.jwt.claims', '{"sub":"uid-admin"}', true);
set local role authenticated;
select test_helpers.expect_error($$select public.claim_initial_admin('a','b@c.de')$$, 'permission denied');
select test_helpers.expect_error($$select * from public.system_settings$$, 'permission denied');
rollback;

\echo '3. only the initial admin can complete store setup, once'
begin;
insert into profiles (firebase_uid, email) values ('uid-stranger', 'stranger@example.com');
commit;
begin;
select set_config('request.jwt.claims', '{"sub":"uid-stranger"}', true);
set local role authenticated;
select test_helpers.expect_error($$select public.complete_store_setup('{"store_name":"Evil"}')$$, 'FORBIDDEN');
rollback;
begin;
select set_config('request.jwt.claims', '{"sub":"uid-admin"}', true);
set local role authenticated;
select test_helpers.expect_error($$select public.complete_store_setup('{"store_name":"  "}')$$, 'VALIDATION');
select test_helpers.expect_error($$select public.complete_store_setup('{"store_name":"A","timezone":"Mars/Base"}')$$, 'VALIDATION');
insert into test_helpers.vars values ('store1', public.complete_store_setup(
  '{"store_name":"Sari-Sari Store","business_type":"retail","receipt_footer":"Salamat!"}')::text);
select test_helpers.expect_error($$select public.complete_store_setup('{"store_name":"Second"}')$$, 'SETUP_ALREADY_COMPLETED');
commit;
select test_helpers.assert((select setup_completed from system_settings), 'setup completed');

\echo '4. product creation under RLS; stock cannot be written directly'
begin;
select set_config('request.jwt.claims', '{"sub":"uid-admin"}', true);
set local role authenticated;
insert into categories (store_id, name) select v::uuid, 'Drinks' from test_helpers.vars where k = 'store1';
insert into products (store_id, category_id, name, sku, barcode, cost_price, selling_price, minimum_stock)
select v::uuid, (select id from categories where name = 'Drinks'), 'Cola 330ml', 'COLA-330', '4800000000017', 12.50, 20.00, 5
from test_helpers.vars where k = 'store1';
insert into products (store_id, name, sku, cost_price, selling_price)
select v::uuid, 'Bread', 'BREAD', 30, 45.50 from test_helpers.vars where k = 'store1';
select test_helpers.expect_error($$insert into products (store_id, name, selling_price, stock_quantity)
  select v::uuid, 'Sneaky', 1, 100 from test_helpers.vars where k = 'store1'$$, 'permission denied');
select test_helpers.expect_error($$update products set stock_quantity = 999$$, 'permission denied');
select test_helpers.expect_error($$insert into products (store_id, name, sku, selling_price)
  select v::uuid, 'Dup', 'cola-330', 1 from test_helpers.vars where k = 'store1'$$, 'duplicate key');
commit;
-- even the table owner cannot bypass the movement requirement
select test_helpers.expect_error($$update products set stock_quantity = 5$$, 'STOCK_WRITE_FORBIDDEN');

\echo '5. stock in / out / adjustment record movements and prevent negatives'
begin;
select set_config('request.jwt.claims', '{"sub":"uid-admin"}', true);
set local role authenticated;
select public.adjust_stock(s.v::uuid, p.id, 'stock_in', 50, 'Initial stock') from test_helpers.vars s, products p where s.k='store1' and p.sku='COLA-330';
select public.adjust_stock(s.v::uuid, p.id, 'stock_in', 10, null) from test_helpers.vars s, products p where s.k='store1' and p.sku='BREAD';
select public.adjust_stock(s.v::uuid, p.id, 'stock_out', 5, 'Damaged') from test_helpers.vars s, products p where s.k='store1' and p.sku='COLA-330';
select test_helpers.expect_error($$select public.adjust_stock(s.v::uuid, p.id, 'stock_out', 500, 'Too many') from test_helpers.vars s, products p where s.k='store1' and p.sku='COLA-330'$$, 'INSUFFICIENT_STOCK');
select test_helpers.expect_error($$select public.adjust_stock(s.v::uuid, p.id, 'stock_out', 1, '') from test_helpers.vars s, products p where s.k='store1' and p.sku='COLA-330'$$, 'VALIDATION');
select public.adjust_stock(s.v::uuid, p.id, 'adjustment', 40, 'Cycle count') from test_helpers.vars s, products p where s.k='store1' and p.sku='COLA-330';
select test_helpers.assert((select stock_quantity = 40 from products where sku = 'COLA-330'), 'cola stock is 40');
select test_helpers.assert((select count(*) = 4 from stock_movements), 'four movements recorded');
select test_helpers.assert((select bool_and(new_quantity = previous_quantity + quantity_changed) from stock_movements), 'movement math');
commit;

\echo '6. cashier: create via users.manage, limited permissions'
begin;
select set_config('request.jwt.claims', '{"sub":"uid-admin"}', true);
set local role authenticated;
select public.create_store_member(v::uuid, 'uid-cashier', 'cashier@example.com', 'Carl Cashier', 'cashier') from test_helpers.vars where k='store1';
select public.create_store_member(v::uuid, 'uid-cashier2', 'cashier2@example.com', 'Cora Cashier', 'cashier') from test_helpers.vars where k='store1';
select test_helpers.expect_error($$select public.create_store_member(v::uuid, 'uid-cashier', 'cashier@example.com', 'Carl', 'cashier') from test_helpers.vars where k='store1'$$, 'CONFLICT');
commit;
begin;
select set_config('request.jwt.claims', '{"sub":"uid-cashier"}', true);
set local role authenticated;
select test_helpers.assert((select count(*) = 2 from products), 'cashier can view products');
select test_helpers.expect_error($$select public.create_store_member(v::uuid, 'uid-evil', 'evil@example.com', 'Evil', 'administrator') from test_helpers.vars where k='store1'$$, 'FORBIDDEN');
select test_helpers.expect_error($$select public.update_store_member(v::uuid, (select id from profiles where firebase_uid='uid-cashier'), null, 'administrator', null) from test_helpers.vars where k='store1'$$, 'FORBIDDEN');
select test_helpers.expect_error($$select public.adjust_stock(s.v::uuid, p.id, 'stock_in', 5, null) from test_helpers.vars s, products p where s.k='store1' and p.sku='BREAD'$$, 'FORBIDDEN');
-- RLS silently filters writes the cashier is not allowed to do
update products set selling_price = 0.01;
select test_helpers.assert((select selling_price = 20 from products where sku='COLA-330'), 'cashier cannot change prices');
update stores set store_name = 'Hacked';
select test_helpers.assert((select store_name = 'Sari-Sari Store' from stores), 'cashier cannot change settings');
select test_helpers.assert((select count(*) = 0 from stock_movements), 'cashier cannot view movements');
select test_helpers.assert((select count(*) = 0 from audit_logs), 'cashier cannot view audit logs');
rollback;

\echo '7. process_sale: totals, change, stock deduction, idempotency'
begin;
select set_config('request.jwt.claims', '{"sub":"uid-cashier"}', true);
set local role authenticated;
-- 3 x Cola (20.00) + 2 x Bread (45.50) = 151.00, cash 200 -> change 49.00
insert into test_helpers.vars select 'sale1', public.process_sale(
  s.v::uuid, '11111111-1111-1111-1111-111111111111',
  jsonb_build_array(
    jsonb_build_object('product_id', (select id from products where sku='COLA-330'), 'quantity', 2),
    jsonb_build_object('product_id', (select id from products where sku='BREAD'), 'quantity', 2),
    jsonb_build_object('product_id', (select id from products where sku='COLA-330'), 'quantity', 1)),
  'none', 0, 'cash', 200, null) ->> 'sale_id'
from test_helpers.vars s where s.k='store1';
select test_helpers.assert((select subtotal = 151.00 and total_amount = 151.00 and change_amount = 49.00
  and amount_received = 200 and status = 'completed' and transaction_number like 'TXN-%-000001'
  from sales where id = (select v::uuid from test_helpers.vars where k='sale1')), 'sale totals');
select test_helpers.assert((select count(*) = 2 from sale_items where sale_id = (select v::uuid from test_helpers.vars where k='sale1')), 'two aggregated sale lines');
select test_helpers.assert((select quantity = 3 and subtotal = 60 and cost_price = 12.50 from sale_items where sku='COLA-330'), 'cola line with cost snapshot');
select test_helpers.assert((select count(*) = 1 from payments where sale_id = (select v::uuid from test_helpers.vars where k='sale1')), 'payment row');
-- retry with same client request id returns the same sale, no double deduction
select test_helpers.assert((public.process_sale(s.v::uuid, '11111111-1111-1111-1111-111111111111',
  jsonb_build_array(jsonb_build_object('product_id', (select id from products where sku='COLA-330'), 'quantity', 2)),
  'none', 0, 'cash', 200, null) ->> 'duplicate')::boolean, 'duplicate detected') from test_helpers.vars s where s.k='store1';
select test_helpers.assert((select count(*) = 1 from sales), 'cashier sees exactly one sale');
commit;
select test_helpers.assert((select stock_quantity = 37 from products where sku='COLA-330'), 'cola stock deducted to 37');
select test_helpers.assert((select stock_quantity = 8 from products where sku='BREAD'), 'bread stock deducted to 8');
select test_helpers.assert((select count(*) = 2 from stock_movements where movement_type = 'sale'), 'sale movements');

\echo '8. sale validation: overselling, payments, unauthorized discounts'
begin;
select set_config('request.jwt.claims', '{"sub":"uid-cashier"}', true);
set local role authenticated;
select test_helpers.expect_error(format($$select public.process_sale(%L, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', %L, 'quantity', 9)), 'none', 0, 'cash', 1000, null)$$,
  (select v from test_helpers.vars where k='store1'), (select id from products where sku='BREAD')), 'INSUFFICIENT_STOCK');
select test_helpers.expect_error(format($$select public.process_sale(%L, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', %L, 'quantity', 1)), 'none', 0, 'cash', 10, null)$$,
  (select v from test_helpers.vars where k='store1'), (select id from products where sku='COLA-330')), 'PAYMENT_INVALID');
select test_helpers.expect_error(format($$select public.process_sale(%L, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', %L, 'quantity', 1)), 'none', 0, 'gcash', null, null)$$,
  (select v from test_helpers.vars where k='store1'), (select id from products where sku='COLA-330')), 'PAYMENT_INVALID');
select test_helpers.expect_error(format($$select public.process_sale(%L, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', %L, 'quantity', 1)), 'percent', 10, 'cash', 100, null)$$,
  (select v from test_helpers.vars where k='store1'), (select id from products where sku='COLA-330')), 'DISCOUNT_NOT_AUTHORIZED');
select test_helpers.expect_error(format($$select public.process_sale(%L, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', %L, 'quantity', 1.5)), 'none', 0, 'cash', 100, null)$$,
  (select v from test_helpers.vars where k='store1'), (select id from products where sku='COLA-330')), 'VALIDATION');
select test_helpers.expect_error(format($$select public.process_sale(%L, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', %L, 'quantity', -1)), 'none', 0, 'cash', 100, null)$$,
  (select v from test_helpers.vars where k='store1'), (select id from products where sku='COLA-330')), 'VALIDATION');
select test_helpers.expect_error(format($$select public.process_sale(%L, gen_random_uuid(), '[]', 'none', 0, 'cash', 100, null)$$,
  (select v from test_helpers.vars where k='store1')), 'VALIDATION');
rollback;
-- e-wallet with reference, admin discount (10%%) and tax exclusive 12%%
update stores set tax_enabled = true, tax_inclusive = false, tax_rate = 12;
begin;
select set_config('request.jwt.claims', '{"sub":"uid-admin"}', true);
set local role authenticated;
-- 5 x Cola = 100.00, 10% => 90.00, tax 12% => 10.80, total 100.80
insert into test_helpers.vars select 'sale2', public.process_sale(s.v::uuid, gen_random_uuid(),
  jsonb_build_array(jsonb_build_object('product_id', (select id from products where sku='COLA-330'), 'quantity', 5)),
  'percent', 10, 'gcash', null, 'GC-123456') ->> 'sale_id' from test_helpers.vars s where s.k='store1';
select test_helpers.assert((select discount = 10.00 and tax_amount = 10.80 and total_amount = 100.80 and change_amount = 0
  and amount_received = 100.80 from sales where id = (select v::uuid from test_helpers.vars where k='sale2')), 'discount + exclusive tax');
select test_helpers.assert((select reference_number = 'GC-123456' from payments where sale_id = (select v::uuid from test_helpers.vars where k='sale2')), 'reference saved');
select test_helpers.assert((select count(*) = 2 from sales), 'admin sees all sales');
commit;
update stores set tax_enabled = true, tax_inclusive = true, tax_rate = 12, allow_cashier_discount = true, max_discount_percent = 5;
begin;
select set_config('request.jwt.claims', '{"sub":"uid-cashier2"}', true);
set local role authenticated;
select test_helpers.expect_error(format($$select public.process_sale(%L, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', %L, 'quantity', 1)), 'percent', 6, 'cash', 100, null)$$,
  (select v from test_helpers.vars where k='store1'), (select id from products where sku='COLA-330')), 'DISCOUNT_NOT_AUTHORIZED');
-- 2 x Bread = 91.00, 1.00 off (allowed, < 5%) => 90.00, inclusive VAT = 9.64
insert into test_helpers.vars select 'sale3', public.process_sale(s.v::uuid, gen_random_uuid(),
  jsonb_build_array(jsonb_build_object('product_id', (select id from products where sku='BREAD'), 'quantity', 2)),
  'amount', 1, 'cash', 100, null) ->> 'sale_id' from test_helpers.vars s where s.k='store1';
select test_helpers.assert((select total_amount = 90.00 and tax_amount = 9.64 and change_amount = 10.00
  from sales where id = (select v::uuid from test_helpers.vars where k='sale3')), 'inclusive tax + cashier discount within limit');
select test_helpers.assert((select count(*) = 1 from sales), 'cashier2 sees only own sale');
select test_helpers.assert((select count(*) = 1 from sale_items), 'cashier2 sees only own sale items');
commit;
update stores set tax_enabled = false, allow_cashier_discount = false;

\echo '9. sales are immutable; refunds restock and are single-use'
select test_helpers.expect_error($$update sales set total_amount = 1$$, 'IMMUTABLE_RECORD');
select test_helpers.expect_error($$delete from sales$$, 'IMMUTABLE_RECORD');
select test_helpers.expect_error($$delete from stock_movements$$, 'IMMUTABLE_RECORD');
select test_helpers.expect_error($$update audit_logs set action = 'x'$$, 'IMMUTABLE_RECORD');
begin;
select set_config('request.jwt.claims', '{"sub":"uid-cashier"}', true);
set local role authenticated;
select test_helpers.expect_error(format($$select public.refund_sale(%L, %L, 'customer changed mind')$$,
  (select v from test_helpers.vars where k='store1'), (select v from test_helpers.vars where k='sale1')), 'FORBIDDEN');
rollback;
begin;
select set_config('request.jwt.claims', '{"sub":"uid-admin"}', true);
set local role authenticated;
select public.refund_sale(s.v::uuid, x.v::uuid, 'Customer returned items') from test_helpers.vars s, test_helpers.vars x where s.k='store1' and x.k='sale1';
select test_helpers.expect_error(format($$select public.refund_sale(%L, %L, 'again')$$,
  (select v from test_helpers.vars where k='store1'), (select v from test_helpers.vars where k='sale1')), 'ALREADY_REFUNDED');
commit;
select test_helpers.assert((select stock_quantity = 35 from products where sku='COLA-330'), 'cola restocked (37-5+3)');
select test_helpers.assert((select status = 'refunded' from sales where id = (select v::uuid from test_helpers.vars where k='sale1')), 'refunded status');
select test_helpers.assert((select count(*) = 2 from stock_movements where movement_type = 'return'), 'return movements');
select test_helpers.assert((select amount = -151 from payments where kind = 'refund'), 'negative refund payment');

\echo '10. reports separate revenue and profit'
begin;
select set_config('request.jwt.claims', '{"sub":"uid-admin"}', true);
set local role authenticated;
insert into expenses (store_id, description, category, amount, recorded_by)
select v::uuid, 'Electricity', 'utilities', 50, (select id from profiles where firebase_uid='uid-admin') from test_helpers.vars where k='store1';
select test_helpers.expect_error($$insert into expenses (store_id, description, category, amount, recorded_by)
  select v::uuid, 'Fake', 'other', 50, (select id from profiles where firebase_uid='uid-cashier') from test_helpers.vars where k='store1'$$, 'new row violates');
insert into test_helpers.vars select 'report', public.sales_report(v::uuid, current_date - 1, current_date + 1, 'month')::text from test_helpers.vars where k='store1';
commit;
-- completed: sale2 (100.80, tax 10.80, cogs 62.50), sale3 (90.00, tax 9.64, cogs 60.00); refunded: sale1 151.00
select test_helpers.assert((select (v::jsonb -> 'totals' ->> 'net_sales')::numeric = 190.80 from test_helpers.vars where k='report'), 'net sales');
select test_helpers.assert((select (v::jsonb -> 'totals' ->> 'refunds')::numeric = 151.00 from test_helpers.vars where k='report'), 'refunds');
select test_helpers.assert((select (v::jsonb -> 'totals' ->> 'gross_sales')::numeric = 342.00 from test_helpers.vars where k='report'), 'gross sales');
select test_helpers.assert((select (v::jsonb -> 'totals' ->> 'discounts')::numeric = 11.00 from test_helpers.vars where k='report'), 'discounts');
select test_helpers.assert((select (v::jsonb -> 'totals' ->> 'cost_of_goods')::numeric = 122.50 from test_helpers.vars where k='report'), 'cogs');
select test_helpers.assert((select (v::jsonb -> 'totals' ->> 'gross_profit')::numeric = 190.80 - 20.44 - 122.50 from test_helpers.vars where k='report'), 'gross profit');
select test_helpers.assert((select (v::jsonb -> 'totals' ->> 'net_profit')::numeric = 190.80 - 20.44 - 122.50 - 50 from test_helpers.vars where k='report'), 'net profit');
begin;
select set_config('request.jwt.claims', '{"sub":"uid-cashier"}', true);
set local role authenticated;
select test_helpers.expect_error(format($$select public.sales_report(%L, current_date, current_date, 'day')$$, (select v from test_helpers.vars where k='store1')), 'FORBIDDEN');
-- cashier dashboard only counts own (refunded) sale
select test_helpers.assert((public.dashboard_summary(v::uuid, current_date - 1, current_date + 1) ->> 'transactions')::int = 0, 'cashier dashboard scoped to own sales') from test_helpers.vars where k='store1';
rollback;

\echo '11. role protections: self-modification and last administrator'
begin;
select set_config('request.jwt.claims', '{"sub":"uid-admin"}', true);
set local role authenticated;
select test_helpers.expect_error(format($$select public.update_store_member(%L, %L, null, 'cashier', null)$$,
  (select v from test_helpers.vars where k='store1'), (select id from profiles where firebase_uid='uid-admin')), 'SELF_MODIFICATION');
select test_helpers.expect_error(format($$select public.update_store_member(%L, %L, null, null, false)$$,
  (select v from test_helpers.vars where k='store1'), (select id from profiles where firebase_uid='uid-admin')), 'SELF_MODIFICATION');
-- deactivate cashier2 => their profile becomes inactive and they lose all access
select public.update_store_member(s.v::uuid, p.id, null, null, false) from test_helpers.vars s, profiles p where s.k='store1' and p.firebase_uid='uid-cashier2';
commit;
begin;
select set_config('request.jwt.claims', '{"sub":"uid-cashier2"}', true);
set local role authenticated;
select test_helpers.assert((select count(*) = 0 from products), 'inactive user sees nothing');
select test_helpers.expect_error(format($$select public.process_sale(%L, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', %L, 'quantity', 1)), 'none', 0, 'cash', 100, null)$$,
  (select v from test_helpers.vars where k='store1'), (select id from products where sku='COLA-330')), 'NOT_AUTHENTICATED');
rollback;
-- promote cashier to admin, then the original admin may be demoted by them
begin;
select set_config('request.jwt.claims', '{"sub":"uid-admin"}', true);
set local role authenticated;
select public.update_store_member(s.v::uuid, p.id, null, 'administrator', null) from test_helpers.vars s, profiles p where s.k='store1' and p.firebase_uid='uid-cashier';
commit;
begin;
select set_config('request.jwt.claims', '{"sub":"uid-cashier"}', true);
set local role authenticated;
select public.update_store_member(s.v::uuid, p.id, null, 'cashier', null) from test_helpers.vars s, profiles p where s.k='store1' and p.firebase_uid='uid-admin';
rollback;

\echo '12. cross-store isolation'
insert into profiles (firebase_uid, email, full_name) values ('uid-other', 'other@example.com', 'Other Owner');
insert into stores (store_name) values ('Other Store');
insert into store_members (store_id, profile_id, role_id)
select s.id, p.id, r.id from stores s, profiles p, roles r
where s.store_name = 'Other Store' and p.firebase_uid = 'uid-other' and r.key = 'administrator';
insert into test_helpers.vars select 'cat1', c.id::text from categories c join test_helpers.vars v on v.k = 'store1' and c.store_id = v.v::uuid limit 1;
begin;
select set_config('request.jwt.claims', '{"sub":"uid-other"}', true);
set local role authenticated;
select test_helpers.assert((select count(*) = 1 from stores), 'other admin sees only own store');
select test_helpers.assert((select count(*) = 0 from products), 'no foreign products');
select test_helpers.assert((select count(*) = 0 from sales), 'no foreign sales');
select test_helpers.assert((select count(*) = 0 from expenses), 'no foreign expenses');
select test_helpers.assert((select count(*) = 0 from audit_logs where store_id <> (select id from stores)), 'no foreign audit logs');
select test_helpers.assert((select count(*) = 1 from profiles), 'no foreign profiles');
select test_helpers.expect_error(format($$select public.adjust_stock(%L, %L, 'stock_in', 5, null)$$,
  (select v from test_helpers.vars where k='store1'), (select v from test_helpers.vars where k='sale1')), 'FORBIDDEN');
select test_helpers.expect_error(format($$insert into products (store_id, name, selling_price) values (%L, 'x', 1)$$,
  (select v from test_helpers.vars where k='store1')), 'new row violates');
-- cannot attach a foreign category to own product
select test_helpers.expect_error(format($$insert into products (store_id, category_id, name, selling_price) select id, %L, 'x', 1 from stores$$,
  (select v from test_helpers.vars where k='cat1')), 'new row violates');
select test_helpers.assert((select count(*) = 0 from categories), 'no foreign categories');
rollback;

\echo '13. audit trail'
select test_helpers.assert((select count(*) > 0 from audit_logs where module = 'products' and action = 'insert'), 'product audit');
select test_helpers.assert((select count(*) > 0 from audit_logs where module = 'sales' and action = 'refund'), 'refund audit');
select test_helpers.assert((select bool_and(user_id is not null) from audit_logs where module in ('products','sales','store_members') and store_id = (select v::uuid from test_helpers.vars where k='store1')), 'audit actor captured');

\echo 'ALL DATABASE TESTS PASSED'
