import { rpc } from '../api.js'
import { session, can, store } from '../session.js'
import { pageHead } from '../layout.js'
import { renderLineChart } from '../chart.js'
import { esc, icon, money, num, fmtDate, fmtTime, rangeFor, PAYMENT, badge, spinnerBlock, errorBlock, emptyBlock } from '../util.js'

const LABEL = { today: 'Today', '7d': 'Last 7 Days', month: 'This Month', custom: 'Selected Range' }

export function rangeControl(state) {
  return `<div class="row-wrap"><div class="seg" role="group" aria-label="Date range">
    ${Object.entries(LABEL).map(([k, l]) => `<button data-preset="${k}" aria-pressed="${state.preset === k}">${l === 'Selected Range' ? 'Custom' : l}</button>`).join('')}</div>
    <span class="row" ${state.preset === 'custom' ? '' : 'hidden'} data-custom>
      <input type="date" class="input input-auto" data-from value="${state.from}" aria-label="From date">
      <span class="small muted">to</span>
      <input type="date" class="input input-auto" data-to value="${state.to}" aria-label="To date"></span></div>`
}
export function bindRange(root, state, onChange, tz) {
  root.querySelectorAll('[data-preset]').forEach((b) => {
    b.onclick = () => {
      state.preset = b.dataset.preset
      if (state.preset !== 'custom') Object.assign(state, rangeFor(state.preset, tz))
      onChange()
    }
  })
  const f = root.querySelector('[data-from]'), t = root.querySelector('[data-to]')
  if (f) f.onchange = () => { if (f.value) { state.from = f.value; onChange() } }
  if (t) t.onchange = () => { if (t.value) { state.to = t.value; onChange() } }
}

export async function render(main) {
  const s = store()
  const state = { preset: 'today', ...rangeFor('today', s.timezone) }
  const m = (v) => money(v, s.currency)

  async function load() {
    const label = LABEL[state.preset]
    main.innerHTML = `${pageHead('Dashboard', `Welcome back, ${session.ctx.user.fullName || session.ctx.user.email}`, rangeControl(state))}<div id="body">${spinnerBlock()}</div>`
    bindRange(main, state, load, s.timezone)
    const body = main.querySelector('#body')
    let d
    try {
      d = await rpc('dashboard_summary', { p_store_id: s.id, p_from: state.from, p_to: state.to })
    } catch (err) {
      body.innerHTML = errorBlock(err)
      body.querySelector('[data-retry]').onclick = load
      return
    }
    const own = !can('sales.view_all')
    const card = (ic, k, v, sub = '', tone = '') => `<div class="card-stat ${tone}"><div class="ic">${icon(ic)}</div><p class="k">${esc(k)}</p><p class="v ${tone === 'red' ? 'text-red' : ''}">${esc(v)}</p>${sub ? `<p class="s">${esc(sub)}</p>` : ''}</div>`
    const tiles = [['cashier', 'cart', 'Cashier', 'pos.use'], ['products', 'package', 'Products', 'products.view'],
      ['inventory', 'boxes', 'Stock', 'inventory.view'], ['users', 'users', 'Users', 'users.manage'],
      ['reports', 'trend', 'Revenue', 'reports.view'], ['sales', 'receipt', 'Sales', 'sales.view_own']]
      .filter((t) => can(t[3])).slice(0, 5)
    body.innerHTML = `
      ${own ? '<p class="alert alert-info mb small">Showing your own sales.</p>' : ''}
      <div class="cards">
        ${card('cart', `${state.preset === 'today' ? "Today's" : label} Sales`, m(d.total_sales), d.refunded_count ? `${d.refunded_count} refunded` : '')}
        ${card('receipt', 'Transactions', num(d.transactions), `${num(d.items_sold)} item${d.items_sold === 1 ? "" : "s"} sold`)}
        ${card('cash', 'Cash Sales', m(d.cash_sales))}
        ${card('card', 'Card / GCash / Maya', m(d.non_cash_sales))}
      </div>
      <div class="cards cols-3" style="grid-template-columns:repeat(2,1fr)">
        ${card('package', 'Total Products', num(d.total_products), 'active products')}
        ${card('warning', 'Low Stock Products', num(d.low_stock_count), d.low_stock_count ? 'at or below minimum stock' : 'all products stocked', d.low_stock_count ? 'red' : '')}
      </div>
      ${s.low_stock_alerts && d.low_stock_count > 0 && can('inventory.view') ? `<div class="alert alert-warn row mb">${icon('warning')}<span>${d.low_stock_count} product${d.low_stock_count > 1 ? 's are' : ' is'} low on stock.</span><a class="ml-auto bold" href="#/inventory?filter=low">Review stock</a></div>` : ''}
      <div class="split">
        <section class="panel"><div class="panel-head"><h2>Sales Overview</h2><span class="small muted">${esc(fmtDate(state.from, s))} – ${esc(fmtDate(state.to, s))}</span></div><div class="panel-body" id="chart"></div></section>
        <section class="panel"><div class="panel-head"><h2>Recent Sales</h2><a class="small" href="#/sales">View all →</a></div>
          ${d.recent_sales.length ? `<div class="table-wrap"><table class="table"><tbody>${d.recent_sales.map((r) => `<tr>
            <td><span class="bold">${esc(r.transaction_number)}</span> ${r.status === 'refunded' ? badge('Refunded', 'red') : ''}<span class="sub">${esc(PAYMENT[r.payment_method])} · ${esc(r.cashier_name || r.cashier_email)}</span></td>
            <td class="num"><span class="bold">${m(r.total_amount)}</span><span class="sub">${esc(fmtTime(r.created_at, s))}</span></td></tr>`).join('')}</tbody></table></div>` : emptyBlock('No sales in this period')}
        </section>
      </div>
      <section class="panel mt"><div class="panel-head"><h2>Best-Selling Products</h2></div>
        ${d.best_sellers.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>#</th><th>Product</th><th class="num">Qty Sold</th><th class="num">Revenue</th></tr></thead><tbody>
          ${d.best_sellers.map((p, i) => `<tr><td class="muted">${i + 1}</td><td>${esc(p.product_name)}</td><td class="num">${num(p.quantity)}</td><td class="num">${m(p.revenue)}</td></tr>`).join('')}</tbody></table></div>`
          : emptyBlock('No sales yet', 'Best sellers appear once sales are recorded.')}
      </section>
      <div class="tiles">${tiles.map(([p, ic, l]) => `<a class="tile" href="#/${p}">${icon(ic)}${esc(l)}</a>`).join('')}</div>`
    const chart = body.querySelector('#chart')
    if (d.series.length <= 1) {
      chart.innerHTML = `<div class="empty"><p class="v" style="font-size:28px;font-weight:700;color:var(--text)">${m(d.total_sales)}</p><p class="mt-sm">${d.transactions} transactions on ${esc(fmtDate(state.from, s))}</p><p class="small faint mt-sm">Choose "Last 7 Days" or "This Month" to see the trend.</p></div>`
    } else {
      renderLineChart(chart, d.series.map((x) => ({
        label: fmtDate(x.date, s).slice(0, 5), longLabel: fmtDate(x.date, s), value: Number(x.total), sub: `${x.transactions} transactions`,
      })), {
        ariaLabel: 'Daily sales', formatValue: m,
        formatTick: (v) => (v >= 1000 ? `₱${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k` : `₱${v}`),
      })
    }
  }
  await load()
}
