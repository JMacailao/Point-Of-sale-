import { rpc } from '../api.js'
import { session, can, store } from '../session.js'
import { pageHead } from '../layout.js'
import { auth, createStaffAccount, sendPasswordResetEmail, firebaseMessage } from '../firebase.js'
import {
  esc, icon, openModal, confirmDialog, toast, setBusy, showErrors, field, options, badge, pager, spinnerBlock, emptyBlock,
  errorBlock, fmtDateTime, EMAIL_RE,
} from '../util.js'

const ROLES = [['cashier', 'Staff'], ['administrator', 'Administrator']]

// What an administrator can tick for each staff member (the database enforces it).
const ACCESS = [
  ['Selling', [['pos.use', 'Cashier screen', 'Sell and print receipts'], ['sales.discount', 'Give discounts', 'Without the store limit']]],
  ['Dashboard', [['dashboard.view', 'Dashboard', "Today's sales and charts"]]],
  ['Products', [['products.view', 'View products'], ['products.manage', 'Add / edit products', 'Prices, pictures, categories']]],
  ['Stock', [['inventory.view', 'View stock'], ['inventory.manage', 'Change stock', 'Stock in, stock out, counts']]],
  ['Sales', [['sales.view_own', 'Own sales', 'Sales they rang up'], ['sales.view_all', 'All sales'], ['sales.refund', 'Refunds']]],
  ['Expenses', [['expenses.view', 'View expenses'], ['expenses.manage', 'Record expenses']]],
  ['Other', [['reports.view', 'Reports', 'Revenue and profit'], ['menu.manage', "Today's Menu", 'Choose and share the menu']]],
]
const LABEL = Object.fromEntries(ACCESS.flatMap(([, items]) => items.map(([k, l]) => [k, l])))
const VIEW_OF = { 'products.manage': 'products.view', 'inventory.manage': 'inventory.view', 'expenses.manage': 'expenses.view', 'sales.refund': 'sales.view_all' }

function accessHtml(selected) {
  return `<div id="access" class="access-grid">${ACCESS.map(([group, items]) => `<fieldset><legend>${esc(group)}</legend>
    ${items.map(([k, l, h]) => `<label class="check"><input type="checkbox" value="${k}" ${selected.includes(k) ? 'checked' : ''}>
      <span>${esc(l)}${h ? `<span class="hint" style="display:block;margin:0">${esc(h)}</span>` : ''}</span></label>`).join('')}</fieldset>`).join('')}</div>`
}
function bindAccess(el) {
  el.querySelectorAll('#access input').forEach((cb) => {
    cb.onchange = () => {
      if (cb.checked && VIEW_OF[cb.value]) el.querySelector(`#access input[value="${VIEW_OF[cb.value]}"]`).checked = true
      if (!cb.checked) for (const [m, v] of Object.entries(VIEW_OF)) if (v === cb.value) el.querySelector(`#access input[value="${m}"]`).checked = false
    }
  })
}
const ORDER = Object.keys(LABEL)
// Lists ticked areas in form order; "View X" is implied by "Add / edit X".
const accessSummary = (u) => (u.role === 'administrator' ? 'Everything'
  : ORDER.filter((k) => u.permissions.includes(k) && !Object.entries(VIEW_OF).some(([m, v]) => v === k && u.permissions.includes(m)))
    .map((k) => LABEL[k]).join(', ') || '—')

