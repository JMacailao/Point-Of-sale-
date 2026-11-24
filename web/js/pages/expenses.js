import { rpc } from '../api.js'
import { can, store } from '../session.js'
import { pageHead } from '../layout.js'
import {
  esc, icon, money, debounce, openModal, confirmDialog, toast, setBusy, showErrors, field, options, badge, pager,
  spinnerBlock, emptyBlock, errorBlock, fmtDate, fmtDateTime, todayIn, PAYMENT, EXPENSE_CATS, downloadCsv,
} from '../util.js'

const CAT = Object.fromEntries(EXPENSE_CATS)
const METHODS = ['cash', 'gcash', 'maya', 'bank_transfer', 'other'].map((k) => [k, PAYMENT[k]])

export async function render(main) {
  const s = store()
  const m = (v) => money(v, s.currency)
  const manage = can('expenses.manage')
  const f = { search: '', category: '', from: '', to: '', voided: false, page: 1 }
  const SIZE = 20
  const args = (extra) => ({ p_store_id: s.id, p_search: f.search || null, p_category: f.category || null, p_from: f.from || null, p_to: f.to || null, p_include_voided: f.voided, ...extra })

  main.innerHTML = `${pageHead('Expenses', 'Track operating costs. Voided expenses are kept for auditing.',
    `<button class="btn btn-secondary" id="exp">${icon('sheet')} Export Excel</button>${manage ? `<button class="btn btn-primary" id="add">${icon('plus')} Add Expense</button>` : ''}`)}
    <section class="panel"><div class="toolbar">
      <div class="search">${icon('search')}<input class="input" id="q" placeholder="Search description or reference" aria-label="Search expenses"></div>
      <select class="input input-auto" id="category" aria-label="Category"><option value="">All categories</option>${options(EXPENSE_CATS)}</select>
      <input type="date" class="input input-auto" id="from" aria-label="From date"><input type="date" class="input input-auto" id="to" aria-label="To date">
      <label class="check"><input type="checkbox" id="voided"> Show voided</label></div>
      <div id="total" class="small" style="padding:8px 12px;border-bottom:1px solid var(--border)"></div>
      <div id="list">${spinnerBlock()}</div></section>`

  async function load() {
    const box = main.querySelector('#list')
    let res
    try { res = await rpc('list_expenses', args({ p_limit: SIZE, p_offset: (f.page - 1) * SIZE })) } catch (err) { box.innerHTML = errorBlock(err); box.querySelector('[data-retry]').onclick = load; return }
    main.querySelector('#total').innerHTML = `Total (excluding voided): <b class="tabular">${m(res.total_amount)}</b>`
    if (!res.rows.length) { box.innerHTML = emptyBlock('No expenses found'); return }
    box.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Description</th><th class="hide-sm">Category</th><th class="num">Amount</th>
      <th class="hide-md">Payment</th><th class="hide-lg">Recorded By</th><th class="actions">Action</th></tr></thead><tbody>
      ${res.rows.map((x) => `<tr class="${x.is_voided ? 'faint' : ''}"><td class="nowrap">${esc(fmtDate(x.expense_date, s))}</td>
        <td><span class="${x.is_voided ? '' : 'bold'}" style="${x.is_voided ? 'text-decoration:line-through' : ''}">${esc(x.description)}</span> ${x.is_voided ? badge('Voided', 'red') : ''}${x.reference_number ? `<span class="sub">Ref: ${esc(x.reference_number)}</span>` : ''}</td>
        <td class="hide-sm">${esc(CAT[x.category])}</td><td class="num bold">${m(x.amount)}</td><td class="hide-md">${esc(PAYMENT[x.payment_method])}</td>
        <td class="hide-lg muted">${esc(x.recorded_by_name)}</td>
        <td class="actions"><button class="icon-btn" data-view="${x.id}" aria-label="View details">${icon('eye')}</button>
          ${manage && !x.is_voided ? `<button class="icon-btn" data-edit="${x.id}" aria-label="Edit expense">${icon('edit')}</button><button class="icon-btn danger" data-void="${x.id}" aria-label="Void expense">${icon('ban')}</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>${pager(res.total, f.page, SIZE)}`
    const find = (id) => res.rows.find((x) => x.id === id)
    box.querySelectorAll('[data-page]').forEach((b) => { b.onclick = () => { f.page = Number(b.dataset.page); load() } })
    box.querySelectorAll('[data-view]').forEach((b) => { b.onclick = () => detail(b.dataset.view) })
    box.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => form(find(b.dataset.edit)) })
    box.querySelectorAll('[data-void]').forEach((b) => {
      const x = find(b.dataset.void)
      b.onclick = () => confirmDialog({
        title: 'Void expense?', confirmLabel: 'Void Expense',
        message: `"${x.description}" (${m(x.amount)}) will be excluded from totals. The record is kept for auditing.`,
        extra: '<label class="label mt" for="vreason">Reason</label><textarea id="vreason" class="input" maxlength="300"></textarea>',
        onConfirm: async (el) => {
          const reason = el.querySelector('#vreason').value.trim()
          if (!reason) { toast.error('Enter a reason'); return false }
          await rpc('void_expense', { p_store_id: s.id, p_id: x.id, p_reason: reason }); toast.success('Expense voided'); load()
        },
      })
    })
  }

  function form(x = null) {
    const md = openModal({
      title: x ? 'Edit Expense' : 'Add Expense',
      body: `<form id="ef" class="grid-2" novalidate>
        ${field('Expense Description', `<input id="description" class="input" maxlength="200" value="${esc(x?.description)}">`, { id: 'description', required: true, cls: 'span-2' })}
        ${field('Expense Category', `<select id="category" class="input">${options(EXPENSE_CATS, x?.category || 'supplies')}</select>`, { id: 'category' })}
        ${field('Amount (₱)', `<input id="amount" class="input" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(x?.amount ?? '')}">`, { id: 'amount', required: true })}
        ${field('Date', `<input id="expense_date" class="input" type="date" value="${esc(x?.expense_date || todayIn(s.timezone))}">`, { id: 'expense_date', required: true })}
        ${field('Payment Method', `<select id="payment_method" class="input">${options(METHODS, x?.payment_method || 'cash')}</select>`, { id: 'payment_method' })}
        ${field('Reference Number', `<input id="reference_number" class="input" maxlength="64" value="${esc(x?.reference_number)}">`, { id: 'reference_number', cls: 'span-2' })}
        ${field('Notes', `<textarea id="notes" class="input" maxlength="1000">${esc(x?.notes)}</textarea>`, { id: 'notes', cls: 'span-2' })}
        ${x ? '<p class="small muted span-2">Changes are recorded in the expense\'s audit history.</p>' : ''}</form>`,
      footer: '<button class="btn btn-secondary" data-close>Cancel</button><button class="btn btn-primary" id="save">Save</button>',
    })
    const el = md.el
    el.querySelector('#ef').onsubmit = (e) => { e.preventDefault(); el.querySelector('#save').click() }
    el.querySelector('#save').onclick = async (e) => {
      const v = (id) => el.querySelector(`#${id}`).value.trim()
      const errs = {}
      if (!v('description')) errs.description = 'Description is required.'
      if (!/^\d+(\.\d{1,2})?$/.test(v('amount')) || Number(v('amount')) <= 0) errs.amount = 'Enter an amount greater than zero (up to 2 decimals).'
      if (!v('expense_date')) errs.expense_date = 'Date is required.'
      if (!showErrors(el, errs)) return
      const btn = e.currentTarget
      setBusy(btn, true)
      try {
        await rpc('save_expense', { p_store_id: s.id, p_id: x?.id ?? null, p_data: { description: v('description'), category: v('category'), amount: v('amount'),
          expense_date: v('expense_date'), payment_method: v('payment_method'), reference_number: v('reference_number'), notes: v('notes') } })
        toast.success(x ? 'Expense updated' : 'Expense recorded')
        md.close(); load()
      } catch (err) { setBusy(btn, false); toast.error(err) }
    }
  }

  async function detail(id) {
    const md = openModal({ title: 'Expense Details', size: 'lg', body: spinnerBlock() })
    try {
      const d = await rpc('get_expense', { p_store_id: s.id, p_id: id })
      const fmt = (k, v) => (v === null || v === undefined || v === '' ? '—' : k === 'amount' ? m(v) : k === 'category' ? CAT[v] || v : k === 'payment_method' ? PAYMENT[v] || v : String(v))
      const SKIP = new Set(['id', 'store_id', 'recorded_by', 'created_at', 'updated_at', 'voided_by', 'voided_at'])
      md.setBody(`<dl class="facts mb"><div style="grid-column:1/-1"><dt>Description</dt><dd class="bold">${esc(d.description)}</dd></div>
        <div><dt>Amount</dt><dd class="bold">${m(d.amount)}</dd></div><div><dt>Category</dt><dd>${esc(CAT[d.category])}</dd></div>
        <div><dt>Date</dt><dd>${esc(fmtDate(d.expense_date, s))}</dd></div><div><dt>Payment</dt><dd>${esc(PAYMENT[d.payment_method])}</dd></div>
        <div><dt>Reference</dt><dd>${esc(d.reference_number || '—')}</dd></div><div><dt>Recorded By</dt><dd>${esc(d.recorded_by_name)}</dd></div>
        ${d.notes ? `<div style="grid-column:1/-1"><dt>Notes</dt><dd style="white-space:pre-line">${esc(d.notes)}</dd></div>` : ''}</dl>
        ${d.is_voided ? `<p class="alert alert-error mb">Voided ${esc(fmtDateTime(d.voided_at, s))} by ${esc(d.voided_by_name)}: ${esc(d.void_reason)}</p>` : ''}
        <h3 class="bold mb">Audit history</h3>
        ${d.history.length ? d.history.map((h) => `<div class="panel mb" style="padding:8px 12px"><p class="small muted">${esc(fmtDateTime(h.created_at, s))} · ${esc(h.user_name || 'System')} · ${h.action === 'insert' ? 'created' : h.action === 'update' ? 'edited' : esc(h.action)}</p>
          ${h.action === 'update' ? `<ul class="small" style="margin:4px 0 0;padding-left:18px">${Object.keys(h.new_values || {}).filter((k) => !SKIP.has(k)).map((k) =>
            `<li><span class="muted">${esc(k.replace(/_/g, ' '))}:</span> <s class="faint">${esc(fmt(k, h.old_values?.[k]))}</s> → <b>${esc(fmt(k, h.new_values[k]))}</b></li>`).join('')}</ul>` : ''}</div>`).join('')
          : '<p class="small muted">History is visible to users with audit access.</p>'}`)
    } catch (err) { md.setBody(`<p class="text-red">${esc(err.message)}</p>`) }
  }

  main.querySelector('#exp').onclick = async (e) => {
    const btn = e.currentTarget
    setBusy(btn, true)
    try {
      const res = await rpc('list_expenses', args({ p_limit: 20000, p_offset: 0 }))
      downloadCsv(`expenses-${new Date().toISOString().slice(0, 10)}.csv`, [
        ['Date', (r) => r.expense_date], ['Description', (r) => r.description], ['Category', (r) => CAT[r.category]],
        ['Amount', (r) => Number(r.amount).toFixed(2)], ['Payment Method', (r) => PAYMENT[r.payment_method]], ['Reference Number', (r) => r.reference_number],
        ['Recorded By', (r) => r.recorded_by_name], ['Status', (r) => (r.is_voided ? 'voided' : 'active')], ['Void Reason', (r) => r.void_reason], ['Notes', (r) => r.notes],
      ], res.rows)
    } catch (err) { toast.error(err) } finally { setBusy(btn, false) }
  }
  main.querySelector('#add')?.addEventListener('click', () => form())
  main.querySelector('#q').oninput = debounce((e) => { f.search = e.target.value.trim(); f.page = 1; load() }, 300)
  for (const k of ['category', 'from', 'to']) main.querySelector(`#${k}`).onchange = (e) => { f[k] = e.target.value; f.page = 1; load() }
  main.querySelector('#voided').onchange = (e) => { f.voided = e.target.checked; f.page = 1; load() }
  await load()
}
