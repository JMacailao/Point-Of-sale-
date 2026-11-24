import { rpc } from '../api.js'
import { can, store } from '../session.js'
import { pageHead } from '../layout.js'
import { printReceipt } from '../receipt.js'
import {
  esc, icon, money, debounce, openModal, toast, setBusy, options, badge, pager, spinnerBlock, emptyBlock, errorBlock,
  fmtDateTime, PAYMENT, downloadCsv,
} from '../util.js'

export async function render(main) {
  const s = store()
  const m = (v) => money(v, s.currency)
  const all = can('sales.view_all')
  const f = { search: '', from: '', to: '', cashier: '', method: '', status: '', page: 1 }
  const SIZE = 20
  const args = (extra = {}) => ({ p_store_id: s.id, p_search: f.search || null, p_from: f.from || null, p_to: f.to || null,
    p_cashier_id: f.cashier || null, p_payment_method: f.method || null, p_status: f.status || null, ...extra })

  main.innerHTML = `${pageHead('Revenue & Sales', all ? 'All transactions in this store.' : 'Your transactions.', `<button class="btn btn-secondary" id="exp">${icon('download')} Export CSV</button>`)}
    <div id="totals"></div>
    <section class="panel"><div class="toolbar">
      <div class="search">${icon('search')}<input class="input" id="q" placeholder="Transaction number" aria-label="Search transaction number"></div>
      <input type="date" class="input input-auto" id="from" aria-label="From date"><input type="date" class="input input-auto" id="to" aria-label="To date">
      ${all ? '<select class="input input-auto" id="cashier" aria-label="Cashier"><option value="">All cashiers</option></select>' : ''}
      <select class="input input-auto" id="method" aria-label="Payment method"><option value="">All payments</option>${options(['cash', 'gcash', 'maya', 'other'].map((k) => [k, PAYMENT[k]]))}</select>
      <select class="input input-auto" id="status" aria-label="Status">${options([['', 'All statuses'], ['completed', 'Completed'], ['refunded', 'Refunded']])}</select>
    </div><div id="list">${spinnerBlock()}</div></section>`

  async function load() {
    const box = main.querySelector('#list')
    let res
    try { res = await rpc('list_sales', args({ p_limit: SIZE, p_offset: (f.page - 1) * SIZE })) } catch (err) { box.innerHTML = errorBlock(err); box.querySelector('[data-retry]').onclick = load; return }
    const t = res.totals
    main.querySelector('#totals').innerHTML = `<div class="cards cols-3">
      <div class="card-stat"><div class="ic">${icon('receipt')}</div><p class="k">Completed sales</p><p class="v">${m(t.completed_total)}</p><p class="s">${t.completed_count} transactions</p></div>
      <div class="card-stat red"><div class="ic">${icon('undo')}</div><p class="k">Refunded</p><p class="v">${m(t.refunded_total)}</p></div>
      <div class="card-stat"><div class="ic">${icon('trend')}</div><p class="k">Average sale</p><p class="v">${m(t.completed_count ? t.completed_total / t.completed_count : 0)}</p></div></div>`
    if (!res.rows.length) { box.innerHTML = emptyBlock('No transactions found'); return }
    box.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>Transaction #</th><th>Date &amp; Time</th>${all ? '<th class="hide-md">Cashier</th>' : ''}
      <th class="num hide-lg">Subtotal</th><th class="num hide-lg">Discount</th><th class="num">Total</th><th class="hide-sm">Payment</th><th>Status</th></tr></thead><tbody>
      ${res.rows.map((r) => `<tr class="clickable" data-id="${r.id}" tabindex="0"><td class="bold text-blue nowrap">${esc(r.transaction_number)}</td>
        <td class="nowrap muted">${esc(fmtDateTime(r.created_at, s))}</td>${all ? `<td class="hide-md">${esc(r.cashier_name)}</td>` : ''}
        <td class="num hide-lg">${m(r.subtotal)}</td><td class="num hide-lg muted">${r.discount > 0 ? `−${m(r.discount)}` : '—'}</td>
        <td class="num bold">${m(r.total_amount)}</td><td class="hide-sm">${esc(PAYMENT[r.payment_method])}</td>
        <td>${r.status === 'completed' ? badge('Completed', 'green') : badge('Refunded', 'red')}</td></tr>`).join('')}</tbody></table></div>${pager(res.total, f.page, SIZE)}`
    box.querySelectorAll('[data-page]').forEach((b) => { b.onclick = () => { f.page = Number(b.dataset.page); load() } })
    box.querySelectorAll('tr[data-id]').forEach((tr) => {
      tr.onclick = () => openSale(tr.dataset.id, load)
      tr.onkeydown = (e) => { if (e.key === 'Enter') openSale(tr.dataset.id, load) }
    })
  }

  async function openSale(id, onChanged) {
    const md = openModal({ title: 'Transaction', size: 'lg', body: spinnerBlock() })
    let sale
    try { sale = await rpc('get_sale', { p_store_id: s.id, p_sale_id: id }) } catch (err) { md.setBody(`<p class="text-red">${esc(err.message)}</p>`); return }
    const draw = () => {
      md.el.querySelector('.modal-head h2').textContent = `Transaction ${sale.transaction_number}`
      const refs = sale.payments.filter((p) => p.reference_number)
      md.setBody(`<dl class="facts cols-4 mb"><div><dt>Date &amp; Time</dt><dd>${esc(fmtDateTime(sale.created_at, s))}</dd></div><div><dt>Cashier</dt><dd>${esc(sale.cashier_name)}</dd></div>
          <div><dt>Payment</dt><dd>${esc(PAYMENT[sale.payment_method])}</dd></div><div><dt>Status</dt><dd>${sale.status === 'completed' ? badge('Completed', 'green') : badge('Refunded', 'red')}</dd></div></dl>
        ${sale.status === 'refunded' ? `<p class="alert alert-error mb">Refunded ${esc(fmtDateTime(sale.refunded_at, s))} by ${esc(sale.refunded_by_name)}: ${esc(sale.refund_reason)}</p>` : ''}
        <div class="panel mb"><div class="table-wrap"><table class="table"><thead><tr><th>Product</th><th class="num">Qty</th><th class="num">Unit Price</th><th class="num">Subtotal</th></tr></thead><tbody>
          ${sale.items.map((i) => `<tr><td>${esc(i.product_name)}<span class="sub">${esc(i.sku || '')}</span></td><td class="num">${i.quantity}</td><td class="num">${m(i.unit_price)}</td><td class="num">${m(i.subtotal)}</td></tr>`).join('')}</tbody></table></div></div>
        <dl class="totals"><div><dt>Subtotal</dt><dd>${m(sale.subtotal)}</dd></div><div><dt>Discount</dt><dd>−${m(sale.discount)}</dd></div>
          ${sale.tax_amount > 0 ? `<div><dt>${esc(s.tax_name)} ${sale.tax_inclusive ? '(incl.)' : ''}</dt><dd>${m(sale.tax_amount)}</dd></div>` : ''}
          <div class="grand"><dt>Total</dt><dd>${m(sale.total_amount)}</dd></div><div><dt>Amount received</dt><dd>${m(sale.amount_received)}</dd></div>
          <div><dt>Change</dt><dd>${m(sale.change_amount)}</dd></div>${refs.map((p) => `<div><dt>Reference #</dt><dd>${esc(p.reference_number)}</dd></div>`).join('')}</dl>
        <div id="refund-box"></div>`)
      md.setFooter(`${can('sales.refund') && sale.status === 'completed' ? `<button class="btn btn-danger" id="refund">${icon('undo')} Refund</button>` : ''}
        <select class="input input-auto" id="paper" aria-label="Paper size">${options([['58mm', '58mm'], ['80mm', '80mm'], ['a4', 'A4 / Letter']], s.receipt_paper)}</select>
        <button class="btn btn-primary" id="print">${icon('printer')} Print Receipt</button>`)
      md.el.querySelector('#print').onclick = () => printReceipt(sale, s, md.el.querySelector('#paper').value)
      md.el.querySelector('#refund')?.addEventListener('click', () => {
        md.el.querySelector('#refund-box').innerHTML = `<div class="alert alert-error mt"><p class="mb">Refund the full amount of <b>${m(sale.total_amount)}</b> and return all items to stock.</p>
          <label class="label" for="reason">Refund reason</label><textarea id="reason" class="input" maxlength="300"></textarea>
          <div class="row mt-sm" style="justify-content:flex-end"><button class="btn btn-secondary" id="rc">Cancel</button><button class="btn btn-danger" id="ro">Confirm Refund</button></div></div>`
        md.el.querySelector('#rc').onclick = () => { md.el.querySelector('#refund-box').innerHTML = '' }
        md.el.querySelector('#ro').onclick = async (e) => {
          const reason = md.el.querySelector('#reason').value.trim()
          if (!reason) return toast.error('Enter a refund reason')
          setBusy(e.currentTarget, true)
          try {
            await rpc('refund_sale', { p_store_id: s.id, p_sale_id: sale.id, p_reason: reason })
            sale = await rpc('get_sale', { p_store_id: s.id, p_sale_id: sale.id })
            toast.success('Sale refunded and items restocked')
            draw(); onChanged()
          } catch (err) { setBusy(e.currentTarget, false); toast.error(err) }
        }
      })
    }
    draw()
  }

  main.querySelector('#exp').onclick = async (e) => {
    const btn = e.currentTarget
    setBusy(btn, true)
    try {
      const res = await rpc('list_sales', args({ p_limit: 20000, p_offset: 0 }))
      downloadCsv(`sales-${new Date().toISOString().slice(0, 10)}.csv`, [
        ['Transaction Number', (r) => r.transaction_number], [`Date/Time (${s.timezone})`, (r) => fmtDateTime(r.created_at, s)],
        ['Cashier', (r) => r.cashier_name], ['Items', (r) => r.item_count], ['Subtotal', (r) => Number(r.subtotal).toFixed(2)],
        ['Discount', (r) => Number(r.discount).toFixed(2)], ['Tax', (r) => Number(r.tax_amount).toFixed(2)], ['Total', (r) => Number(r.total_amount).toFixed(2)],
        ['Payment Method', (r) => PAYMENT[r.payment_method]], ['Reference Number', (r) => r.reference_number],
        ['Amount Received', (r) => Number(r.amount_received).toFixed(2)], ['Change', (r) => Number(r.change_amount).toFixed(2)], ['Status', (r) => r.status],
      ], res.rows)
    } catch (err) { toast.error(err) } finally { setBusy(btn, false) }
  }
  main.querySelector('#q').oninput = debounce((e) => { f.search = e.target.value.trim(); f.page = 1; load() }, 300)
  for (const k of ['from', 'to', 'cashier', 'method', 'status']) {
    const el = main.querySelector(`#${k}`)
    if (el) el.onchange = () => { f[k] = el.value; f.page = 1; load() }
  }
  if (all) {
    rpc('list_sale_cashiers', { p_store_id: s.id }).then((list) => {
      main.querySelector('#cashier').insertAdjacentHTML('beforeend', options(list.map((c) => [c.id, c.name])))
    }).catch(() => {})
  }
  await load()
}
