import { session, can, store } from './session.js'
import { esc, icon } from './util.js'

export const NAV = [
  { path: 'dashboard', label: 'Dashboard', icon: 'dashboard', perms: ['dashboard.view'] },
  { path: 'cashier', label: 'Cashier', icon: 'cart', perms: ['pos.use'] },
  { path: 'products', label: 'Products', icon: 'package', perms: ['products.view'] },
  { path: 'inventory', label: 'Stock / Inventory', icon: 'boxes', perms: ['inventory.view'] },
  { path: 'users', label: 'Users', icon: 'users', perms: ['users.manage'] },
  { path: 'sales', label: 'Revenue & Sales', icon: 'receipt', perms: ['sales.view_all', 'sales.view_own'] },
  { path: 'expenses', label: 'Expenses', icon: 'wallet', perms: ['expenses.view'] },
  { path: 'reports', label: 'Reports', icon: 'chart', perms: ['reports.view'] },
  { path: 'settings', label: 'Settings', icon: 'settings', perms: null },
]
const BOTTOM = ['dashboard', 'cashier', 'products', 'sales']

export const allowedNav = () => NAV.filter((n) => !n.perms || can(...n.perms))
export const homePath = () => allowedNav()[0]?.path || 'settings'

function brand(s) {
  return s?.logo_url ? `<img src="${esc(s.logo_url)}" alt="" class="brand-logo">` : `<div class="brand-mark">${icon('bag')}</div>`
}

/** Renders the app shell and returns the <main> element for the page. */
export function renderShell(app, active) {
  const s = store()
  const u = session.ctx.user
  const items = allowedNav()
  const current = items.find((i) => i.path === active)
  const initials = (u.fullName || u.email).trim().charAt(0).toUpperCase()
  const navHtml = items.map((i) => `<a href="#/${i.path}" class="nav-link ${i.path === active ? 'active' : ''}">${icon(i.icon)} ${esc(i.label)}</a>`).join('')
  app.innerHTML = `
  <div class="shell">
    <aside class="sidebar" id="sidebar" aria-label="Main navigation">
      <div class="side-brand">${brand(s)}<span class="truncate">${esc(s.store_name)}</span></div>
      <nav class="side-nav">${navHtml}</nav>
      <div class="side-user">
        <div class="who"><div class="avatar">${esc(initials)}</div><div class="grow"><p class="truncate bold small">${esc(u.fullName || u.email)}</p><p class="truncate small muted">${esc(session.ctx.role?.name || '')}</p></div></div>
        <div class="acts"><a href="#/settings?tab=profile">${icon('user')} Profile</a><button class="out" data-logout>${icon('logout')} Logout</button></div>
      </div>
    </aside>
    <div class="drawer-backdrop" id="drawer-backdrop" hidden></div>
    <header class="topbar">
      <button class="icon-btn menu-btn" data-menu aria-label="Open menu">${icon('menu', 'icon-lg')}</button>
      <h1 class="truncate">${esc(current?.label || 'Point of Sale')}</h1>
      <span class="ml-auto hello"><span class="avatar">${esc(initials)}</span><span class="hide-sm">Hello, ${esc((u.fullName || u.email).split(/[ @]/)[0])}</span></span>
    </header>
    <main class="main ${active === 'cashier' ? 'full' : ''}" id="page"></main>
    <nav class="bottom-nav" aria-label="Quick navigation">
      ${items.filter((i) => BOTTOM.includes(i.path)).map((i) => `<a href="#/${i.path}" class="${i.path === active ? 'active' : ''}">${icon(i.icon)}${esc(i.label.replace('Revenue & ', ''))}</a>`).join('')}
      <button data-menu>${icon('more')}More</button>
    </nav>
  </div>`
  const sidebar = app.querySelector('#sidebar')
  const backdrop = app.querySelector('#drawer-backdrop')
  const setDrawer = (open) => { sidebar.classList.toggle('open', open); backdrop.hidden = !open }
  app.querySelectorAll('[data-menu]').forEach((b) => { b.onclick = () => setDrawer(true) })
  backdrop.onclick = () => setDrawer(false)
  sidebar.addEventListener('click', (e) => { if (e.target.closest('a')) setDrawer(false) })
  return app.querySelector('#page')
}

export function pageHead(title, description = '', actions = '') {
  return `<div class="page-head"><div><h1>${esc(title)}</h1>${description ? `<p>${esc(description)}</p>` : ''}</div>${actions ? `<div class="row-wrap">${actions}</div>` : ''}</div>`
}
