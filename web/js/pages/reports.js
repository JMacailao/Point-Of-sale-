import { rpc } from '../api.js'
import { store } from '../session.js'
import { pageHead } from '../layout.js'
import { rangeControl, bindRange } from './dashboard.js'
import { esc, icon, money, num, options, badge, spinnerBlock, emptyBlock, errorBlock, fmtDate, rangeFor, PAYMENT, MOVEMENTS, EXPENSE_CATS, downloadCsv } from '../util.js'

const GROUPS = [['day', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly'], ['year', 'Annual']]
const CAT = Object.fromEntries(EXPENSE_CATS)

export async function render(main) {
  const s = store()
  const m = (v) => money(v, s.currency)
  const st = { tab: 'sales', group: 'day', range: { preset: 'month', ...rangeFor('month', s.timezone) } }
  const period = (p) => (st.group === 'year' ? p.slice(0, 4)
    : st.group === 'month' ? new Date(`${p}T00:00:00Z`).toLocaleDateString('en-PH', { month: 'short', year: 'numeric', timeZone: 'UTC' })
      : st.group === 'week' ? `Week of ${fmtDate(p, s)}` : fmtDate(p, s))
  const card = (ic, k, v, sub = '', tone = '') => `<div class="card-stat ${tone}"><div class="ic">${icon(ic)}</div><p class="k">${esc(k)}</p><p class="v ${tone === 'red' ? 'text-red' : tone === 'green' ? 'text-green' : ''}">${esc(v)}</p>${sub ? `<p class="s">${esc(sub)}</p>` : ''}</div>`
  const table = (head, rows) => `<div class="table-wrap"><table class="table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`

  async function draw() {
    main.innerHTML = `${pageHead('Revenue / Reports', 'Revenue, profit and stock reports from live data.')}
      <div class="tabs" role="tablist"><button class="tab" role="tab" data-tab="sales" aria-selected="${st.tab === 'sales'}">Sales &amp; Profit</button>
        <button class="tab" role="tab" data-tab="inventory" aria-selected="${st.tab === 'inventory'}">Inventory</button></div>
      <div class="row-wrap mb">${rangeControl(st.range)}
        ${st.tab === 'sales' ? `<select class="input input-auto" id="group" aria-label="Group by">${options(GROUPS, st.group)}</select>` : ''}
        <span class="ml-auto row-wrap">${st.tab === 'sales' ? `<button class="btn btn-secondary btn-sm" id="csv">${icon('sheet')} Export Excel</button>` : ''}
        <button class="btn btn-secondary btn-sm" id="pdf">${icon('printer')} Print / PDF</button></span></div>
      <div id="body">${spinnerBlock()}</div>`
    main.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { st.tab = b.dataset.tab; draw() } })
    bindRange(main, st.range, draw, s.timezone)
    main.querySelector('#group')?.addEventListener('change', (e) => { st.group = e.target.value; draw() })
    main.querySelector('#pdf').onclick = () => printReport()
    const body = main.querySelector('#body')
    try {
      if (st.tab === 'sales') await salesReport(body)
      else await inventoryReport(body)
    } catch (err) { body.innerHTML = errorBlock(err); body.querySelector('[data-retry]').onclick = draw }
  }

  async function salesReport(body) {
    const d = await rpc('sales_report', { p_store_id: s.id, p_from: st.range.from, p_to: st.range.to, p_group: st.group })
    const t = d.totals
    body.innerHTML = `<p class="section-label">Revenue</p><div class="cards cols-5">
        ${card('receipt', 'Gross Sales', m(t.gross_sales), `${num(t.transactions + t.refund_count)} transactions`)}
        ${card('tags', 'Discounts', m(t.discounts))}
        ${card('undo', 'Refunds', m(t.refunds), `${t.refund_count} refunded`, t.refunds > 0 ? 'red' : '')}
        ${card('cart', 'Net Sales', m(t.net_sales), `${num(t.transactions)} completed`)}
        ${card('clipboard', 'Tax collected', m(t.tax))}</div>
      <p class="section-label">Profit</p><div class="cards cols-5">
        ${card('cash', 'Revenue (ex. tax)', m(t.revenue_ex_tax))}
        ${card('boxes', 'Cost of Goods Sold', m(t.cost_of_goods), 'cost at time of sale')}
        ${card('trend', 'Gross Profit', m(t.gross_profit), t.revenue_ex_tax ? `${((t.gross_profit / t.revenue_ex_tax) * 100).toFixed(1)}% margin` : '', t.gross_profit < 0 ? 'red' : 'green')}
        ${card('wallet', 'Expenses', m(t.expenses))}
        ${card('chart', 'Net Profit', m(t.net_profit), '', t.net_profit < 0 ? 'red' : 'green')}</div>
      <section class="panel mb"><div class="panel-head"><h2>${GROUPS.find((g) => g[0] === st.group)[1]} Breakdown</h2></div>
        ${d.rows.length ? table('<th>Period</th><th class="num">Txns</th><th class="num">Gross</th><th class="num hide-sm">Discounts</th><th class="num hide-sm">Refunds</th><th class="num">Net Sales</th><th class="num hide-md">COGS</th><th class="num hide-md">Gross Profit</th><th class="num hide-lg">Expenses</th><th class="num">Net Profit</th>',
          d.rows.map((r) => `<tr><td class="nowrap">${esc(period(r.period))}</td><td class="num">${r.transactions}</td><td class="num">${m(r.gross_sales)}</td>
            <td class="num hide-sm">${m(r.discounts)}</td><td class="num hide-sm">${m(r.refunds)}</td><td class="num bold">${m(r.net_sales)}</td>
            <td class="num hide-md">${m(r.cost_of_goods)}</td><td class="num hide-md">${m(r.gross_profit)}</td><td class="num hide-lg">${m(r.expenses)}</td>
            <td class="num bold ${r.net_profit < 0 ? 'text-red' : ''}">${m(r.net_profit)}</td></tr>`).join('')) : emptyBlock('No sales or expenses in this period')}</section>
      <div class="split split-even">
        <section class="panel"><div class="panel-head"><h2>Top Products</h2></div>${d.top_products.length ? table('<th>Product</th><th class="num">Qty</th><th class="num">Revenue</th><th class="num">Profit</th>',
          d.top_products.map((p) => `<tr><td>${esc(p.product_name)}</td><td class="num">${p.quantity}</td><td class="num">${m(p.revenue)}</td><td class="num">${m(p.profit)}</td></tr>`).join('')) : emptyBlock('No sales')}</section>
        <div>
          <section class="panel mb"><div class="panel-head"><h2>Sales by Payment</h2></div>${d.payment_methods.length ? table('<th>Method</th><th class="num">Txns</th><th class="num">Total</th>',
            d.payment_methods.map((p) => `<tr><td>${esc(PAYMENT[p.payment_method])}</td><td class="num">${p.transactions}</td><td class="num">${m(p.total)}</td></tr>`).join('')) : emptyBlock('No sales')}</section>
          <section class="panel mb"><div class="panel-head"><h2>Sales by Cashier</h2></div>${d.cashiers.length ? table('<th>Cashier</th><th class="num">Txns</th><th class="num">Net Sales</th>',
            d.cashiers.map((c) => `<tr><td>${esc(c.cashier_name)}</td><td class="num">${c.transactions}</td><td class="num">${m(c.total)}</td></tr>`).join('')) : emptyBlock('No sales')}</section>
          <section class="panel"><div class="panel-head"><h2>Expenses by Category</h2></div>${d.expense_categories.length ? table('<th>Category</th><th class="num">Entries</th><th class="num">Total</th>',
            d.expense_categories.map((c) => `<tr><td>${esc(CAT[c.category])}</td><td class="num">${c.count}</td><td class="num">${m(c.total)}</td></tr>`).join('')) : emptyBlock('No expenses')}</section>
        </div></div>
      <p class="small muted mt">Net Sales = totals of completed (non-refunded) sales. Revenue excludes tax. Profit uses product costs recorded at the time of each sale. Refunds are reported in the period of the original sale.</p>`
    main.querySelector('#csv').onclick = () => downloadCsv(`sales-report-${st.range.from}-to-${st.range.to}.csv`, [
      [`Period (${st.group})`, (r) => r.period], ['Transactions', (r) => r.transactions], ['Gross Sales', (r) => Number(r.gross_sales).toFixed(2)],
      ['Discounts', (r) => Number(r.discounts).toFixed(2)], ['Refunds', (r) => Number(r.refunds).toFixed(2)], ['Net Sales', (r) => Number(r.net_sales).toFixed(2)],
      ['Tax', (r) => Number(r.tax).toFixed(2)], ['Revenue (ex. tax)', (r) => Number(r.revenue_ex_tax).toFixed(2)], ['Cost of Goods', (r) => Number(r.cost_of_goods).toFixed(2)],
      ['Gross Profit', (r) => Number(r.gross_profit).toFixed(2)], ['Expenses', (r) => Number(r.expenses).toFixed(2)], ['Net Profit', (r) => Number(r.net_profit).toFixed(2)],
    ], [...d.rows, { period: 'TOTAL', ...t }])
  }

  async function inventoryReport(body) {
    const d = await rpc('inventory_report', { p_store_id: s.id, p_from: st.range.from, p_to: st.range.to })
    const tot = d.valuation.reduce((a, r) => ({ u: a.u + Number(r.units), c: a.c + Number(r.value_cost), r: a.r + Number(r.value_retail) }), { u: 0, c: 0, r: 0 })
    body.innerHTML = `<div class="cards cols-3">${card('boxes', 'Units on hand', num(tot.u))}${card('cash', 'Stock value at cost', m(tot.c))}${card('tags', 'Stock value at retail', m(tot.r))}</div>
      <div class="split split-even mb">
        <section class="panel"><div class="panel-head"><h2>Valuation by Category</h2></div>${d.valuation.length ? table('<th>Category</th><th class="num">Products</th><th class="num">Units</th><th class="num">Cost Value</th>',
          d.valuation.map((r) => `<tr><td>${esc(r.category)}</td><td class="num">${r.products}</td><td class="num">${num(r.units)}</td><td class="num">${m(r.value_cost)}</td></tr>`).join('')) : emptyBlock('No products')}</section>
        <section class="panel"><div class="panel-head"><h2>Low Stock</h2></div>${d.lowStock.length ? table('<th>Product</th><th class="num">Stock</th><th class="num">Minimum</th>',
          d.lowStock.map((p) => `<tr><td>${esc(p.name)}<span class="sub">${esc(p.sku || '')}</span></td><td class="num">${p.stock_quantity === 0 ? badge('0', 'red') : p.stock_quantity}</td><td class="num">${p.minimum_stock}</td></tr>`).join('')) : emptyBlock('No low-stock products')}</section></div>
      <section class="panel"><div class="panel-head"><h2>Stock Movement Summary</h2></div>${d.movements.length ? table('<th>Movement Type</th><th class="num">Movements</th><th class="num">Net Quantity</th>',
        d.movements.map((r) => `<tr><td>${esc(MOVEMENTS[r.movement_type])}</td><td class="num">${r.count}</td><td class="num ${r.net_quantity < 0 ? 'text-red' : 'text-green'}">${r.net_quantity > 0 ? '+' : ''}${r.net_quantity}</td></tr>`).join('')) : emptyBlock('No stock movements in this period')}</section>`
  }

  function printReport() {
    const root = document.getElementById('print-root')
    root.innerHTML = `<div style="font-family:system-ui,sans-serif;color:#000;padding:8px"><h1 style="font-size:18px">${esc(s.store_name)} — ${st.tab === 'sales' ? 'Sales & Profit Report' : 'Inventory Report'}</h1>
      <p style="font-size:12px">${esc(fmtDate(st.range.from, s))} – ${esc(fmtDate(st.range.to, s))}</p>${main.querySelector('#body').innerHTML}</div>`
    document.getElementById('receipt-page-style')?.remove()
    const style = document.createElement('style')
    style.id = 'receipt-page-style'
    style.textContent = '@page { size: A4; margin: 12mm; } #print-root .card-stat, #print-root .panel { box-shadow: none; break-inside: avoid; } #print-root .hide-sm, #print-root .hide-md, #print-root .hide-lg { display: table-cell !important; }'
    document.head.appendChild(style)
    const done = () => { root.innerHTML = ''; style.remove(); window.removeEventListener('afterprint', done) }
    window.addEventListener('afterprint', done)
    window.print()
  }

  await draw()
}
