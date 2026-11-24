import { rpc, uploadImage } from '../api.js'
import { session, can, store } from '../session.js'
import { pageHead } from '../layout.js'
import { changePassword, firebaseMessage } from '../firebase.js'
import { printReceipt } from '../receipt.js'
import { scannerEnabled } from './cashier.js'
import { summary } from './users.js'
import {
  esc, icon, toast, setBusy, showErrors, field, options, pager, spinnerBlock, emptyBlock, errorBlock, fmtDateTime,
  BUSINESS_TYPES, TIMEZONES, EMAIL_RE, passwordProblems, passwordInput, imagePicker, bindImagePicker,
} from '../util.js'

export async function render(main, params) {
  const admin = can('settings.manage')
  const tabs = [
    ...(admin ? [['store', 'Store Information'], ['business', 'Business'], ['inventory', 'Inventory']] : []),
    ['devices', 'Printer & Scanner'],
    ...(can('users.manage') ? [['roles', 'Users & Roles']] : []),
    ['profile', 'My Profile'],
    ...(can('audit.view') ? [['audit', 'Audit Log']] : []),
  ]
  let tab = tabs.some(([k]) => k === params.get('tab')) ? params.get('tab') : tabs[0][0]

  function draw() {
    main.innerHTML = `${pageHead('Settings')}<div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button class="tab" role="tab" data-tab="${k}" aria-selected="${k === tab}">${esc(l)}</button>`).join('')}</div><div id="tab"></div>`
    main.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { tab = b.dataset.tab; history.replaceState(null, '', `#/settings?tab=${tab}`); draw() } })
    const root = main.querySelector('#tab')
    ;({ store: storeTab, business: businessTab, inventory: inventoryTab, devices: devicesTab, roles: rolesTab, profile: profileTab, audit: auditTab })[tab](root)
  }

  async function save(data, btn) {
    setBusy(btn, true, 'Saving…')
    try {
      const updated = await rpc('update_store_settings', { p_store_id: store().id, p_data: data })
      session.ctx.store = updated
      toast.success('Settings saved')
      return true
    } catch (err) { toast.error(err); return false } finally { setBusy(btn, false) }
  }
  const panel = (title, body) => `<section class="panel mb" style="max-width:760px"><div class="panel-head"><h2>${esc(title)}</h2></div><div class="panel-body">${body}</div></section>`

  function storeTab(root) {
    const s = store()
    root.innerHTML = panel('Store Information', `<form id="f" class="grid-2" novalidate>
      ${field('Store Name', `<input id="store_name" class="input" maxlength="120" value="${esc(s.store_name)}">`, { id: 'store_name', required: true, cls: 'span-2' })}
      ${field('Store Address', `<input id="store_address" class="input" maxlength="300" value="${esc(s.store_address)}">`, { id: 'store_address', cls: 'span-2' })}
      ${field('Contact Number', `<input id="contact_number" class="input" maxlength="40" value="${esc(s.contact_number)}">`, { id: 'contact_number' })}
      ${field('Business Email', `<input id="business_email" type="email" class="input" value="${esc(s.business_email)}">`, { id: 'business_email' })}
      ${field('Business Type', `<select id="business_type" class="input"><option value="">Select…</option>${options(BUSINESS_TYPES, s.business_type)}</select>`, { id: 'business_type' })}
      <div class="span-2">${imagePicker('logo', 'Store Logo', 'Shown on the sign-in page and receipts. PNG, JPEG or WebP up to 2 MB.')}</div>
      <div class="span-2"><button class="btn btn-primary" type="submit">Save Settings</button></div></form>`)
    const logo = bindImagePicker(root, 'logo', s.logo_url)
    root.querySelector('#f').onsubmit = async (e) => {
      e.preventDefault()
      const v = (id) => root.querySelector(`#${id}`).value.trim()
      const errs = {}
      if (!v('store_name')) errs.store_name = 'Store name is required.'
      if (v('business_email') && !EMAIL_RE.test(v('business_email'))) errs.business_email = 'Enter a valid email address.'
      if (!showErrors(root, errs)) return
      const btn = root.querySelector('[type=submit]')
      const data = { store_name: v('store_name'), store_address: v('store_address'), contact_number: v('contact_number'), business_email: v('business_email'), business_type: v('business_type') }
      try {
        if (logo.file) { setBusy(btn, true, 'Uploading…'); data.logo_url = await uploadImage('store-assets', s.id, logo.file) } else if (logo.removed) data.logo_url = ''
      } catch (err) { setBusy(btn, false); return toast.error(err) }
      if (await save(data, btn)) draw()
    }
  }

  function businessTab(root) {
    const s = store()
    root.innerHTML = `<form id="f" novalidate>
      ${panel('Regional & Receipt', `<div class="grid-2">
        ${field('Currency', '<select class="input" disabled><option>Philippine Peso (₱)</option></select>')}
        ${field('Time Zone', `<select id="timezone" class="input">${options(TIMEZONES.map((t) => [t, t]), s.timezone)}</select>`, { id: 'timezone' })}
        ${field('Date Format', `<select id="date_format" class="input">${options([['DD/MM/YYYY', 'DD/MM/YYYY'], ['MM/DD/YYYY', 'MM/DD/YYYY'], ['YYYY-MM-DD', 'YYYY-MM-DD']], s.date_format)}</select>`, { id: 'date_format' })}
        ${field('Receipt Footer', `<textarea id="receipt_footer" class="input" maxlength="300">${esc(s.receipt_footer)}</textarea>`, { id: 'receipt_footer', cls: 'span-2' })}</div>`)}
      ${panel('Tax Settings', `<label class="check mb"><input type="checkbox" id="tax_enabled" ${s.tax_enabled ? 'checked' : ''}> Apply tax to sales</label><div class="grid-3">
        ${field('Tax name', `<input id="tax_name" class="input" maxlength="20" value="${esc(s.tax_name)}">`, { id: 'tax_name' })}
        ${field('Tax rate (%)', `<input id="tax_rate" class="input" type="number" min="0" max="100" step="0.01" value="${esc(s.tax_rate)}">`, { id: 'tax_rate' })}
        ${field('Prices are', `<select id="tax_inclusive" class="input">${options([['true', 'Tax inclusive'], ['false', 'Tax exclusive (added at checkout)']], String(s.tax_inclusive))}</select>`, { id: 'tax_inclusive' })}</div>`)}
      ${panel('Default Discount Settings', `<label class="check mb"><input type="checkbox" id="allow_cashier_discount" ${s.allow_cashier_discount ? 'checked' : ''}> Allow cashiers to apply discounts <span class="small muted">(administrators always can)</span></label>
        ${field('Maximum cashier discount (%)', `<input id="max_discount_percent" class="input" type="number" min="0" max="100" step="0.01" value="${esc(s.max_discount_percent)}" style="max-width:200px">`, { id: 'max_discount_percent' })}`)}
      <button class="btn btn-primary" type="submit">Save Settings</button></form>`
    root.querySelector('#f').onsubmit = async (e) => {
      e.preventDefault()
      const v = (id) => root.querySelector(`#${id}`)
      const rate = Number(v('tax_rate').value), maxd = Number(v('max_discount_percent').value)
      const errs = {}
      if (!(rate >= 0 && rate <= 100)) errs.tax_rate = 'Enter 0–100.'
      if (!(maxd >= 0 && maxd <= 100)) errs.max_discount_percent = 'Enter 0–100.'
      if (!v('tax_name').value.trim()) errs.tax_name = 'Required.'
      if (!showErrors(root, errs)) return
      await save({ timezone: v('timezone').value, date_format: v('date_format').value, receipt_footer: v('receipt_footer').value,
        tax_enabled: v('tax_enabled').checked, tax_name: v('tax_name').value.trim(), tax_rate: rate, tax_inclusive: v('tax_inclusive').value === 'true',
        allow_cashier_discount: v('allow_cashier_discount').checked, max_discount_percent: maxd }, root.querySelector('[type=submit]'))
    }
  }

  function inventoryTab(root) {
    const s = store()
    root.innerHTML = `<form id="f" novalidate>${panel('Inventory Settings', `
      ${field('Default low stock threshold', `<input id="thr" class="input" type="number" min="0" value="${esc(s.default_low_stock_threshold)}" style="max-width:200px">`, { id: 'thr', hint: 'Used as the minimum stock for new products.' })}
      <div class="setting-row">${icon('warning')}<div class="grow"><p class="bold">Stock warnings</p><p class="small muted">Show low-stock alerts on the dashboard.</p></div>
        <label class="switch"><input type="checkbox" id="alerts" ${s.low_stock_alerts ? 'checked' : ''} aria-label="Stock warnings"><span></span></label></div>
      <div class="setting-row">${icon('shield')}<div class="grow"><p class="bold">Negative stock prevention</p><p class="small muted">Always enforced: sales and stock-outs that exceed available stock are rejected by the database, and every change is recorded.</p></div></div>`)}
      <button class="btn btn-primary" type="submit">Save Settings</button></form>`
    root.querySelector('#f').onsubmit = async (e) => {
      e.preventDefault()
      const thr = root.querySelector('#thr').value
      if (!showErrors(root, /^\d+$/.test(thr) ? {} : { thr: 'Whole number required.' })) return
      await save({ default_low_stock_threshold: Number(thr), low_stock_alerts: root.querySelector('#alerts').checked }, root.querySelector('[type=submit]'))
    }
  }

  function devicesTab(root) {
    const s = store()
    root.innerHTML = `${panel('Printer Settings', `
      <div class="setting-row">${icon('printer')}<div class="grow"><p class="bold">Receipt printer</p>
        <p class="small muted">Receipts print through this device's print dialog. Install your USB/network thermal printer in the operating system (on Android, use a print service app that supports your printer), then choose it in the print dialog. Direct Bluetooth printing is not built in.</p></div></div>
      <div class="row-wrap">${field('Receipt paper size', `<select id="paper" class="input input-auto" ${admin ? '' : 'disabled'}>${options([['58mm', '58mm thermal'], ['80mm', '80mm thermal'], ['a4', 'A4 / Letter (standard printer)']], s.receipt_paper)}</select>`, { id: 'paper' })}
        ${admin ? '<button class="btn btn-secondary" id="save-paper" style="margin-top:6px">Save</button>' : ''}
        <button class="btn btn-primary" id="test" style="margin-top:6px">${icon('printer')} Test Print</button></div>`)}
      ${panel('Scanner Settings', `<div class="setting-row">${icon('scan')}<div class="grow"><p class="bold">Enable barcode scanner</p>
        <p class="small muted">USB/Bluetooth scanners that type like a keyboard add products instantly on the Cashier screen. Saved on this device.</p></div>
        <label class="switch"><input type="checkbox" id="scanner" ${scannerEnabled() ? 'checked' : ''} aria-label="Enable barcode scanner"><span></span></label></div>`)}`
    root.querySelector('#scanner').onchange = (e) => {
      try { localStorage.setItem('pos.scannerEnabled', String(e.target.checked)) } catch { /* ignore */ }
      toast.success(e.target.checked ? 'Scanner enabled on this device' : 'Scanner disabled on this device')
    }
    root.querySelector('#save-paper')?.addEventListener('click', (e) => save({ receipt_paper: root.querySelector('#paper').value }, e.currentTarget))
    root.querySelector('#test').onclick = () => printReceipt({
      transaction_number: 'TEST-PRINT', created_at: new Date().toISOString(), cashier_name: session.ctx.user.fullName || session.ctx.user.email,
      status: 'completed', items: [{ id: 1, product_name: 'Sample item', quantity: 2, unit_price: 25, subtotal: 50 }],
      subtotal: 50, discount: 0, tax_amount: 0, total_amount: 50, payment_method: 'cash', amount_received: 100, change_amount: 50, payments: [],
    }, store(), root.querySelector('#paper').value)
  }

  async function rolesTab(root) {
    root.innerHTML = spinnerBlock()
    try {
      const d = await rpc('list_roles')
      root.innerHTML = `${panel('User Management', 'Create users, assign roles and activate or deactivate accounts in the <a href="#/users">Users module</a>.')}
        <section class="panel" style="max-width:760px"><div class="panel-head"><h2>Roles &amp; Permissions</h2></div><div class="table-wrap"><table class="table">
          <thead><tr><th>Permission</th>${d.roles.map((r) => `<th style="text-align:center">${esc(r.name)}</th>`).join('')}</tr></thead><tbody>
          ${d.permissions.map((p) => `<tr><td>${esc(p.description)}<span class="sub">${esc(p.permission_key)}</span></td>${d.roles.map((r) => `<td style="text-align:center">${r.permissions.includes(p.permission_key) ? `<span class="text-green" aria-label="Allowed">${icon('check')}</span>` : '<span class="faint" aria-label="Not allowed">—</span>'}</td>`).join('')}</tr>`).join('')}
          </tbody></table></div><p class="small muted" style="padding:8px 12px;border-top:1px solid var(--border)">Permissions are enforced by the database (row level security). Users cannot change their own role or status.</p></section>`
    } catch (err) { root.innerHTML = errorBlock(err) }
  }

  function profileTab(root) {
    const u = session.ctx.user
    root.innerHTML = `<div class="split split-even" style="max-width:860px">
      ${panel('My Profile', `<form id="pf" class="stack">${field('Email', `<input class="input" value="${esc(u.email)}" disabled>`)}${field('Role', `<input class="input" value="${esc(session.ctx.role?.name)}" disabled>`)}
        ${field('Full Name', `<input id="full_name" class="input" maxlength="120" value="${esc(u.fullName)}">`, { id: 'full_name' })}<button class="btn btn-primary" type="submit">Save Profile</button></form>`)}
      ${panel('Change Password', `<form id="cp" class="stack" novalidate>${field('Current password', passwordInput('current'), { id: 'current' })}
        ${field('New password', passwordInput('next', 'new-password'), { id: 'next' })}${field('Confirm new password', passwordInput('confirm', 'new-password'), { id: 'confirm' })}
        <button class="btn btn-primary" type="submit">Change Password</button></form>`)}</div>`
    root.querySelector('#pf').onsubmit = async (e) => {
      e.preventDefault()
      const name = root.querySelector('#full_name').value.trim()
      if (!showErrors(root, name ? {} : { full_name: 'Enter your name.' })) return
      const btn = e.target.querySelector('[type=submit]')
      setBusy(btn, true)
      try { await rpc('update_my_profile', { p_full_name: name }); session.ctx.user.fullName = name; toast.success('Profile updated') } catch (err) { toast.error(err) } finally { setBusy(btn, false) }
    }
    root.querySelector('#cp').onsubmit = async (e) => {
      e.preventDefault()
      const v = (id) => root.querySelector(`#${id}`).value
      const errs = {}
      if (!v('current')) errs.current = 'Enter your current password.'
      const probs = passwordProblems(v('next'))
      if (probs.length) errs.next = `Password needs ${probs.join(', ')}.`
      if (v('confirm') !== v('next')) errs.confirm = 'Passwords do not match.'
      if (!showErrors(root, errs)) return
      const btn = e.target.querySelector('[type=submit]')
      setBusy(btn, true)
      try {
        await changePassword(v('current'), v('next'))
        e.target.reset(); toast.success('Password changed')
      } catch (err) {
        if (['auth/invalid-credential', 'auth/wrong-password', 'auth/invalid-login-credentials'].includes(err?.code)) showErrors(root, { current: 'Current password is incorrect.' })
        else toast.error(firebaseMessage(err))
      } finally { setBusy(btn, false) }
    }
  }

  function auditTab(root) {
    const st = { module: '', page: 1 }
    const load = async () => {
      root.innerHTML = `<section class="panel"><div class="panel-head"><h2>Audit Log</h2><select class="input input-auto" id="mod" aria-label="Module">
        <option value="">All modules</option>${options(['auth', 'setup', 'sales', 'products', 'categories', 'expenses', 'store_members', 'stores', 'profiles'].map((x) => [x, x.replace('_', ' ')]), st.module)}</select></div><div id="list">${spinnerBlock()}</div></section>`
      root.querySelector('#mod').onchange = (e) => { st.module = e.target.value; st.page = 1; load() }
      const box = root.querySelector('#list')
      try {
        const res = await rpc('list_audit_logs', { p_store_id: store().id, p_module: st.module || null, p_limit: 25, p_offset: (st.page - 1) * 25 })
        box.innerHTML = !res.rows.length ? emptyBlock('No audit entries') : `<div class="table-wrap"><table class="table"><thead><tr><th>Date &amp; Time</th><th>User</th><th>Action</th><th>Module</th><th class="hide-md">Changes</th></tr></thead><tbody>
          ${res.rows.map((a) => `<tr><td class="nowrap muted">${esc(fmtDateTime(a.created_at, store()))}</td><td>${esc(a.user_name || 'System')}</td><td style="text-transform:capitalize">${esc(a.action.replace(/_/g, ' '))}</td>
            <td style="text-transform:capitalize">${esc(a.module.replace(/_/g, ' '))}</td><td class="hide-md small muted truncate" style="max-width:380px">${esc(summary(a.new_values))}</td></tr>`).join('')}</tbody></table></div>${pager(res.total, st.page, 25)}`
        box.querySelectorAll('[data-page]').forEach((b) => { b.onclick = () => { st.page = Number(b.dataset.page); load() } })
      } catch (err) { box.innerHTML = errorBlock(err) }
    }
    load()
  }

  draw()
}
