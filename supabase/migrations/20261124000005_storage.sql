-- =============================================================================
-- SUPABASE STORAGE BUCKETS
-- Logos and product images are served publicly (the login page shows the
-- store logo before sign-in). Writes are performed only by the backend with
-- the service role key after permission checks; no storage policies grant
-- write access to anon/authenticated users.
-- =============================================================================
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values
      ('store-assets',   'store-assets',   true, 2097152, array['image/png','image/jpeg','image/webp']),
      ('product-images', 'product-images', true, 2097152, array['image/png','image/jpeg','image/webp'])
    on conflict (id) do nothing;
  end if;
end;
$$;
