import { rpc, uploadImage } from '../api.js'
import { session, can, store } from '../session.js'
import { pageHead } from '../layout.js'
import { changePassword, firebaseMessage } from '../firebase.js'
import { printReceipt } from '../receipt.js'
import { openCameraScanner, cameraSupported } from '../scanner.js'
import { bluetoothSupported, savedPrinter, isConnected, choosePrinter, forgetPrinter, reconnect, printMethod, setPrintMethod, nativeBluetooth } from '../btprinter.js'
import { isNativeApp } from '../native.js'
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
    const sample = () => ({
      transaction_number: 'TEST-PRINT', created_at: new Date().toISOString(), cashier_name: session.ctx.user.fullName || session.ctx.user.email,
      status: 'completed', items: [{ id: 1, product_name: 'Sample item', quantity: 2, unit_price: 25, subtotal: 50 }],
      subtotal: 50, discount: 0, tax_amount: 0, total_amount: 50, payment_method: 'cash', amount_received: 100, change_amount: 50, payments: [],
    })
    function drawPrinter() {
      const method = printMethod()
      const saved = savedPrinter()
      const btOk = bluetoothSupported()
      return panel('Printer Settings', `
        <p class="label">How should receipts print on this device?</p>
        <div class="pay-tiles" style="grid-template-columns:repeat(2,1fr)">
          <button type="button" class="pay-tile" data-method="dialog" aria-pressed="${method === 'dialog'}">${icon('printer')}Printers on this device<span class="small muted" style="font-weight:400">${isNativeApp() ? 'Android printing: Wi-Fi printers, PDF, print apps' : 'USB, Wi-Fi, network, Android print service'}</span></button>
          <button type="button" class="pay-tile" data-method="bluetooth" aria-pressed="${method === 'bluetooth'}" ${btOk ? '' : 'disabled'}>${icon('bluetooth')}Bluetooth printer<span class="small muted" style="font-weight:400">${btOk ? 'Direct to a Bluetooth thermal printer' : 'Not supported in this browser'}</span></button>
        </div>
        ${method === 'dialog' ? `<p class="small muted mt">When you print, the device's print window opens and lists every printer installed on this device — choose your receipt printer there.</p>` : ''}
        ${method === 'bluetooth' && isNativeApp() ? `<div class="setting-row mt">${icon('bluetooth')}<div class="grow">
            <p class="bold">${saved ? esc(saved.name) : 'No printer connected'}</p>
            <p class="small ${isConnected() ? 'text-green' : 'muted'}" id="bt-state">${saved ? `${esc(saved.address)} · ${isConnected() ? 'Connected' : 'reconnects automatically when you print'}` : 'Turn the printer on, then scan and tap Connect.'}</p></div>
            <div class="row-wrap">${saved ? '<button class="btn btn-ghost btn-sm" id="bt-forget">Forget</button>' : ''}<button class="btn btn-primary" id="nbt-scan">${icon('search')} Scan for printers</button></div></div>
          <div id="nbt-list"></div>
          <p class="small muted">Shows printers already paired in Android and nearby Bluetooth devices. Most portable thermal printers (58mm/80mm) work. If a printer asks for a PIN, try 0000 or 1234.</p>` : ''}
        ${method === 'bluetooth' && !isNativeApp() ? `<div class="setting-row mt">${icon('bluetooth')}<div class="grow">
            <p class="bold">${saved ? esc(saved.name) : 'No printer connected'}</p>
            <p class="small ${saved && isConnected() ? 'text-green' : 'muted'}" id="bt-state">${saved ? (isConnected() ? 'Connected' : 'Saved — reconnects when you print') : 'Turn your printer on, then press “Find Bluetooth printers”.'}</p></div>
            <div class="row-wrap">${saved ? '<button class="btn btn-ghost btn-sm" id="bt-forget">Forget</button>' : ''}<button class="btn btn-primary" id="bt-find">${icon('search')} Find Bluetooth printers</button></div></div>
          <p class="small muted">A list of nearby Bluetooth devices opens — pick your printer. Works in Chrome/Edge on Android, Windows and Mac with Bluetooth (BLE) thermal printers. iPhone/iPad: use “Printers on this device”.</p>` : ''}
        ${!btOk ? `<p class="small muted mt">Bluetooth printing needs Chrome or Edge on Android, Windows or Mac${window.isSecureContext ? '' : ' and an HTTPS address'}.</p>` : ''}
        <div class="row-wrap mt">${field('Receipt paper size', `<select id="paper" class="input input-auto" ${admin ? '' : 'disabled'}>${options([['58mm', '58mm thermal'], ['80mm', '80mm thermal'], ['a4', 'A4 / Letter (standard printer)']], store().receipt_paper)}</select>`, { id: 'paper' })}
          ${admin ? '<button class="btn btn-secondary" id="save-paper" style="margin-top:6px">Save</button>' : ''}
          <button class="btn btn-primary" id="test" style="margin-top:6px">${icon('printer')} Test Print</button></div>`)
    }
    function drawScanner() {
      return panel('Scanner Settings', `
        <div class="setting-row">${icon('scan')}<div class="grow"><p class="bold">USB / Bluetooth barcode scanner</p>
          <p class="small muted">Scanners that type like a keyboard add products instantly on the Cashier screen. Turn this off if you have no scanner: the Cashier screen then shows a large “Scan with camera” button.</p></div>
          <label class="switch"><input type="checkbox" id="scanner" ${scannerEnabled() ? 'checked' : ''} aria-label="Enable barcode scanner"><span></span></label></div>
        <div class="setting-row">${icon('camera')}<div class="grow"><p class="bold">Camera scanner</p>
          <p class="small muted">${cameraSupported() ? 'Scan barcodes with the phone or tablet camera, or a webcam — always available on the Cashier screen and in the product form.' : 'The camera needs an HTTPS address and a browser with camera access.'}</p></div>
          <button class="btn btn-secondary" id="cam-test" ${cameraSupported() ? '' : 'disabled'}>${icon('camera')} Test camera</button></div>`)
    }
    function draw() {
      root.innerHTML = drawPrinter() + drawScanner()
      root.querySelectorAll('[data-method]').forEach((b) => { b.onclick = () => { setPrintMethod(b.dataset.method); draw() } })
      root.querySelector('#bt-find')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget
        try {
          const pending = choosePrinter() // must start inside the click: opens the list of nearby devices
          setBusy(btn, true, 'Connecting…')
          const p = await pending
          toast.success(`Connected to ${p.name}`)
          draw()
        } catch (err) { setBusy(btn, false); if (err.code !== 'CANCELLED') toast.error(err) }
      })
      root.querySelector('#bt-forget')?.addEventListener('click', () => { forgetPrinter(); toast.info('Printer forgotten'); draw() })
      const scanBtn = root.querySelector('#nbt-scan')
      if (scanBtn) {
        const listBox = root.querySelector('#nbt-list')
        let paired = [], nearby = []
        const row = (d) => `<div class="setting-row" style="padding:8px 0">${icon(d.likelyPrinter ? 'printer' : 'bluetooth')}<div class="grow"><p class="bold">${esc(d.name)}
            ${d.likelyPrinter ? '<span class="badge badge-green">Printer</span>' : ''} ${d.paired ? '<span class="badge">Paired</span>' : ''}</p><p class="small muted">${esc(d.address)}</p></div>
            ${savedPrinter()?.address === d.address && isConnected() ? '<span class="badge badge-green">Connected</span>' : `<button class="btn btn-secondary btn-sm" data-connect="${esc(d.address)}">Connect</button>`}</div>`
        const sortP = (a, b) => (b.likelyPrinter - a.likelyPrinter) || String(a.name).localeCompare(String(b.name))
        const renderList = (scanning) => {
          const others = nearby.filter((n) => !paired.some((p) => p.address === n.address)).sort(sortP)
          listBox.innerHTML = `${paired.length ? `<p class="section-label mt">Paired devices</p>${[...paired].sort(sortP).map(row).join('')}` : ''}
            <p class="section-label mt">Nearby devices ${scanning ? '<span class="spinner" style="width:12px;height:12px"></span>' : ''}</p>
            ${others.length ? others.map(row).join('') : `<p class="small muted">${scanning ? 'Searching…' : 'No other devices found. Make sure the printer is on and not connected to another phone.'}</p>`}`
          listBox.querySelectorAll('[data-connect]').forEach((b) => {
            b.onclick = async () => {
              const dev = [...paired, ...nearby].find((d) => d.address === b.dataset.connect)
              setBusy(b, true, 'Connecting…')
              try {
                await nativeBluetooth.stopScan()
                const p = await nativeBluetooth.connect(dev)
                toast.success(`Connected to ${p.name}`)
                draw()
              } catch (err) { setBusy(b, false); toast.error(err) }
            }
          })
        }
        scanBtn.onclick = async () => {
          setBusy(scanBtn, true, 'Scanning…')
          try {
            await nativeBluetooth.prepare()
            paired = await nativeBluetooth.paired()
            nearby = []
            renderList(true)
            await nativeBluetooth.startScan()
            for (let i = 0; i < 16; i++) {
              await new Promise((r) => setTimeout(r, 1000))
              if (!root.isConnected) return
              const res = await nativeBluetooth.results()
              nearby = res.devices
              renderList(res.scanning)
              if (!res.scanning) break
            }
            renderList(false)
          } catch (err) {
            toast.error(err.code === 'BLUETOOTH_OFF' ? 'Turn on Bluetooth to find printers.' : err)
          } finally { setBusy(scanBtn, false); nativeBluetooth.stopScan() }
        }
        // Show already-paired printers right away when permission was given before.
        nativeBluetooth.status().then(async (st) => {
          if (st.permission && st.enabled) { paired = await nativeBluetooth.paired(); renderList(false) }
          if (st.connected) { const el = root.querySelector('#bt-state'); if (el) { el.textContent = `${st.address} · Connected`; el.className = 'small text-green' } }
        }).catch(() => {})
      }
      root.querySelector('#scanner').onchange = (e) => {
        try { localStorage.setItem('pos.scannerEnabled', String(e.target.checked)) } catch { /* ignore */ }
        toast.success(e.target.checked ? 'Hardware scanner on' : 'Hardware scanner off — camera scanning is the main option')
      }
      root.querySelector('#cam-test').onclick = async () => {
        const code = await openCameraScanner({ title: 'Test camera scanner' })
        if (code) toast.success(`Scanned: ${code}`)
      }
      root.querySelector('#save-paper')?.addEventListener('click', (e) => save({ receipt_paper: root.querySelector('#paper').value }, e.currentTarget))
      root.querySelector('#test').onclick = () => printReceipt(sample(), store(), root.querySelector('#paper').value)
      if (printMethod() === 'bluetooth' && savedPrinter() && !isConnected()) {
        reconnect().then((ok) => { const el = root.querySelector('#bt-state'); if (ok && el) { el.textContent = 'Connected'; el.className = 'small text-green' } })
      }
    }
    draw()
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
