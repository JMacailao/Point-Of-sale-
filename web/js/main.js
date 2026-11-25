import { session, loadStatus, loadContext, can } from './session.js'
import { auth, onAuthStateChanged, signOut } from './firebase.js'
import { rpc, setSessionErrorHandler } from './api.js'
import { renderShell, homePath, NAV } from './layout.js'
import { renderAdminStep, renderStoreStep, renderWelcome, renderLogin, renderForgot, renderFatal } from './pages/auth.js'
import { spinnerBlock, toast } from './util.js'

const app = document.getElementById('app')
const PAGES = {
  dashboard: () => import('./pages/dashboard.js'),
  cashier: () => import('./pages/cashier.js'),
  products: () => import('./pages/products.js'),
  menu: () => import('./pages/menu.js'),
  inventory: () => import('./pages/inventory.js'),
  users: () => import('./pages/users.js'),
  sales: () => import('./pages/sales.js'),
  expenses: () => import('./pages/expenses.js'),
  reports: () => import('./pages/reports.js'),
  settings: () => import('./pages/settings.js'),
}
let cleanup = null
let authReady = false

export function navigate(path) {
  if (location.hash === `#/${path}`) route()
  else location.hash = `#/${path}`
}

export async function logout() {
  await rpc('record_auth_event', { p_action: 'logout', p_store_id: session.ctx?.store?.id ?? null }).catch(() => {})
  session.ctx = null
  await signOut(auth)
  navigate('login')
}

function parseHash() {
  const [path, qs] = location.hash.replace(/^#\/?/, '').split('?')
  return { path: path || '', params: new URLSearchParams(qs || '') }
}

async function route() {
  if (!session.status || !authReady) return
  cleanup?.()
  cleanup = null
  document.getElementById('modal-root').innerHTML = ''
  document.body.style.overflow = ''
  const { path, params } = parseHash()
  const ctx = session.ctx
  const go = (p) => { location.replace(`#/${p}`) }

  // ----- first run / auth screens
  if (!session.status.adminClaimed) {
    if (path !== 'setup') return go('setup')
    return renderAdminStep(app, navigate)
  }
  if (ctx?.setup?.pendingStoreSetup) {
    if (path !== 'setup') return go('setup')
    return renderStoreStep(app, navigate, logout)
  }
  if (path === 'welcome' && ctx?.store) return renderWelcome(app, navigate)
  if (!ctx) {
    if (path === 'forgot-password') return renderForgot(app)
    if (path !== 'login') return go('login')
    return renderLogin(app)
  }
  if (['', 'setup', 'login', 'forgot-password', 'welcome'].includes(path)) return go(homePath())

  // ----- application pages
  const nav = NAV.find((n) => n.path === path)
  if (!nav || !PAGES[path]) return go(homePath())
  if (nav.perms && !can(...nav.perms)) return go(homePath())
  const main = renderShell(app, path)
  app.querySelectorAll('[data-logout]').forEach((b) => { b.onclick = logout })
  main.innerHTML = spinnerBlock()
  try {
    const mod = await PAGES[path]()
    if (parseHash().path !== path) return
    cleanup = (await mod.render(main, params)) || null
  } catch (err) {
    main.innerHTML = `<div class="empty"><p class="text-red">${err.message}</p></div>`
  }
}

setSessionErrorHandler(async (err) => {
  if (!session.ctx) return
  session.authMessage = err.message
  session.ctx = null
  await signOut(auth)
  navigate('login')
})

async function boot() {
  try {
    await loadStatus()
  } catch (err) {
    return renderFatal(app, 'Cannot reach the database', `${err.message} Check that supabase/setup.sql has been run.`, boot)
  }
  onAuthStateChanged(auth, async (user) => {
    session.firebaseUser = user
    if (session.busyAuth) return // registration flow handles its own state
    if (!user) {
      session.ctx = null
    } else {
      app.innerHTML = '<div class="splash"><span class="spinner"></span></div>'
      try {
        await loadContext()
        if (session.freshLogin) rpc('record_auth_event', { p_action: 'login', p_store_id: session.ctx?.store?.id ?? null }).catch(() => {})
      } catch (err) {
        // Supabase rejected the identity (not registered, deactivated, ...): sign out.
        session.authMessage = err.code === 'SESSION'
          ? 'Supabase did not accept the Firebase sign-in. Enable Firebase under Supabase > Authentication > Third-Party Auth.'
          : err.message
        session.ctx = null
        await signOut(auth)
      }
      session.freshLogin = false
    }
    authReady = true
    route()
  })
}

window.addEventListener('hashchange', route)
window.addEventListener('unhandledrejection', (e) => { if (e.reason?.message) toast.error(e.reason.message) })
boot()
