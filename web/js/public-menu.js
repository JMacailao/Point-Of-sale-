// Public "available today" menu opened from a shared link: menu.html?s=<token>[&d=YYYY-MM-DD]
// No sign-in. Calls one public database function that returns only menu data.
import { API_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js'

const root = document.getElementById('menu')
const params = new URLSearchParams(location.search)
const token = (params.get('s') || '').trim()
const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('d') || '') ? params.get('d') : null

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const safeUrl = (u) => (/^https:\/\//i.test(u || '') ? u : '')

function money(v, currency) {
  try { return new Intl.NumberFormat('en-PH', { style: 'currency', currency: currency || 'PHP' }).format(Number(v) || 0) } catch { return String(v) }
}
function longDate(iso) {
  return new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`))
}
function timeOf(ts, tz) {
  try { return new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date(ts)) } catch { return '' }
}

function message(title, text) {
  root.innerHTML = `<div class="msg"><div class="msg-ic">🍽️</div><h1>${esc(title)}</h1><p>${esc(text)}</p></div>`
}

async function load() {
  if (!/^[a-f0-9]{32}$/i.test(token)) return message('Menu link not valid', 'Please ask the store for the correct link.')
  let res
  try {
    res = await fetch(`${API_URL}/rest/v1/rpc/get_public_menu`, {
      method: 'POST',
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ p_token: token, p_date: date }),
    })
  } catch {
    return message('Cannot load the menu', 'Check your internet connection and try again.')
  }
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    return /NOT_FOUND/.test(body?.message || '')
      ? message('Menu link not valid', 'This link was replaced or removed. Please ask the store for the new link.')
      : message('Cannot load the menu', 'Something went wrong. Please try again later.')
  }
  render(body)
}

function render(d) {
  const s = d.store
  const isToday = d.date === d.today
  document.title = `${s.name} — ${isToday ? 'available today' : `menu for ${longDate(d.date)}`}`
  const groups = new Map()
  for (const it of [...d.items].sort((a, b) => (a.category ? 0 : 1) - (b.category ? 0 : 1))) {
    const k = it.category || ''
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(it)
  }
  const showHeads = groups.size > 1 || (groups.size === 1 && !groups.has(''))
  const logo = safeUrl(s.logo_url)
  const phone = (s.contact_number || '').replace(/[^\d+]/g, '')

  root.innerHTML = `
    <header class="head">
      ${logo ? `<img class="logo" src="${esc(logo)}" alt="">` : '<div class="logo ph" aria-hidden="true">🍽️</div>'}
      <div class="grow"><h1>${esc(s.name)}</h1>
        <p class="when"><span class="dot" aria-hidden="true"></span>${isToday ? 'Available today' : 'Menu'} · ${esc(longDate(d.date))}</p></div>
    </header>
    ${d.note ? `<div class="note">${esc(d.note)}</div>` : ''}
    ${d.items.length ? [...groups].map(([cat, items]) => `
      <section>${showHeads ? `<h2>${esc(cat || 'Others')}</h2>` : ''}
        <ul class="items">${items.map((it) => `
          <li class="item ${it.sold_out ? 'out' : ''}">
            <div class="pic">${safeUrl(it.image_url) ? `<img src="${esc(safeUrl(it.image_url))}" alt="" loading="lazy">` : '<span aria-hidden="true">🍽️</span>'}</div>
            <div class="grow"><p class="nm">${esc(it.name)}</p>${it.description ? `<p class="ds">${esc(it.description)}</p>` : ''}
              <p class="pr">${esc(money(it.price, s.currency))}${it.sold_out ? ' <span class="so">Sold out</span>' : ''}</p></div>
          </li>`).join('')}</ul></section>`).join('')
      : `<div class="msg small"><h1>${isToday ? 'No menu posted yet today' : 'No menu for this day'}</h1><p>Please check again later.</p></div>`}
    <footer class="foot">
      ${phone ? `<a class="btn" href="tel:${esc(phone)}">📞 Call ${esc(s.contact_number)}</a>` : ''}
      ${s.address ? `<p>${esc(s.address)}</p>` : ''}
      ${d.updated_at ? `<p class="faint">Updated ${esc(timeOf(d.updated_at, s.timezone))}</p>` : ''}
    </footer>`
}

load()
