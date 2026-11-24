-- =============================================================================
-- AUTHORIZED SYSTEM RESET of the initial administrator claim.
--
-- Use ONLY when the initial administrator was registered but store setup was
-- never completed (e.g. the owner lost access to that account). Run it as the
-- database owner in the Supabase SQL editor. It refuses to run once a store
-- exists, so it can never wipe business data.
--
-- Afterwards, delete the orphaned user in Firebase console > Authentication.
-- =============================================================================
do $$
declare
  v_admin uuid;
begin
  if exists (select 1 from public.stores) or (select setup_completed from public.system_settings where singleton) then
    raise exception 'Refusing to reset: store setup has already been completed.';
  end if;
  select initial_admin_profile_id into v_admin from public.system_settings where singleton for update;
  update public.system_settings
     set admin_claimed_at = null, initial_admin_profile_id = null
   where singleton;
  if v_admin is not null then
    -- Keep the profile for the audit trail, but deactivate it and free its
    -- email / Firebase UID so the owner can register again.
    update public.profiles
       set is_active = false,
           email = 'reset-' || id || '@invalid.local',
           firebase_uid = 'reset:' || firebase_uid
     where id = v_admin;
    perform app.write_audit(null, null, 'reset_initial_setup', 'setup', v_admin, null, null);
    raise notice 'Initial setup reset. Profile % deactivated and kept for audit purposes.', v_admin;
  end if;
end;
$$;
