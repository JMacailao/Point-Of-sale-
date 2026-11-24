import { rpc } from './api.js'

// Shared state for the signed-in user (verified by Supabase from the Firebase token).
export const session = {
  status: null,        // public setup status { adminClaimed, setupCompleted, store }
  firebaseUser: undefined,
  ctx: null,           // { user, store, role, permissions, memberships, setup }
  authMessage: null,
  busyAuth: false,     // true while registering/claiming (suppresses auto context load)
}

export const can = (...perms) => perms.some((p) => session.ctx?.permissions?.includes(p))
export const store = () => session.ctx?.store
export const storeId = () => session.ctx?.store?.id

export async function loadStatus() {
  session.status = await rpc('get_setup_status')
  return session.status
}

export async function loadContext() {
  let saved = null
  try { saved = localStorage.getItem('pos.storeId') } catch { /* ignore */ }
  try {
    session.ctx = await rpc('get_my_context', { p_store_id: saved })
  } catch (err) {
    if (saved && err.code === 'STORE_ACCESS_DENIED') session.ctx = await rpc('get_my_context', {})
    else throw err
  }
  try { if (session.ctx?.store?.id) localStorage.setItem('pos.storeId', session.ctx.store.id) } catch { /* ignore */ }
  return session.ctx
}
