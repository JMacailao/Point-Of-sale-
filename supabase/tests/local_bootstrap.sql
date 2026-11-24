-- Recreates the Supabase roles locally so migrations and RLS can be tested
-- against a plain PostgreSQL server. NOT needed (and must not be run) on Supabase.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'pos_owner') then
    create role pos_owner login password 'pos_owner_local' createdb;
  end if;
end $$;
grant anon, authenticated, service_role to pos_owner;
