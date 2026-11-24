import { rpc, uploadImage } from '../api.js'
import { can, store } from '../session.js'
import { pageHead } from '../layout.js'
import {
  esc, icon, money, debounce, openModal, confirmDialog, toast, setBusy, showErrors, field, options, badge, pager,
  spinnerBlock, emptyBlock, errorBlock, imagePicker, bindImagePicker, downloadCsv,
} from '../util.js'

const TEMPLATE_COLUMNS = ['name', 'sku', 'barcode', 'category', 'description', 'cost_price', 'selling_price', 'minimum_stock', 'initial_stock']

/** Minimal CSV parser (quotes, commas, newlines). */
export function parseCsv(text) {
  const rows = []
  let row = [], cell = '', q = false
  text = text.replace(/^﻿/, '')
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ } else if (ch === '"') q = false; else cell += ch
    } else if (ch === '"') q = true
    else if (ch === ',') { row.push(cell); cell = '' } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

export async function render(main) {
  const s = store()
  const manage = can('products.manage')
  const m = (v) => money(v, s.currency)
  const f = { search: '', category: '', status: 'active', stock: 'all', sort: 'name:asc', page: 1 }
  const SIZE = 20
  let categories = []

  main.innerHTML = `${pageHead('Products Management', manage ? 'Manage your catalog, prices and images.' : 'Product catalog (view only).',
    manage ? `<button class="btn btn-secondary" id="tpl">${icon('download')} Download Template</button>
      <button class="btn btn-secondary" id="imp">${icon('upload')} Import Excel</button>
      <button class="btn btn-secondary" id="exp">${icon('sheet')} Export Excel</button>
      <button class="btn btn-secondary" id="cats">${icon('tags')} Categories</button>
      <button class="btn btn-primary" id="add">${icon('plus')} Add Product</button>
      <input type="file" id="imp-file" accept=".csv,text/csv" hidden>` : '')}
    <section class="panel">
      <div class="toolbar">
        <div class="search">${icon('search')}<input class="input" id="q" placeholder="Search product, SKU or barcode…" aria-label="Search products"></div>
        <select class="input input-auto" id="cat" aria-label="Category"></select>
        <select class="input input-auto" id="stock" aria-label="Stock filter">${options([['all', 'All stock'], ['low', 'Low stock'], ['out', 'Out of stock'], ['in', 'In stock']])}</select>
        ${manage ? `<select class="input input-auto" id="status" aria-label="Status">${options([['active', 'Active'], ['archived', 'Archived'], ['all', 'All statuses']])}</select>` : ''}
        <select class="input input-auto" id="sort" aria-label="Sort">${options([['name:asc', 'Name A–Z'], ['name:desc', 'Name Z–A'], ['selling_price:asc', 'Price low–high'], ['selling_price:desc', 'Price high–low'], ['stock_quantity:asc', 'Stock low–high'], ['stock_quantity:desc', 'Stock high–low'], ['created_at:desc', 'Newest']])}</select>
      </div>
      <div id="list">${spinnerBlock()}</div>
    </section>`

  async function loadCategories() {
    categories = await rpc('list_categories', { p_store_id: s.id }).catch(() => [])
    main.querySelector('#cat').innerHTML = `<option value="">All categories</option>${options(categories.map((c) => [c.id, c.name]), f.category)}`
  }

  async function load() {
    const box = main.querySelector('#list')
    box.querySelector('table')?.classList.add('loading-dim')
    const [sort, order] = f.sort.split(':')
    let res
    try {
      res = await rpc('list_products', { p_store_id: s.id, p_search: f.search || null, p_category_id: f.category || null, p_status: f.status,
        p_stock: f.stock, p_sort: sort, p_order: order, p_limit: SIZE, p_offset: (f.page - 1) * SIZE })
    } catch (err) { box.innerHTML = errorBlock(err); box.querySelector('[data-retry]').onclick = load; return }
    if (!res.rows.length) {
      box.innerHTML = emptyBlock('No products found', manage ? 'Add your first product to start selling.' : 'No products match your filters.')
      return
    }
    box.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr>
      <th>Image</th><th>Product Name</th><th class="hide-md">Barcode / SKU</th><th class="hide-md">Category</th>
      ${manage ? '<th class="num hide-sm">Cost</th>' : ''}<th class="num">Price</th><th class="num">Stock</th><th class="hide-sm">Status</th>${manage ? '<th class="actions">Action</th>' : ''}</tr></thead><tbody>
      ${res.rows.map((p) => `<tr>
        <td style="width:52px"><div class="thumb-sm">${p.image_url ? `<img src="${esc(p.image_url)}" alt="" loading="lazy">` : icon('image')}</div></td>
        <td><span class="bold">${esc(p.name)}</span><span class="sub hide-md-up">${esc([p.barcode, p.sku].filter(Boolean).join(' · '))}</span></td>
        <td class="hide-md">${esc(p.barcode || '—')}<span class="sub">${esc(p.sku || '')}</span></td>
        <td class="hide-md">${esc(p.category_name || '—')}</td>
        ${manage ? `<td class="num hide-sm muted">${m(p.cost_price)}</td>` : ''}
        <td class="num bold">${m(p.selling_price)}</td>
        <td class="num">${p.stock_quantity === 0 ? badge('Out', 'red') : p.is_low_stock ? badge(`${p.stock_quantity} low`, 'amber') : p.stock_quantity}</td>
        <td class="hide-sm">${p.is_active ? badge('Active', 'green') : badge('Archived')}</td>
        ${manage ? `<td class="actions"><button class="icon-btn" data-edit="${p.id}" aria-label="Edit ${esc(p.name)}">${icon('edit')}</button>
          <button class="icon-btn ${p.is_active ? 'danger' : ''}" data-toggle="${p.id}" aria-label="${p.is_active ? 'Archive' : 'Restore'} ${esc(p.name)}">${icon(p.is_active ? 'archive' : 'restore')}</button></td>` : ''}
      </tr>`).join('')}</tbody></table></div>${pager(res.total, f.page, SIZE)}`
    box.querySelectorAll('[data-page]').forEach((b) => { b.onclick = () => { f.page = Number(b.dataset.page); load() } })
    box.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => openForm(res.rows.find((p) => p.id === b.dataset.edit)) })
    box.querySelectorAll('[data-toggle]').forEach((b) => {
      const p = res.rows.find((x) => x.id === b.dataset.toggle)
      b.onclick = () => confirmDialog({
        title: p.is_active ? 'Archive product?' : 'Restore product?', tone: p.is_active ? 'danger' : 'primary',
        confirmLabel: p.is_active ? 'Archive' : 'Restore',
        message: p.is_active ? `"${p.name}" will no longer be available for sale. Sales history is kept.` : `"${p.name}" will be available for sale again.`,
        onConfirm: async () => { await rpc('set_product_active', { p_store_id: s.id, p_id: p.id, p_active: !p.is_active }); toast.success(p.is_active ? 'Product archived' : 'Product restored'); load() },
      })
    })
  }

  // ------------------------------------------------------------ product form
  function openForm(p = null) {
    const md = openModal({
      title: p ? 'Edit Product' : 'Add Product', size: 'lg',
      body: `<form id="pf" class="grid-2" novalidate>
        ${field('Product Name', `<input id="name" class="input" maxlength="160" value="${esc(p?.name)}">`, { id: 'name', required: true, cls: 'span-2' })}
        ${field('SKU', `<input id="sku" class="input" maxlength="64" value="${esc(p?.sku)}">`, { id: 'sku' })}
        ${field('Barcode', `<input id="barcode" class="input" maxlength="64" value="${esc(p?.barcode)}">`, { id: 'barcode', hint: 'Scan into this field with a barcode scanner.' })}
        ${field('Category', `<select id="category_id" class="input"><option value="">Uncategorized</option>${options(categories.map((c) => [c.id, c.name]), p?.category_id)}</select>`, { id: 'category_id' })}
        ${field('Minimum Stock', `<input id="minimum_stock" class="input" type="number" min="0" value="${esc(p?.minimum_stock ?? s.default_low_stock_threshold)}">`, { id: 'minimum_stock', hint: 'Low-stock alert threshold.' })}
        ${field('Cost Price (₱)', `<input id="cost_price" class="input" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(p?.cost_price ?? '')}">`, { id: 'cost_price' })}
        ${field('Selling Price (₱)', `<input id="selling_price" class="input" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(p?.selling_price ?? '')}">`, { id: 'selling_price', required: true })}
        ${p ? `<p class="alert alert-info small span-2">Current stock: <b>${p.stock_quantity}</b>. Change stock in <b>Stock / Inventory</b> so every change is recorded.</p>`
          : field('Initial Stock', '<input id="initial_stock" class="input" type="number" min="0" value="0">', { id: 'initial_stock', hint: 'Recorded as a Stock In movement.' })}
        ${field('Description', `<textarea id="description" class="input" maxlength="1000">${esc(p?.description)}</textarea>`, { id: 'description', cls: 'span-2' })}
        <div class="span-2">${imagePicker('pimg', 'Product Image', 'PNG, JPEG or WebP, up to 2 MB.')}</div>
      </form>`,
      footer: `<button class="btn btn-secondary" data-close>Cancel</button><button class="btn btn-primary" id="save">${p ? 'Save Changes' : 'Add Product'}</button>`,
    })
    const el = md.el
    const img = bindImagePicker(el, 'pimg', p?.image_url)
    el.querySelector('#pf').onsubmit = (e) => { e.preventDefault(); el.querySelector('#save').click() }
    el.querySelector('#save').onclick = async (e) => {
      const v = (id) => el.querySelector(`#${id}`)?.value.trim() ?? ''
      const money2 = /^\d+(\.\d{1,2})?$/
      const errs = {}
      if (!v('name')) errs.name = 'Product name is required.'
      if (!money2.test(v('selling_price'))) errs.selling_price = 'Enter a valid price (up to 2 decimals).'
      if (v('cost_price') && !money2.test(v('cost_price'))) errs.cost_price = 'Enter a valid cost (up to 2 decimals).'
      if (v('minimum_stock') && !/^\d+$/.test(v('minimum_stock'))) errs.minimum_stock = 'Whole number required.'
      if (!p && !/^\d+$/.test(v('initial_stock'))) errs.initial_stock = 'Whole number required.'
      if (!showErrors(el, errs)) return
      const btn = e.currentTarget
      setBusy(btn, true, 'Saving…')
      try {
        const data = { name: v('name'), sku: v('sku'), barcode: v('barcode'), category_id: v('category_id'), description: v('description'),
          cost_price: v('cost_price') || '0', selling_price: v('selling_price'), minimum_stock: v('minimum_stock') }
        if (img.file) data.image_url = await uploadImage('product-images', s.id, img.file)
        else if (img.removed) data.image_url = ''
        await rpc('save_product', { p_store_id: s.id, p_id: p?.id ?? null, p_data: data, p_initial_stock: p ? 0 : Number(v('initial_stock') || 0) })
        toast.success(p ? 'Product updated' : 'Product added')
        md.close()
        load(); loadCategories()
      } catch (err) { setBusy(btn, false); toast.error(err) }
    }
  }

  // -------------------------------------------------------------- categories
  function openCategories() {
    const md = openModal({ title: 'Categories', body: '' })
    let editing = null
    const draw = () => {
      md.setBody(`<form id="cf" class="row mb"><input class="input" id="cname" maxlength="80" placeholder="Category name" aria-label="Category name" value="${esc(editing?.name)}">
        <button class="btn btn-primary" type="submit">${editing ? 'Rename' : 'Add'}</button>${editing ? '<button type="button" class="btn btn-ghost" id="cancel">Cancel</button>' : ''}</form>
        ${categories.length ? `<div class="panel">${categories.map((c) => `<div class="row" style="padding:6px 12px;border-bottom:1px solid var(--border)">
          <span class="grow">${esc(c.name)}</span><span class="small muted">${c.product_count} products</span>
          <button class="icon-btn" data-ren="${c.id}" aria-label="Rename ${esc(c.name)}">${icon('edit')}</button>
          <button class="icon-btn danger" data-del="${c.id}" aria-label="Delete ${esc(c.name)}">${icon('trash')}</button></div>`).join('')}</div>` : emptyBlock('No categories yet')}`)
      const el = md.el
      el.querySelector('#cf').onsubmit = async (e) => {
        e.preventDefault()
        const name = el.querySelector('#cname').value.trim()
        if (!name) return
        try {
          await rpc('save_category', { p_store_id: s.id, p_id: editing?.id ?? null, p_name: name, p_description: editing?.description ?? null })
          toast.success(editing ? 'Category renamed' : 'Category added')
          editing = null
          await loadCategories(); draw(); load()
        } catch (err) { toast.error(err) }
      }
      el.querySelector('#cancel')?.addEventListener('click', () => { editing = null; draw() })
      el.querySelectorAll('[data-ren]').forEach((b) => { b.onclick = () => { editing = categories.find((c) => c.id === b.dataset.ren); draw(); el.querySelector('#cname').focus() } })
      el.querySelectorAll('[data-del]').forEach((b) => {
        const c = categories.find((x) => x.id === b.dataset.del)
        b.onclick = () => confirmDialog({ title: 'Delete category?', confirmLabel: 'Delete',
          message: `"${c.name}" will be deleted. Its ${c.product_count} products become uncategorized.`,
          onConfirm: async () => { await rpc('delete_category', { p_store_id: s.id, p_id: c.id }); toast.success('Category deleted'); await loadCategories(); draw(); load() } })
      })
    }
    draw()
  }

  // ------------------------------------------------------- import / export
  async function exportAll(btn) {
    setBusy(btn, true)
    try {
      const res = await rpc('list_products', { p_store_id: s.id, p_status: 'all', p_limit: 500 })
      downloadCsv(`products-${new Date().toISOString().slice(0, 10)}.csv`, [
        ['name', (r) => r.name], ['sku', (r) => r.sku], ['barcode', (r) => r.barcode], ['category', (r) => r.category_name],
        ['description', (r) => r.description], ['cost_price', (r) => Number(r.cost_price).toFixed(2)],
        ['selling_price', (r) => Number(r.selling_price).toFixed(2)], ['minimum_stock', (r) => r.minimum_stock],
        ['stock_quantity', (r) => r.stock_quantity], ['status', (r) => (r.is_active ? 'active' : 'archived')],
      ], res.rows)
    } catch (err) { toast.error(err) } finally { setBusy(btn, false) }
  }

  async function importFile(file) {
    const rows = parseCsv(await file.text())
    if (rows.length < 2) return toast.error('The file has no product rows.')
    const header = rows[0].map((h) => h.trim().toLowerCase())
    if (!header.includes('name') || !header.includes('selling_price')) return toast.error('The file must have "name" and "selling_price" columns. Download the template.')
    const get = (r, k) => (header.indexOf(k) >= 0 ? (r[header.indexOf(k)] ?? '').trim() : '')
    const md = openModal({ title: 'Importing products', size: 'sm', dismissible: false, body: '<p id="prog">Starting…</p>' })
    const catByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]))
    let created = 0, updated = 0
    const failures = []
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i]
      md.el.querySelector('#prog').textContent = `Row ${i} of ${rows.length - 1}…`
      try {
        let catId = ''
        const cat = get(r, 'category')
        if (cat) {
          if (!catByName.has(cat.toLowerCase())) catByName.set(cat.toLowerCase(), await rpc('save_category', { p_store_id: s.id, p_id: null, p_name: cat }))
          catId = catByName.get(cat.toLowerCase())
        }
        const data = { name: get(r, 'name'), sku: get(r, 'sku'), barcode: get(r, 'barcode'), category_id: catId, description: get(r, 'description'),
          cost_price: get(r, 'cost_price') || '0', selling_price: get(r, 'selling_price'), minimum_stock: get(r, 'minimum_stock') }
        if (!/^\d+(\.\d{1,2})?$/.test(data.selling_price)) throw new Error('invalid selling_price')
        let existing = null
        if (data.sku) existing = await rpc('lookup_product', { p_store_id: s.id, p_code: data.sku }).catch(() => null)
        if (existing && existing.sku?.toLowerCase() === data.sku.toLowerCase()) {
          await rpc('save_product', { p_store_id: s.id, p_id: existing.id, p_data: data, p_initial_stock: 0 })
          updated++
        } else {
          await rpc('save_product', { p_store_id: s.id, p_id: null, p_data: data, p_initial_stock: Number(get(r, 'initial_stock') || 0) })
          created++
        }
      } catch (err) { failures.push(`Row ${i + 1}: ${err.message}`) }
    }
    md.setBody(`<p>${created} created, ${updated} updated${failures.length ? `, ${failures.length} failed` : ''}.</p>
      ${failures.length ? `<ul class="small text-red mt-sm">${failures.slice(0, 20).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      <p class="small muted mt-sm">Existing products (matched by SKU) are updated; stock levels are only changed through Stock / Inventory.</p>
      <button class="btn btn-primary mt" data-close>Done</button>`)
    md.el.querySelector('[data-close]').onclick = md.close
    loadCategories(); load()
  }

  // -------------------------------------------------------------- events
  const reload = debounce(() => { f.page = 1; load() }, 300)
  main.querySelector('#q').oninput = (e) => { f.search = e.target.value.trim(); reload() }
  for (const id of ['cat', 'stock', 'status', 'sort']) {
    const el = main.querySelector(`#${id}`)
    if (el) el.onchange = () => { f[id === 'cat' ? 'category' : id] = el.value; f.page = 1; load() }
  }
  if (manage) {
    main.querySelector('#add').onclick = () => openForm()
    main.querySelector('#cats').onclick = openCategories
    main.querySelector('#exp').onclick = (e) => exportAll(e.currentTarget)
    main.querySelector('#tpl').onclick = () => downloadCsv('product-import-template.csv', TEMPLATE_COLUMNS.map((c) => [c, (r) => r[c]]), [
      { name: 'Bottled Water 500ml', sku: 'WATER-500', barcode: '4800001234567', category: 'Beverages', description: '', cost_price: '12.00', selling_price: '20.00', minimum_stock: '10', initial_stock: '48' },
    ])
    const fileInput = main.querySelector('#imp-file')
    main.querySelector('#imp').onclick = () => fileInput.click()
    fileInput.onchange = () => { const file = fileInput.files[0]; fileInput.value = ''; if (file) importFile(file) }
  }
  await loadCategories()
  await load()
}
