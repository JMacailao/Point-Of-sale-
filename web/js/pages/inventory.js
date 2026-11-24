import { rpc } from '../api.js'
import { can, store } from '../session.js'
import { pageHead } from '../layout.js'
import {
  esc, icon, money, num, debounce, openModal, toast, setBusy, showErrors, field, options, badge, pager, spinnerBlock,
  emptyBlock, errorBlock, fmtDateTime, MOVEMENTS,
} from '../util.js'

const TYPES = {
  stock_in: { title: 'Stock In', label: 'Quantity received', reason: false, ph: 'e.g. Supplier delivery #123' },
  stock_out: { title: 'Stock Out', label: 'Quantity removed', reason: true, ph: 'e.g. Damaged, expired' },
  adjustment: { title: 'Stock Adjustment', label: 'Counted quantity (new stock level)', reason: true, ph: 'e.g. Monthly physical count' },
}

export async function render(main, params) {
  const s = store()
  const m = (v) => money(v, s.currency)
  const manage = can('inventory.manage')
  const st = { tab: 'stock', filter: params.get('filter') || 'all', search: '', page: 1, product: null,
    mv: { type: '', from: '', to: '', search: '', page: 1 } }
  const SIZE = 25

  function frame() {
    main.innerHTML = `${pageHead('Stock / Inventory', 'Every stock change is recorded with who, when and why.')}
      <div class="tabs" role="tablist">
        <button class="tab" role="tab" data-tab="stock" aria-selected="${st.tab === 'stock'}">Current Inventory</button>
        <button class="tab" role="tab" data-tab="movements" aria-selected="${st.tab === 'movements'}">Inventory History</button></div>
      <div id="tab"></div>`
    main.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { st.tab = b.dataset.tab; if (st.tab === 'stock') st.product = null; frame() } })
    if (st.tab === 'stock') stockTab(main.querySelector('#tab'))
    else movementsTab(main.querySelector('#tab'))
  }

  // ----------------------------------------------------------------- stock
  function stockTab(root) {
    root.innerHTML = `<div id="summary"></div><section class="panel">
      <div class="toolbar"><div class="search">${icon('search')}<input class="input" id="q" placeholder="Search product" value="${esc(st.search)}" aria-label="Search"></div>
        <select class="input input-auto" id="filter" aria-label="Filter">${options([['all', 'All products'], ['low', 'Low stock alerts'], ['out', 'Out of stock']], st.filter)}</select></div>
      <div id="list">${spinnerBlock()}</div></section>`
    const load = async () => {
      const box = root.querySelector('#list')
      let res
      try {
        res = await rpc('list_inventory', { p_store_id: s.id, p_search: st.search || null, p_filter: st.filter, p_limit: SIZE, p_offset: (st.page - 1) * SIZE })
      } catch (err) { box.innerHTML = errorBlock(err); box.querySelector('[data-retry]').onclick = load; return }
      const sm = res.summary
      root.querySelector('#summary').innerHTML = `<div class="cards">
        <div class="card-stat"><div class="ic">${icon('boxes')}</div><p class="k">Units in stock</p><p class="v">${num(sm.total_units)}</p><p class="s">${sm.product_count} products</p></div>
        <div class="card-stat"><div class="ic">${icon('cash')}</div><p class="k">Stock value (cost)</p><p class="v">${m(sm.stock_value_cost)}</p><p class="s">Retail ${m(sm.stock_value_retail)}</p></div>
        <div class="card-stat ${sm.low_stock_count ? 'amber' : ''}"><div class="ic">${icon('warning')}</div><p class="k">Low stock</p><p class="v">${sm.low_stock_count}</p></div>
        <div class="card-stat ${sm.out_of_stock_count ? 'red' : ''}"><div class="ic">${icon('ban')}</div><p class="k">Out of stock</p><p class="v ${sm.out_of_stock_count ? 'text-red' : ''}">${sm.out_of_stock_count}</p></div></div>`
      if (!res.rows.length) { box.innerHTML = emptyBlock(st.filter === 'low' ? 'No low-stock products' : 'No products', st.filter === 'low' ? 'Everything is above its minimum stock level.' : ''); return }
      box.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>Product</th><th class="num">Stock</th><th class="num hide-sm">Minimum</th>
        <th class="num hide-md">Value (cost)</th><th class="hide-lg">Last movement</th><th class="actions">Actions</th></tr></thead><tbody>
        ${res.rows.map((p) => `<tr><td><span class="bold">${esc(p.name)}</span><span class="sub">${esc(p.sku || p.barcode || '—')}${p.category_name ? ` · ${esc(p.category_name)}` : ''}</span></td>
          <td class="num">${p.stock_quantity === 0 ? badge('0 · Out', 'red') : p.is_low_stock ? badge(`${p.stock_quantity} · Low`, 'amber') : `<b>${p.stock_quantity}</b>`}</td>
          <td class="num hide-sm muted">${p.minimum_stock}</td><td class="num hide-md muted">${m(p.stock_value)}</td>
          <td class="hide-lg small muted">${p.last_movement_at ? esc(fmtDateTime(p.last_movement_at, s)) : '—'}</td>
          <td class="actions">${manage ? `<button class="icon-btn" data-act="stock_in" data-id="${p.id}" aria-label="Stock in ${esc(p.name)}" title="Stock In">${icon('in')}</button>
            <button class="icon-btn" data-act="stock_out" data-id="${p.id}" aria-label="Stock out ${esc(p.name)}" title="Stock Out">${icon('out')}</button>
            <button class="icon-btn" data-act="adjustment" data-id="${p.id}" aria-label="Adjust ${esc(p.name)}" title="Adjust">${icon('clipboard')}</button>` : ''}
            <button class="icon-btn" data-hist="${p.id}" aria-label="History of ${esc(p.name)}" title="History">${icon('history')}</button></td></tr>`).join('')}
        </tbody></table></div>${pager(res.total, st.page, SIZE)}`
      box.querySelectorAll('[data-page]').forEach((b) => { b.onclick = () => { st.page = Number(b.dataset.page); load() } })
      box.querySelectorAll('[data-act]').forEach((b) => { b.onclick = () => stockModal(b.dataset.act, res.rows.find((p) => p.id === b.dataset.id), load) })
      box.querySelectorAll('[data-hist]').forEach((b) => { b.onclick = () => { st.product = res.rows.find((p) => p.id === b.dataset.hist); st.tab = 'movements'; st.mv.page = 1; frame() } })
    }
    root.querySelector('#q').oninput = debounce((e) => { st.search = e.target.value.trim(); st.page = 1; load() }, 300)
    root.querySelector('#filter').onchange = (e) => { st.filter = e.target.value; st.page = 1; load() }
    load()
  }

  function stockModal(type, p, done) {
    const t = TYPES[type]
    const md = openModal({
      title: t.title, size: 'sm',
      body: `<form id="sf" class="stack" novalidate><div class="alert alert-info"><b>${esc(p.name)}</b><br><span class="small">Current stock: <b>${p.stock_quantity}</b></span></div>
        ${field(t.label, '<input id="qty" class="input" type="number" inputmode="numeric" min="0">', { id: 'qty' })}
        ${field(`Reason${t.reason ? '' : ' (optional)'}`, `<textarea id="reason" class="input" maxlength="300" placeholder="${esc(t.ph)}"></textarea>`, { id: 'reason' })}</form>`,
      footer: '<button class="btn btn-secondary" data-close>Cancel</button><button class="btn btn-primary" id="save">Save</button>',
    })
    const el = md.el, qty = el.querySelector('#qty')
    qty.oninput = () => {
      const n = Number(qty.value)
      const hint = el.querySelector('[data-hint-for="qty"]')
      hint.textContent = qty.value === '' || !Number.isInteger(n) ? '' : `New stock will be ${type === 'stock_in' ? p.stock_quantity + n : type === 'stock_out' ? p.stock_quantity - n : n}`
    }
    el.querySelector('#sf').onsubmit = (e) => { e.preventDefault(); el.querySelector('#save').click() }
    el.querySelector('#save').onclick = async (e) => {
      const n = Number(qty.value), reason = el.querySelector('#reason').value.trim()
      const min = type === 'adjustment' ? 0 : 1
      const errs = {}
      if (!/^\d+$/.test(qty.value) || n < min) errs.qty = `Enter a whole number of at least ${min}.`
      else if (type === 'stock_out' && n > p.stock_quantity) errs.qty = `Only ${p.stock_quantity} in stock.`
      else if (type === 'adjustment' && n === p.stock_quantity) errs.qty = 'Counted quantity equals current stock.'
      if (t.reason && !reason) errs.reason = 'A reason is required.'
      if (!showErrors(el, errs)) return
      const btn = e.currentTarget
      setBusy(btn, true)
      try {
        const mv = await rpc('adjust_stock', { p_store_id: s.id, p_product_id: p.id, p_type: type, p_quantity: n, p_reason: reason || null })
        toast.success(`${t.title}: ${p.name} is now ${mv.new_quantity}`)
        md.close(); done()
      } catch (err) { setBusy(btn, false); toast.error(err) }
    }
  }

  // ------------------------------------------------------------- movements
  function movementsTab(root) {
    const f = st.mv
    root.innerHTML = `<section class="panel"><div class="toolbar">
      ${st.product ? `<span class="badge badge-green" style="padding:6px 10px">${esc(st.product.name)} &nbsp;<button class="link-btn" id="all">Show all</button></span>`
        : `<div class="search">${icon('search')}<input class="input" id="q" placeholder="Search product" value="${esc(f.search)}" aria-label="Search product"></div>`}
      <select class="input input-auto" id="type" aria-label="Movement type"><option value="">All movement types</option>${options(Object.entries(MOVEMENTS), f.type)}</select>
      <input type="date" class="input input-auto" id="from" value="${f.from}" aria-label="From date"><input type="date" class="input input-auto" id="to" value="${f.to}" aria-label="To date"></div>
      <div id="list">${spinnerBlock()}</div></section>`
    const load = async () => {
      const box = root.querySelector('#list')
      let res
      try {
        res = await rpc('list_movements', { p_store_id: s.id, p_product_id: st.product?.id ?? null, p_type: f.type || null, p_from: f.from || null,
          p_to: f.to || null, p_search: f.search || null, p_limit: SIZE, p_offset: (f.page - 1) * SIZE })
      } catch (err) { box.innerHTML = errorBlock(err); box.querySelector('[data-retry]').onclick = load; return }
      if (!res.rows.length) { box.innerHTML = emptyBlock('No stock movements'); return }
      box.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>Date &amp; Time</th><th>Product</th><th>Type</th><th class="num">Previous</th>
        <th class="num">Change</th><th class="num">New</th><th class="hide-md">Reason</th><th class="hide-sm">Performed By</th></tr></thead><tbody>
        ${res.rows.map((x) => `<tr><td class="nowrap muted">${esc(fmtDateTime(x.created_at, s))}</td><td class="bold">${esc(x.product_name)}</td>
          <td>${badge(MOVEMENTS[x.movement_type], x.quantity_changed > 0 ? 'green' : x.movement_type === 'sale' ? 'blue' : 'amber')}</td>
          <td class="num muted">${x.previous_quantity}</td><td class="num bold ${x.quantity_changed > 0 ? 'text-green' : 'text-red'}">${x.quantity_changed > 0 ? '+' : ''}${x.quantity_changed}</td>
          <td class="num">${x.new_quantity}</td><td class="hide-md muted truncate" style="max-width:260px" title="${esc(x.reason)}">${esc(x.reason || '—')}</td>
          <td class="hide-sm muted">${esc(x.performed_by_name)}</td></tr>`).join('')}</tbody></table></div>${pager(res.total, f.page, SIZE)}`
      box.querySelectorAll('[data-page]').forEach((b) => { b.onclick = () => { f.page = Number(b.dataset.page); load() } })
    }
    root.querySelector('#all')?.addEventListener('click', () => { st.product = null; movementsTab(root) })
    root.querySelector('#q')?.addEventListener('input', debounce((e) => { f.search = e.target.value.trim(); f.page = 1; load() }, 300))
    for (const k of ['type', 'from', 'to']) root.querySelector(`#${k}`).onchange = (e) => { f[k] = e.target.value; f.page = 1; load() }
    load()
  }

  frame()
}
