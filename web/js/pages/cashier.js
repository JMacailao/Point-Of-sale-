import { rpc } from '../api.js'
import { can, store } from '../session.js'
import { receiptHtml, printReceipt } from '../receipt.js'
import { openCameraScanner } from '../scanner.js'
import {
  esc, icon, money, toCents, fromCents, debounce, openModal, confirmDialog, toast, setBusy, newRequestId,
  spinnerBlock, emptyBlock, PAYMENT,
} from '../util.js'

const METHODS = [['cash', 'cash', 'Cash'], ['gcash', 'phone', 'GCash'], ['maya', 'phone', 'Maya'], ['other', 'card', 'Card / Other']]

export function scannerEnabled() {
  try { return localStorage.getItem('pos.scannerEnabled') !== 'false' } catch { return true }
}

export async function render(main) {
  const s = store()
  const m = (v) => money(v, s.currency)
  const canDiscount = can('sales.discount') || s.allow_cashier_discount
  const discountLimit = can('sales.discount') ? 100 : Number(s.max_discount_percent)
  const st = { products: [], categories: [], category: '', search: '', cart: [], discountType: 'none', discountValue: '', view: 'products', requestId: newRequestId() }

  main.innerHTML = `<div class="pos">
    <div class="pos-tabs" role="tablist">
      <button role="tab" data-view="products">Products</button><button role="tab" data-view="cart" id="cart-tab">Cart</button></div>
    <div class="pos-grid">
      <section class="pos-pane" id="pane-products">
        <div class="pos-search">
          <div class="row"><div class="wrap grow">${icon('search', 'l')}<input id="q" class="input" placeholder="Search product, SKU or scan barcode…" aria-label="Search products or scan barcode" autocomplete="off"></div>
            <button class="btn ${scannerEnabled() ? 'btn-secondary' : 'btn-primary'}" id="cam-scan" style="height:40px" aria-label="Scan barcode with camera" title="Scan with camera">${icon('camera')}<span class="hide-sm">${scannerEnabled() ? '' : 'Scan with camera'}</span></button></div>
          <div class="chips" id="chips"></div>
        </div>
        <div class="scroll" id="plist">${spinnerBlock()}</div>
      </section>
      <section class="pos-pane" id="pane-cart"></section>
    </div></div>`
  const q = main.querySelector('#q')

  // -------------------------------------------------------------- data
  async function loadProducts() {
    try {
      const res = await rpc('list_products', { p_store_id: s.id, p_search: st.search || null, p_category_id: st.category || null, p_status: 'active', p_limit: 200 })
      st.products = res.rows
      renderProducts()
    } catch (err) {
      main.querySelector('#plist').innerHTML = `<p class="alert alert-error" style="margin:12px">${esc(err.message)}</p>`
    }
  }
  async function loadCategories() {
    st.categories = await rpc('list_categories', { p_store_id: s.id }).catch(() => [])
    renderChips()
  }

  // ----------------------------------------------------------- rendering
  function renderChips() {
    main.querySelector('#chips').innerHTML = [['', 'All'], ...st.categories.map((c) => [c.id, c.name])]
      .map(([id, n]) => `<button class="chip" data-cat="${esc(id)}" aria-pressed="${st.category === id}">${esc(n)}</button>`).join('')
  }
  function renderProducts() {
    const box = main.querySelector('#plist')
    if (!st.products.length) {
      box.innerHTML = emptyBlock('No products found', st.search ? 'Try another search or scan again.' : 'Add products in the Products module.')
      return
    }
    box.innerHTML = `<div class="pgrid">${st.products.map((p) => {
      const inCart = st.cart.find((c) => c.product.id === p.id)?.quantity || 0
      const out = p.stock_quantity - inCart <= 0
      return `<button class="pcard" data-add="${p.id}" ${out ? 'disabled' : ''} aria-label="Add ${esc(p.name)}">
        ${inCart ? `<span class="incart">${inCart}</span>` : ''}
        <span class="pimg">${p.image_url ? `<img src="${esc(p.image_url)}" alt="" loading="lazy">` : icon('package')}</span>
        <span class="nm">${esc(p.name)}</span><span class="pr">${m(p.selling_price)}</span>
        <span class="st ${p.stock_quantity <= p.minimum_stock ? 'text-amber' : ''}">${p.stock_quantity} in stock</span></button>`
    }).join('')}</div>`
  }

  function totals() {
    const subtotal = st.cart.reduce((a, i) => a + toCents(i.product.selling_price) * i.quantity, 0)
    const value = Number(st.discountValue) || 0
    let discount = 0
    if (st.discountType === 'amount') discount = Math.min(subtotal, toCents(value))
    if (st.discountType === 'percent') discount = Math.round(subtotal * Math.min(100, value) / 100)
    const taxable = subtotal - discount
    let tax = 0, total = taxable
    if (s.tax_enabled && Number(s.tax_rate) > 0) {
      const r = Number(s.tax_rate)
      if (s.tax_inclusive) tax = Math.round(taxable * r / (100 + r))
      else { tax = Math.round(taxable * r / 100); total = taxable + tax }
    }
    return { subtotal, discount, tax, total, pct: subtotal ? discount * 100 / subtotal : 0, items: st.cart.reduce((a, i) => a + i.quantity, 0) }
  }

  function cartProblem(t) {
    if (!st.cart.length) return 'Add products to the cart'
    if (st.discountType !== 'none' && t.pct > discountLimit + 1e-9) return `Discount exceeds the ${discountLimit}% limit`
    if (st.discountType === 'amount' && toCents(st.discountValue) > t.subtotal) return 'Discount exceeds subtotal'
    return null
  }

  function renderCart() {
    const t = totals()
    const problem = cartProblem(t)
    main.querySelector('#cart-tab').textContent = `Cart (${t.items}) · ${m(fromCents(t.total))}`
    main.querySelector('#pane-cart').innerHTML = `
      <div class="panel-head"><h2>Cart (${t.items})</h2>${st.cart.length ? `<button class="icon-btn danger" id="clear-top" aria-label="Clear cart">${icon('trash')}</button>` : ''}</div>
      <div class="scroll">${!st.cart.length ? emptyBlock('Cart is empty', 'Tap, search or scan products to add them.') : st.cart.map(({ product: p, quantity }) => `
        <div class="cart-line"><div class="row between"><div class="grow"><p class="bold truncate">${esc(p.name)}</p><p class="small muted">${m(p.selling_price)} each</p></div>
          <p class="bold tabular">${m(fromCents(toCents(p.selling_price) * quantity))}</p></div>
          <div class="qty"><button class="sq" data-dec="${p.id}" aria-label="Decrease ${esc(p.name)}" ${quantity <= 1 ? 'disabled' : ''}>${icon('minus')}</button>
            <input class="input" type="number" inputmode="numeric" min="1" max="${p.stock_quantity}" value="${quantity}" data-qty="${p.id}" aria-label="Quantity of ${esc(p.name)}">
            <button class="sq" data-inc="${p.id}" aria-label="Increase ${esc(p.name)}" ${quantity >= p.stock_quantity ? 'disabled' : ''}>${icon('plus')}</button>
            <span class="small faint" style="margin-left:6px">of ${p.stock_quantity}</span>
            <button class="icon-btn danger ml-auto" data-remove="${p.id}" aria-label="Remove ${esc(p.name)}">${icon('trash')}</button></div></div>`).join('')}</div>
      <div class="checkout">
        ${canDiscount && st.cart.length ? `<div class="row"><span class="small bold" style="width:70px">Discount</span>
          <select class="input input-auto" id="dtype" aria-label="Discount type"><option value="none">None</option><option value="amount" ${st.discountType === 'amount' ? 'selected' : ''}>Amount ₱</option><option value="percent" ${st.discountType === 'percent' ? 'selected' : ''}>Percent %</option></select>
          ${st.discountType !== 'none' ? `<input class="input grow" type="number" step="0.01" min="0" id="dval" value="${esc(st.discountValue)}" aria-label="Discount value" placeholder="${st.discountType === 'percent' ? `max ${discountLimit}%` : '0.00'}">` : ''}</div>` : ''}
        <dl class="totals" style="max-width:none">
          <div><dt>Subtotal</dt><dd>${m(fromCents(t.subtotal))}</dd></div>
          ${t.discount ? `<div><dt>Discount</dt><dd class="text-green">−${m(fromCents(t.discount))}</dd></div>` : ''}
          ${t.tax ? `<div class="small"><dt>${esc(s.tax_name)} ${s.tax_inclusive ? '(included)' : ''}</dt><dd>${m(fromCents(t.tax))}</dd></div>` : ''}
          <div class="grand" style="font-size:18px"><dt style="color:var(--text)">Total</dt><dd>${m(fromCents(t.total))}</dd></div>
        </dl>
        <div class="row"><button class="btn btn-secondary btn-lg grow" id="clear" ${st.cart.length ? '' : 'disabled'}>Clear</button>
          <button class="btn btn-primary btn-lg grow" id="pay" ${problem ? 'disabled' : ''}>Pay ${icon('right')}</button></div>
        ${problem && st.cart.length ? `<p class="small muted" style="text-align:center">${esc(problem)}</p>` : ''}
      </div>`
  }

  function setView(v) {
    st.view = v
    main.querySelector('#pane-products').hidden = v !== 'products'
    main.querySelector('#pane-cart').hidden = v !== 'cart'
    main.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === v)))
  }

  // -------------------------------------------------------------- cart ops
  function addProduct(p, qty = 1, { silent = false } = {}) {
    const line = st.cart.find((c) => c.product.id === p.id)
    const next = (line?.quantity || 0) + qty
    if (next > p.stock_quantity) {
      const msg = p.stock_quantity === 0 ? `${p.name} is out of stock` : `Only ${p.stock_quantity} of ${p.name} in stock`
      if (silent) throw new Error(msg)
      toast.error(msg)
      return false
    }
    if (line) { line.quantity = next; line.product = p } else st.cart.push({ product: p, quantity: qty })
    renderCart(); renderProducts()
    return next
  }
  function setQty(id, qty) {
    const line = st.cart.find((c) => c.product.id === id)
    if (!line) return
    if (!Number.isFinite(qty) || qty < 1) qty = 1
    if (qty > line.product.stock_quantity) { toast.error(`Only ${line.product.stock_quantity} of ${line.product.name} in stock`); qty = line.product.stock_quantity }
    line.quantity = Math.floor(qty)
    renderCart(); renderProducts()
  }
  function reset() {
    st.cart = []; st.discountType = 'none'; st.discountValue = ''; st.requestId = newRequestId()
    renderCart(); renderProducts(); setView('products')
  }
  async function lookup(code) {
    try { addProduct(await rpc('lookup_product', { p_store_id: s.id, p_code: code })); q.value = ''; st.search = ''; loadProducts() } catch (err) { toast.error(err) }
  }

  // ------------------------------------------------------------ payment
  function openPayment() {
    const t = totals()
    const pay = { method: 'cash' }
    const quick = () => {
      const total = fromCents(t.total), set = new Set([total])
      for (const step of [20, 50, 100, 500, 1000]) { const v = Math.ceil(total / step) * step; if (v > total) set.add(v) }
      return [...set].slice(0, 4)
    }
    const md = openModal({
      title: 'Select Payment Method', size: 'lg',
      body: `<div class="pay-tiles">${METHODS.map(([k, ic, l]) => `<button class="pay-tile" data-method="${k}" aria-pressed="${k === 'cash'}">${icon(ic)}${esc(l)}</button>`).join('')}</div>
        <div class="total-bar mt"><span>Total Amount</span><span class="tabular">${m(fromCents(t.total))}</span></div>
        <div class="grid-2 mt">
          <div id="cash-box"><label class="label" for="received">Cash Received</label>
            <div class="row"><input id="received" class="input" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00" style="height:44px;font-size:18px">
            <button class="btn btn-primary" data-exact>Exact Amount</button></div>
            <div class="quick">${quick().slice(1).map((a) => `<button data-amt="${a}">${m(a)}</button>`).join('')}</div></div>
          <div id="ref-box"><label class="label" for="reference">Reference No. <span id="ref-opt" class="muted">(optional)</span></label>
            <input id="reference" class="input" maxlength="64" placeholder="e.g. 1023 456 789" style="height:44px"></div>
        </div>
        <div class="change mt" id="change-box"><span>Change</span><span id="change">${m(0)}</span></div>
        <p id="pay-err" class="alert alert-error mt" hidden></p>`,
      footer: '<button class="btn btn-secondary" data-close>Cancel</button><button class="btn btn-primary btn-lg" id="confirm" style="min-width:200px">Confirm Payment</button>',
    })
    const el = md.el
    const received = el.querySelector('#received'), reference = el.querySelector('#reference'), confirm = el.querySelector('#confirm')
    const update = () => {
      const cashLike = pay.method === 'cash' || pay.method === 'other'
      el.querySelector('#cash-box').style.display = cashLike ? '' : 'none'
      el.querySelector('#ref-opt').textContent = pay.method === 'gcash' || pay.method === 'maya' ? '(required)' : '(optional)'
      el.querySelector('#ref-box').style.display = pay.method === 'cash' ? 'none' : ''
      el.querySelector('label[for=received]').textContent = pay.method === 'cash' ? 'Cash Received' : 'Amount Received (optional)'
      const rc = cashLike && received.value !== '' ? toCents(received.value) : t.total
      el.querySelector('#change-box').style.display = cashLike ? '' : 'none'
      el.querySelector('#change').textContent = m(fromCents(Math.max(0, rc - t.total)))
      let problem = null
      if (pay.method === 'cash' && (received.value === '' || rc < t.total)) problem = 'Cash received is less than the total'
      if (pay.method === 'other' && received.value !== '' && rc < t.total) problem = 'Amount received is less than the total'
      if ((pay.method === 'gcash' || pay.method === 'maya') && reference.value.trim().length < 4) problem = 'Enter the reference number'
      confirm.disabled = Boolean(problem)
      confirm.title = problem || ''
    }
    el.querySelectorAll('[data-method]').forEach((b) => {
      b.onclick = () => {
        pay.method = b.dataset.method
        el.querySelectorAll('[data-method]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)))
        received.value = ''; reference.value = ''; update()
        ;(pay.method === 'cash' ? received : reference).focus()
      }
    })
    el.querySelector('[data-exact]').onclick = () => { received.value = fromCents(t.total).toFixed(2); update() }
    el.querySelectorAll('[data-amt]').forEach((b) => { b.onclick = () => { received.value = b.dataset.amt; update() } })
    received.oninput = update
    reference.oninput = update
    received.onkeydown = (e) => { if (e.key === 'Enter' && !confirm.disabled) confirm.click() }
    update()
    setTimeout(() => received.focus(), 50)

    confirm.onclick = async () => {
      if (confirm.disabled) return
      setBusy(confirm, true, 'Processing…')
      el.querySelector('#pay-err').hidden = true
      try {
        const cashLike = pay.method === 'cash' || pay.method === 'other'
        const res = await rpc('process_sale', {
          p_store_id: s.id, p_client_request_id: st.requestId,
          p_items: st.cart.map((c) => ({ product_id: c.product.id, quantity: c.quantity })),
          p_discount_type: st.discountType, p_discount_value: st.discountType === 'none' ? 0 : Number(st.discountValue) || 0,
          p_payment_method: pay.method, p_amount_received: cashLike && received.value !== '' ? Number(received.value) : null,
          p_reference_number: reference.value.trim() || null,
        })
        const sale = await rpc('get_sale', { p_store_id: s.id, p_sale_id: res.sale_id })
        md.close()
        if (res.duplicate) toast.info(`This payment was already recorded as ${res.transaction_number}`)
        else toast.success(`Payment completed · ${res.transaction_number}`)
        reset()
        loadProducts()
        showReceipt(sale)
      } catch (err) {
        setBusy(confirm, false)
        update()
        const box = el.querySelector('#pay-err')
        box.textContent = err.message
        box.hidden = false
        if (['INSUFFICIENT_STOCK', 'PRODUCT_UNAVAILABLE'].includes(err.code)) loadProducts()
      }
    }
  }

  function showReceipt(sale) {
    const md = openModal({
      title: 'Payment completed', size: 'sm',
      body: `<div style="border:1px solid var(--border);border-radius:8px;padding:12px">${receiptHtml(sale, s, '80mm')}</div>`,
      footer: `<button class="btn btn-secondary" id="print">${icon('printer')} Print Receipt</button><button class="btn btn-primary" data-close>New Sale</button>`,
      onClose: () => setTimeout(() => q.focus(), 50),
    })
    md.el.querySelector('#print').onclick = () => printReceipt(sale, s)
  }

  // -------------------------------------------------------------- events
  main.addEventListener('click', (e) => {
    const t = e.target.closest('button')
    if (!t) return
    if (t.dataset.view) return setView(t.dataset.view)
    if (t.dataset.cat !== undefined) { st.category = t.dataset.cat; renderChips(); return loadProducts() }
    if (t.dataset.add) { const p = st.products.find((x) => x.id === t.dataset.add); if (p) addProduct(p); return }
    if (t.dataset.inc) { const l = st.cart.find((c) => c.product.id === t.dataset.inc); return setQty(l.product.id, l.quantity + 1) }
    if (t.dataset.dec) { const l = st.cart.find((c) => c.product.id === t.dataset.dec); return setQty(l.product.id, l.quantity - 1) }
    if (t.dataset.remove) { st.cart = st.cart.filter((c) => c.product.id !== t.dataset.remove); renderCart(); return renderProducts() }
    if (t.id === 'clear' || t.id === 'clear-top') {
      return confirmDialog({ title: 'Cancel transaction?', message: 'All items in the cart will be removed.', confirmLabel: 'Clear Cart', onConfirm: () => { reset(); q.focus() } })
    }
    if (t.id === 'pay') return openPayment()
    if (t.id === 'cam-scan') {
      return openCameraScanner({
        title: 'Scan products', continuous: true,
        onCode: async (code) => {
          const p = await rpc('lookup_product', { p_store_id: s.id, p_code: code })
          const qty = addProduct(p, 1, { silent: true })
          return `${p.name} — ${qty} in cart`
        },
      })
    }
  })
  main.addEventListener('change', (e) => {
    if (e.target.dataset.qty) setQty(e.target.dataset.qty, Number(e.target.value))
    if (e.target.id === 'dtype') { st.discountType = e.target.value; st.discountValue = ''; renderCart() }
  })
  main.addEventListener('input', debounce((e) => {
    if (e.target.id === 'dval') { st.discountValue = e.target.value; renderCart(); const d = main.querySelector('#dval'); d.focus(); d.setSelectionRange?.(d.value.length, d.value.length) }
  }, 400))
  const searchNow = debounce(() => loadProducts(), 250)
  q.addEventListener('input', () => { st.search = q.value.trim(); searchNow() })
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter' && q.value.trim()) { e.preventDefault(); lookup(q.value.trim()) } })

  // USB barcode scanners type fast and end with Enter; capture them when focus is not in a field.
  let buf = '', last = 0
  const onKey = (e) => {
    if (!scannerEnabled() || document.querySelector('.modal-backdrop')) return
    const a = document.activeElement
    if (a && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName)) return
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const now = performance.now()
    if (now - last > 50) buf = ''
    last = now
    if (e.key === 'Enter') { if (buf.length >= 4) { e.preventDefault(); lookup(buf) } buf = '' } else if (e.key.length === 1) buf += e.key
  }
  window.addEventListener('keydown', onKey)

  setView('products')
  renderCart()
  q.focus()
  await Promise.all([loadProducts(), loadCategories()])
  return () => window.removeEventListener('keydown', onKey)
}
