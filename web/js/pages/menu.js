// Today's Menu: pick the products available on a day and share one public link
// (Messenger, Facebook, any chat). The link always shows TODAY's menu.
import { rpc } from '../api.js'
import { store } from '../session.js'
import { pageHead } from '../layout.js'
import { PUBLIC_APP_URL } from '../config.js'
import { isNativeApp } from '../native.js'
import {
  esc, icon, money, debounce, toast, setBusy, options, spinnerBlock, emptyBlock, errorBlock,
  fmtDate, fmtDateTime, addDays, confirmDialog,
} from '../util.js'

function publicBase() {
  if (isNativeApp() || !/^https?:$/.test(location.protocol)) return PUBLIC_APP_URL
  return new URL('.', location.href.split('#')[0]).href
}
export const menuUrl = (token, date) => {
  const u = new URL('menu.html', publicBase())
  u.searchParams.set('s', token)
  if (date) u.searchParams.set('d', date)
  return u.href
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true } catch { /* fall back below */ }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.cssText = 'position:fixed;opacity:0'
  document.body.appendChild(ta)
  ta.select()
  let ok = false
  try { ok = document.execCommand('copy') } catch { /* ignore */ }
  ta.remove()
  return ok
}

export async function render(main) {
  const s = store()
  const m = (v) => money(v, s.currency)
  const st = {
    products: [], categories: [], menu: null, date: null, today: null,
    selected: [], note: '', markSoldOut: true, dirty: false,
    search: '', category: '', view: 'all',
  }

  main.innerHTML = spinnerBlock()
  try {
    const [cats, first] = await Promise.all([rpc('list_categories', { p_store_id: s.id }), loadAllProducts()])
    st.categories = cats
    st.products = first
    await loadMenu(null)
  } catch (err) {
    main.innerHTML = errorBlock(err)
    main.querySelector('[data-retry]').onclick = () => render(main)
    return
  }

  async function loadAllProducts() {
    const rows = []
    for (let off = 0; ; off += 500) {
      const res = await rpc('list_products', { p_store_id: s.id, p_status: 'active', p_sort: 'name', p_limit: 500, p_offset: off })
      rows.push(...res.rows)
      if (rows.length >= res.total || !res.rows.length) return rows
    }
  }

  async function loadMenu(date) {
    const menu = await rpc('get_menu', { p_store_id: s.id, p_date: date })
    st.menu = menu
    st.date = menu.date
    st.today = menu.today
    st.selected = menu.product_ids.filter((id) => st.products.some((p) => p.id === id))
    st.note = menu.note || ''
    st.markSoldOut = menu.mark_sold_out
    st.dirty = false
    frame()
  }

  function isToday() { return st.date === st.today }
  function link() { return menuUrl(st.menu.token, isToday() ? null : st.date) }
  function dayLabel() { return isToday() ? 'today' : st.date === addDays(st.today, 1) ? 'tomorrow' : `on ${fmtDate(st.date, s)}` }
  function chosen() { return st.selected.map((id) => st.products.find((p) => p.id === id)).filter(Boolean) }

  function shareText() {
    const head = isToday() ? `Available today at ${s.store_name}` : `Menu for ${fmtDate(st.date, s)} at ${s.store_name}`
    const lines = chosen().map((p) => `• ${p.name} — ${m(p.selling_price)}`)
    return [head, '', ...lines, ...(st.note.trim() ? ['', st.note.trim()] : []), '', `See the menu: ${link()}`].join('\n')
  }

  function frame() {
    main.innerHTML = `${pageHead("Today's Menu", 'Pick what is available, save, then share the link on Messenger, Facebook or any chat.')}
      <div class="split">
        <section class="panel">
          <div class="panel-head"><h2>Products available ${esc(dayLabel())}</h2><span class="badge badge-blue" id="count"></span></div>
          <div class="toolbar">
            <div class="search">${icon('search')}<input class="input" id="q" placeholder="Search product" value="${esc(st.search)}" aria-label="Search product"></div>
            <select class="input input-auto" id="cat" aria-label="Category"><option value="">All categories</option>${options(st.categories.map((c) => [c.id, c.name]), st.category)}</select>
            <div class="seg" role="group" aria-label="Show">
              <button data-view="all" aria-pressed="${st.view === 'all'}">All</button><button data-view="sel" aria-pressed="${st.view === 'sel'}">On menu</button></div>
          </div>
          <div class="row-wrap" style="padding:8px 12px;border-bottom:1px solid var(--border)">
            <button class="btn btn-ghost btn-sm" id="all">${icon('check')} Select shown</button>
            <button class="btn btn-ghost btn-sm" id="none">${icon('x')} Clear shown</button>
            ${isToday() ? '' : '<button class="btn btn-ghost btn-sm" id="copy-today">Copy today\'s list</button>'}
          </div>
          <div id="grid"></div>
          <div class="menu-savebar"><span class="grow small" id="bar-info"></span><button class="btn btn-primary btn-sm" id="save2">${icon('check')} Save menu</button></div>
        </section>
        <div class="stack">
          <section class="panel"><div class="panel-head"><h2>Day</h2></div><div class="panel-body stack">
            <div class="row-wrap">
              <input type="date" class="input input-auto" id="date" value="${st.date}" aria-label="Menu date">
              <div class="seg" role="group" aria-label="Quick date">
                <button data-day="${st.today}" aria-pressed="${isToday()}">Today</button>
                <button data-day="${addDays(st.today, 1)}" aria-pressed="${st.date === addDays(st.today, 1)}">Tomorrow</button></div>
            </div>
            <div><label class="label" for="note">Note for customers (optional)</label>
              <textarea id="note" class="input" maxlength="500" placeholder="e.g. Order before 11 AM · Free delivery within the barangay">${esc(st.note)}</textarea></div>
            <label class="check"><input type="checkbox" id="soldout" ${st.markSoldOut ? 'checked' : ''}>
              <span>Show "Sold out" when stock reaches 0<span class="hint" style="display:block">Turn off if you do not track stock for these items.</span></span></label>
            <button class="btn btn-primary btn-block" id="save">${icon('check')} Save menu</button>
            <p class="small muted" id="saved-info"></p>
          </div></section>
          <section class="panel"><div class="panel-head"><h2>${icon('share')} Share</h2></div><div class="panel-body stack">
            <p class="small muted">${isToday()
              ? 'This link always shows <b>today\'s</b> menu, so you can post it once and keep using it.'
              : `This link shows the menu for <b>${esc(fmtDate(st.date, s))}</b>. The everyday link always shows today's menu.`}</p>
            <div class="row"><input class="input" id="link" readonly value="${esc(link())}" aria-label="Menu link">
              <button class="btn btn-secondary" id="copy" title="Copy link">${icon('copy')}<span class="hide-sm">Copy</span></button></div>
            <div class="grid-2">
              <button class="btn btn-primary" id="share">${icon('share')} Share…</button>
              <button class="btn btn-secondary" id="messenger">${icon('message')} Messenger</button>
              <button class="btn btn-secondary" id="facebook">${icon('external')} Post on Facebook</button>
              <button class="btn btn-secondary" id="copy-text">${icon('clipboard')} Copy menu as text</button>
            </div>
            <div class="row between"><a class="small" id="open" href="${esc(link())}" target="_blank" rel="noopener">${icon('eye')} Preview what customers see</a>
              <button class="link-btn danger small" id="reset">Reset link</button></div>
          </div></section>
        </div>
      </div>`
    bind()
    drawGrid()
    drawSaved()
  }

  function visible() {
    const q = st.search.toLowerCase()
    return st.products.filter((p) => (!q || p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q))
      && (!st.category || p.category_id === st.category)
      && (st.view === 'all' || st.selected.includes(p.id)))
  }

  function drawGrid() {
    const box = main.querySelector('#grid')
    main.querySelector('#count').textContent = `${st.selected.length} on menu`
    if (!st.products.length) { box.innerHTML = emptyBlock('No products yet', 'Add products first, then choose which ones are on the menu.', '<a class="btn btn-primary btn-sm" href="#/products">Go to Products</a>'); return }
    const list = visible()
    if (!list.length) { box.innerHTML = emptyBlock(st.view === 'sel' ? 'Nothing on the menu yet' : 'No products match'); return }
    box.innerHTML = `<div class="pgrid">${list.map((p) => {
      const on = st.selected.includes(p.id)
      return `<button type="button" class="pcard menu-pick ${on ? 'on' : ''}" data-id="${p.id}" aria-pressed="${on}">
        <span class="tick" aria-hidden="true">${icon('check')}</span>
        <span class="pimg">${p.image_url ? `<img src="${esc(p.image_url)}" alt="" loading="lazy">` : icon('package')}</span>
        <span class="nm">${esc(p.name)}</span><span class="pr">${m(p.selling_price)}</span>
        <span class="st ${p.stock_quantity <= 0 ? 'text-red' : ''}">${p.stock_quantity <= 0 ? 'Out of stock' : `${p.stock_quantity} in stock`}</span></button>`
    }).join('')}</div>`
    box.querySelectorAll('[data-id]').forEach((b) => {
      b.onclick = () => {
        const id = b.dataset.id
        st.selected = st.selected.includes(id) ? st.selected.filter((x) => x !== id) : [...st.selected, id]
        markDirty()
        const on = st.selected.includes(id)
        b.classList.toggle('on', on)
        b.setAttribute('aria-pressed', on)
        main.querySelector('#count').textContent = `${st.selected.length} on menu`
        drawBar()
        if (st.view === 'sel' && !on) drawGrid()
      }
    })
  }

  function drawSaved() {
    drawBar()
    const el = main.querySelector('#saved-info')
    if (st.dirty) { el.innerHTML = '<span class="text-amber">Unsaved changes — customers will not see them until you save.</span>'; return }
    el.textContent = st.menu.saved
      ? `Saved ${fmtDateTime(st.menu.updated_at, s)}${st.menu.updated_by_name ? ` by ${st.menu.updated_by_name}` : ''}.`
      : `No menu saved for ${dayLabel()} yet.`
  }

  function markDirty() { st.dirty = true; drawSaved() }
  function drawBar() {
    const el = main.querySelector('#bar-info')
    if (el) el.innerHTML = `<b>${st.selected.length}</b> on menu${st.dirty ? ' · <span class="text-amber">not saved</span>' : ''}`
  }

  async function save(btn) {
    setBusy(btn, true)
    try {
      st.menu = await rpc('save_menu', { p_store_id: s.id, p_date: st.date, p_product_ids: st.selected, p_note: st.note, p_mark_sold_out: st.markSoldOut })
      st.dirty = false
      toast.success(`Menu saved: ${st.selected.length} product${st.selected.length === 1 ? '' : 's'} ${dayLabel()}.`)
      drawSaved()
      return true
    } catch (err) { toast.error(err); return false } finally { setBusy(btn, false) }
  }

  // Sharing should never send customers to a stale menu: save first.
  async function ensureSaved() {
    if (!st.selected.length) { toast.error('Choose at least one product first.'); return false }
    if (!st.dirty && st.menu.saved) return true
    return save(main.querySelector('#save'))
  }

  function changeDate(date) {
    if (!date || date === st.date) return
    const go = () => { main.innerHTML = spinnerBlock(); loadMenu(date).catch((err) => { toast.error(err); loadMenu(st.date) }) }
    if (!st.dirty) return go()
    confirmDialog({ title: 'Discard changes?', message: 'You have unsaved changes for this day.', confirmLabel: 'Discard', onConfirm: go })
    main.querySelector('#date').value = st.date
  }

  function bind() {
    const $ = (sel) => main.querySelector(sel)
    $('#q').oninput = debounce((e) => { st.search = e.target.value.trim(); drawGrid() }, 200)
    $('#cat').onchange = (e) => { st.category = e.target.value; drawGrid() }
    main.querySelectorAll('[data-view]').forEach((b) => { b.onclick = () => { st.view = b.dataset.view; main.querySelectorAll('[data-view]').forEach((x) => x.setAttribute('aria-pressed', x === b)); drawGrid() } })
    $('#all').onclick = () => { const ids = visible().map((p) => p.id); st.selected = [...st.selected, ...ids.filter((id) => !st.selected.includes(id))]; markDirty(); drawGrid() }
    $('#none').onclick = () => { const ids = new Set(visible().map((p) => p.id)); st.selected = st.selected.filter((id) => !ids.has(id)); markDirty(); drawGrid() }
    $('#copy-today')?.addEventListener('click', async () => {
      try {
        const t = await rpc('get_menu', { p_store_id: s.id, p_date: st.today })
        st.selected = t.product_ids.filter((id) => st.products.some((p) => p.id === id))
        if (!st.note) { st.note = t.note || ''; $('#note').value = st.note }
        markDirty(); drawGrid()
        toast.info(`Copied ${st.selected.length} products from today. Save to keep them.`)
      } catch (err) { toast.error(err) }
    })
    $('#date').onchange = (e) => changeDate(e.target.value)
    main.querySelectorAll('[data-day]').forEach((b) => { b.onclick = () => changeDate(b.dataset.day) })
    $('#note').oninput = (e) => { st.note = e.target.value; markDirty() }
    $('#soldout').onchange = (e) => { st.markSoldOut = e.target.checked; markDirty() }
    $('#save').onclick = (e) => save(e.currentTarget)
    $('#save2').onclick = (e) => save(e.currentTarget)

    $('#copy').onclick = async () => { if (await copyText(link())) toast.success('Link copied. Paste it in Messenger or any chat.'); else $('#link').select() }
    $('#link').onfocus = (e) => e.target.select()
    $('#copy-text').onclick = async () => {
      if (!(await ensureSaved())) return
      if (await copyText(shareText())) toast.success('Menu copied as text. Paste it in a chat or post.')
      else toast.error('Could not copy. Select the link and copy it manually.')
    }
    $('#share').onclick = async () => {
      if (!(await ensureSaved())) return
      const data = { title: `${s.store_name} — menu`, text: shareText().replace(/\n\nSee the menu: .*$/, ''), url: link() }
      if (navigator.share) {
        try { await navigator.share(data) } catch (err) { if (err?.name !== 'AbortError') toast.error('Sharing failed. Use Copy instead.') }
      } else if (await copyText(shareText())) toast.success('Sharing is not available in this browser — the menu was copied instead.')
    }
    $('#messenger').onclick = async () => {
      if (!(await ensureSaved())) return
      const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
      if (mobile) { location.href = `fb-messenger://share/?link=${encodeURIComponent(link())}`; return }
      await copyText(link())
      toast.info('Link copied — paste it in the Messenger chat that just opened.')
      window.open('https://www.messenger.com/', '_blank', 'noopener')
    }
    $('#facebook').onclick = async () => {
      if (!(await ensureSaved())) return
      window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link())}`, '_blank', 'noopener,width=640,height=560')
    }
    $('#reset').onclick = () => confirmDialog({
      title: 'Reset the menu link?',
      message: 'The current link stops working right away (also where you already posted it). You will need to share the new link.',
      confirmLabel: 'Reset link',
      onConfirm: async () => {
        st.menu.token = await rpc('reset_menu_link', { p_store_id: s.id })
        $('#link').value = link()
        $('#open').href = link()
        toast.success('New link created.')
      },
    })
  }

  const warn = (e) => { if (st.dirty) { e.preventDefault(); e.returnValue = '' } }
  window.addEventListener('beforeunload', warn)
  return () => window.removeEventListener('beforeunload', warn)
}