export async function render(main) {
  const s = store()
  const me = session.ctx.user.id
  main.innerHTML = `${pageHead('Users', 'Create staff accounts, assign roles and control access.', `<button class="btn btn-primary" id="add">${icon('userPlus')} Create User</button>`)}
    <section class="panel" id="list">${spinnerBlock()}</section>`
  let users = []

  async function load() {
    const box = main.querySelector('#list')
    try { users = await rpc('list_members', { p_store_id: s.id }) } catch (err) { box.innerHTML = errorBlock(err); box.querySelector('[data-retry]').onclick = load; return }
    if (!users.length) { box.innerHTML = emptyBlock('No users'); return }
    box.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th class="hide-sm">Email</th><th>Role</th><th class="hide-md">Can access</th><th>Status</th><th class="hide-md">Last login</th><th class="actions">Action</th></tr></thead><tbody>
      ${users.map((u) => `<tr><td><span class="bold">${esc(u.full_name || '—')}</span>${u.id === me ? ' <span class="small muted">(you)</span>' : ''}<span class="sub hide-md-up">${esc(u.email)}</span></td>
        <td class="hide-sm muted">${esc(u.email)}</td><td>${u.role === 'administrator' ? badge('Administrator', 'blue') : badge('Staff')}</td>
        <td class="hide-md small muted" style="max-width:320px;white-space:normal">${esc(accessSummary(u))}</td>
        <td>${u.is_active ? badge('Active', 'green') : badge('Inactive', 'red')}</td>
        <td class="hide-md small muted">${u.last_login_at ? esc(fmtDateTime(u.last_login_at, s)) : 'Never'}</td>
        <td class="actions"><button class="icon-btn" data-view="${u.id}" aria-label="View ${esc(u.email)}">${icon('eye')}</button>
          <button class="icon-btn" data-edit="${u.id}" aria-label="Edit ${esc(u.email)}">${icon('edit')}</button>
          <button class="icon-btn ${u.is_active ? 'danger' : ''}" data-status="${u.id}" ${u.id === me ? 'disabled' : ''} aria-label="${u.is_active ? 'Deactivate' : 'Activate'} ${esc(u.email)}">${icon('power')}</button></td></tr>`).join('')}
      </tbody></table></div>`
    const find = (id) => users.find((u) => u.id === id)
    box.querySelectorAll('[data-view]').forEach((b) => { b.onclick = () => detail(find(b.dataset.view)) })
    box.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => form(find(b.dataset.edit)) })
    box.querySelectorAll('[data-status]').forEach((b) => {
      const u = find(b.dataset.status)
      b.onclick = () => confirmDialog({
        title: u.is_active ? 'Deactivate user?' : 'Activate user?', tone: u.is_active ? 'danger' : 'success',
        confirmLabel: u.is_active ? 'Deactivate' : 'Activate',
        message: u.is_active ? `${u.email} will immediately lose access to all POS data and actions.` : `${u.email} will be able to use the POS again.`,
        onConfirm: async () => {
          await rpc('update_store_member', { p_store_id: s.id, p_profile_id: u.id, p_full_name: null, p_role_key: null, p_is_active: !u.is_active })
          toast.success(u.is_active ? 'User deactivated' : 'User activated'); load()
        },
      })
    })
  }

  function form(u = null) {
    const md = openModal({
      title: u ? 'Edit User' : 'Create User',
      body: `<form id="uf" class="stack" novalidate>
        ${field('Email Address', `<input id="email" type="email" class="input" value="${esc(u?.email)}" ${u ? 'disabled' : ''}>`, { id: 'email', required: true })}
        ${field('Full Name', `<input id="full_name" class="input" maxlength="120" value="${esc(u?.full_name)}">`, { id: 'full_name', required: true })}
        ${field('Role', `<select id="role" class="input" ${u?.id === me ? 'disabled' : ''}>${options(ROLES, u?.role || 'cashier')}</select>`, { id: 'role' })}
        <div id="access-wrap"><p class="label">What can this user access?</p>
          <p class="small muted" style="margin-bottom:8px">Tick what they may open. Managing users and store settings is for administrators only.</p>
          ${accessHtml(u && u.role !== 'administrator' ? u.permissions : ['pos.use'])}</div>
        <p class="alert alert-info small" id="admin-note">Administrators can access everything.</p>
        ${u ? '' : '<p class="small muted">A Firebase sign-in account is created and the user receives an email to set their own password. No password is stored in the database.</p>'}</form>`,
      footer: `<button class="btn btn-secondary" data-close>Cancel</button><button class="btn btn-primary" id="save">${u ? 'Save' : 'Create User'}</button>`,
    })
    const el = md.el
    md.el.classList.add('lg')
    bindAccess(el)
    const syncRole = () => {
      const admin = el.querySelector('#role').value === 'administrator'
      el.querySelector('#access-wrap').hidden = admin
      el.querySelector('#admin-note').hidden = !admin
    }
    el.querySelector('#role').onchange = syncRole
    syncRole()
    el.querySelector('#uf').onsubmit = (e) => { e.preventDefault(); el.querySelector('#save').click() }
    el.querySelector('#save').onclick = async (e) => {
      const email = el.querySelector('#email').value.trim().toLowerCase()
      const name = el.querySelector('#full_name').value.trim()
      const role = el.querySelector('#role').value
      const errs = {}
      if (!u && !EMAIL_RE.test(email)) errs.email = 'Enter a valid email address.'
      if (!name) errs.full_name = 'Full name is required.'
      const access = [...el.querySelectorAll('#access input:checked')].map((c) => c.value)
      if (role !== 'administrator' && !access.length) { toast.error('Tick at least one thing this user can access.'); return }
      if (!showErrors(el, errs)) return
      const btn = e.currentTarget
      setBusy(btn, true, 'Saving…')
      try {
        if (u) {
          await rpc('update_store_member', { p_store_id: s.id, p_profile_id: u.id, p_full_name: name, p_role_key: u.id === me ? null : role, p_is_active: null })
          if (role !== 'administrator') await rpc('set_member_access', { p_store_id: s.id, p_profile_id: u.id, p_permissions: access })
          toast.success('User updated')
          md.close(); load()
          return
        }
        if (users.some((x) => x.email === email)) throw new Error('This user is already a member of the store.')
        const profileId = await createStaffAccount(email, (uid) => rpc('create_store_member', { p_store_id: s.id, p_firebase_uid: uid, p_email: email, p_full_name: name, p_role_key: role }))
        if (role !== 'administrator') {
          await rpc('set_member_access', { p_store_id: s.id, p_profile_id: profileId, p_permissions: access })
            .catch(() => toast.error('User created, but their access could not be saved. Edit the user to set it.'))
        }
        let emailed = true
        try { await sendPasswordResetEmail(auth, email) } catch { emailed = false }
        md.close(); load()
        openModal({ title: 'User created', body: `<p>${emailed ? `A password setup email was sent to <b>${esc(email)}</b>. They can sign in after choosing a password.`
          : 'The account was created, but the setup email could not be sent. Ask the user to use “Forgot password?” on the sign-in page.'}</p>
          <p class="small muted mt-sm">Tip: the email may land in the spam folder.</p>`, footer: '<button class="btn btn-primary" data-close>Done</button>', size: 'sm' })
      } catch (err) {
        setBusy(btn, false)
        toast.error(err.code?.startsWith?.('auth/') ? firebaseMessage(err) : err.message)
      }
    }
  }

  function detail(u) {
    const md = openModal({ title: 'User Details', size: 'lg', body: `<dl class="facts mb">
      <div><dt>Name</dt><dd class="bold">${esc(u.full_name || '—')}</dd></div><div><dt>Email</dt><dd>${esc(u.email)}</dd></div>
      <div><dt>Role</dt><dd>${u.role === 'administrator' ? 'Administrator' : 'Staff'}</dd></div>
      <div class="span-3" style="grid-column:1/-1"><dt>Can access</dt><dd>${esc(accessSummary(u))}</dd></div><div><dt>Status</dt><dd>${u.is_active ? badge('Active', 'green') : badge('Inactive', 'red')}</dd></div>
      <div><dt>Member since</dt><dd>${esc(fmtDateTime(u.member_since, s))}</dd></div><div><dt>Last login</dt><dd>${u.last_login_at ? esc(fmtDateTime(u.last_login_at, s)) : 'Never'}</dd></div>
      <div><dt>Sales processed</dt><dd>${u.sales_count}</dd></div></dl><h3 class="bold mb">Activity</h3><div id="act">${can('audit.view') ? spinnerBlock() : ''}</div>` })
    let page = 1
    const load = async () => {
      const box = md.el.querySelector('#act')
      try {
        const res = await rpc('user_activity', { p_store_id: s.id, p_profile_id: u.id, p_limit: 15, p_offset: (page - 1) * 15 })
        box.innerHTML = !res.rows.length ? emptyBlock('No activity yet') : `<div class="panel"><div class="table-wrap"><table class="table"><thead><tr><th>Date &amp; Time</th><th>Action</th><th>Module</th><th class="hide-sm">Details</th></tr></thead><tbody>
          ${res.rows.map((a) => `<tr><td class="nowrap muted">${esc(fmtDateTime(a.created_at, s))}</td><td style="text-transform:capitalize">${esc(a.action.replace(/_/g, ' '))}</td>
            <td style="text-transform:capitalize">${esc(a.module.replace(/_/g, ' '))}</td><td class="hide-sm small muted truncate" style="max-width:280px">${esc(summary(a.new_values))}</td></tr>`).join('')}
          </tbody></table></div>${pager(res.total, page, 15)}</div>`
        box.querySelectorAll('[data-page]').forEach((b) => { b.onclick = () => { page = Number(b.dataset.page); load() } })
      } catch (err) { box.innerHTML = `<p class="text-red">${esc(err.message)}</p>` }
    }
    if (can('audit.view')) load()
  }

  main.querySelector('#add').onclick = () => form()
  await load()
}

export function summary(values) {
  if (!values) return ''
  return Object.entries(values).filter(([k]) => !['id', 'store_id', 'created_at', 'updated_at'].includes(k) && !k.endsWith('_id'))
    .slice(0, 4).map(([k, v]) => `${k}: ${typeof v === 'object' && v !== null ? JSON.stringify(v) : v}`).join(', ')
}
