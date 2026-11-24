import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

let client;

export function storageConfigured() {
  return Boolean(env.supabase.url && env.supabase.serviceRoleKey);
}

export function supabaseAdmin() {
  if (!client) {
    client = createClient(env.supabase.url, env.supabase.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
