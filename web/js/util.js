// Shared helpers: HTML escaping, formatting, icons, toasts, modals, CSV.
import { isNativeApp, nativeShareFile } from './native.js'

/** Escape any value for safe insertion into HTML (always use for user data). */
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
export const $ = (sel, root = document) => root.querySelector(sel)
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]

// ------------------------------------------------------------------ icons
// Paths from Lucide (ISC license).
const ICONS = {
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  bluetooth: '<path d="m7 7 10 10-5 5V2l5 5L7 17"/>',
  bag: '<path d="M6 7h12l1.2 12.2A2 2 0 0 1 17.2 21H6.8a2 2 0 0 1-2-1.8L6 7Z"/><path d="M9 7V6a3 3 0 0 1 6 0v1"/><path d="M12 18c-2-1-3-3-2.2-5.2C10.5 11 12 10 14 10c.3 2.2-.5 4.6-2 5.5"/><path d="M12 18v-3"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  cash: '<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
  card: '<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>',
  phone: '<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>',
  sheet: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M8 13h2"/><path d="M14 13h2"/><path d="M8 17h2"/><path d="M14 17h2"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  trend: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  cart: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
  package: '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><path d="m3.3 7 8.7 5 8.7-5"/>',
  boxes: '<path d="M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z"/><path d="m7 16.5-4.74-2.85"/><path d="m7 16.5 5-3"/><path d="M7 16.5v5.17"/><path d="M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z"/><path d="m17 16.5-5-3"/><path d="m17 16.5 4.74-2.85"/><path d="M17 16.5v5.17"/><path d="M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z"/><path d="M12 8 7.26 5.15"/><path d="m12 8 4.74-2.85"/><path d="M12 13.5V8"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  store: '<path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"/><path d="M2 7h20"/><path d="M22 7v3a2 2 0 0 1-2 2a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12a2 2 0 0 1-2-2V7"/>',
  menu: '<line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
  user: '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M8 7v10"/><path d="M12 7v10"/><path d="M17 7v10"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  edit: '<path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/><path d="m15 5 4 4"/>',
  archive: '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  restore: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  eye: '<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/>',
  power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>',
  printer: '<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"/><rect x="6" y="14" width="12" height="8" rx="1"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  alert: '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  warning: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  in: '<path d="M12 17V3"/><path d="m6 11 6 6 6-6"/><path d="M19 21H5"/>',
  out: '<path d="m18 9-6-6-6 6"/><path d="M12 3v14"/><path d="M5 21h14"/>',
  clipboard: '<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  tags: '<path d="m15 5 6.3 6.3a2.4 2.4 0 0 1 0 3.4L17 19"/><path d="M9.59 5.59A2 2 0 0 0 8.17 5H3a1 1 0 0 0-1 1v5.17a2 2 0 0 0 .59 1.42l6.12 6.12a2.42 2.42 0 0 0 3.42 0l3.58-3.58a2.42 2.42 0 0 0 0-3.42z"/><circle cx="6.5" cy="9.5" r=".5" fill="currentColor"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/>',
}
export function icon(name, cls = '') {
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`
}

// --------------------------------------------------------------- formatting
const moneyFmt = new Map()
export function money(v, currency = 'PHP') {
  if (!moneyFmt.has(currency)) moneyFmt.set(currency, new Intl.NumberFormat('en-PH', { style: 'currency', currency, minimumFractionDigits: 2 }))
  return moneyFmt.get(currency).format(Number(v) || 0)
}
export const num = (v) => new Intl.NumberFormat('en-PH').format(Number(v) || 0)
export const toCents = (v) => Math.round((Number(v) || 0) * 100)
export const fromCents = (c) => c / 100

function dateParts(date, tz, opts) {
  const isDay = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
  const d = isDay ? new Date(`${date}T00:00:00Z`) : new Date(date)
  const p = {}
  for (const { type, value } of new Intl.DateTimeFormat('en-US', { timeZone: isDay ? 'UTC' : (tz || 'Asia/Manila'), ...opts }).formatToParts(d)) p[type] = value
  return p
}
export function fmtDate(date, store) {
  if (!date) return ''
  const p = dateParts(date, store?.timezone, { year: 'numeric', month: '2-digit', day: '2-digit' })
  if (store?.date_format === 'MM/DD/YYYY') return `${p.month}/${p.day}/${p.year}`
  if (store?.date_format === 'YYYY-MM-DD') return `${p.year}-${p.month}-${p.day}`
  return `${p.day}/${p.month}/${p.year}`
}
export function fmtTime(date, store) {
  if (!date) return ''
  const p = dateParts(date, store?.timezone, { hour: 'numeric', minute: '2-digit', hour12: true })
  return `${p.hour}:${p.minute} ${p.dayPeriod}`
}
export const fmtDateTime = (d, s) => (d ? `${fmtDate(d, s)} ${fmtTime(d, s)}` : '')
export const todayIn = (tz = 'Asia/Manila') => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())
export function addDays(iso, n) { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
export function rangeFor(preset, tz) {
  const t = todayIn(tz)
  if (preset === '7d') return { from: addDays(t, -6), to: t }
  if (preset === '30d') return { from: addDays(t, -29), to: t }
  if (preset === 'month') return { from: `${t.slice(0, 8)}01`, to: t }
  return { from: t, to: t }
}

export const PAYMENT = { cash: 'Cash', gcash: 'GCash', maya: 'Maya', other: 'Other', bank_transfer: 'Bank transfer' }
export const BUSINESS_TYPES = [['retail', 'Retail Store'], ['grocery', 'Grocery Store'], ['convenience', 'Convenience Store'],
  ['restaurant', 'Restaurant'], ['school_canteen', 'School Canteen'], ['pharmacy', 'Pharmacy'], ['other', 'Other']]
export const EXPENSE_CATS = [['rent', 'Rent'], ['utilities', 'Utilities'], ['supplies', 'Supplies'], ['salaries', 'Salaries'],
  ['transportation', 'Transportation'], ['maintenance', 'Maintenance'], ['other', 'Other']]
export const MOVEMENTS = { stock_in: 'Stock In', stock_out: 'Stock Out', sale: 'Sale', return: 'Return', adjustment: 'Adjustment' }
export const TIMEZONES = ['Asia/Manila', 'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Tokyo', 'Asia/Dubai', 'Asia/Jakarta',
  'Asia/Kuala_Lumpur', 'Asia/Bangkok', 'Australia/Sydney', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'UTC']
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
export function passwordProblems(pw) {
  const p = []
  if (pw.length < 8) p.push('at least 8 characters')
  if (!/[a-z]/.test(pw)) p.push('a lowercase letter')
  if (!/[A-Z]/.test(pw)) p.push('an uppercase letter')
  if (!/[0-9]/.test(pw)) p.push('a number')
  return p
}
export function newRequestId() {
  if (crypto.randomUUID) return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
export function debounce(fn, ms = 300) {
  let t
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms) }
}

// ------------------------------------------------------------- HTML pieces
export const options = (list, selected) => list.map(([v, t]) => `<option value="${esc(v)}"${String(v) === String(selected ?? '') ? ' selected' : ''}>${esc(t)}</option>`).join('')
export const badge = (text, tone = '') => `<span class="badge ${tone ? `badge-${tone}` : ''}">${esc(text)}</span>`
export const spinnerBlock = (t = 'Loading…') => `<div class="center-load"><span class="spinner"></span> ${esc(t)}</div>`
export const emptyBlock = (title, msg = '', action = '') => `<div class="empty"><p class="t">${esc(title)}</p>${msg ? `<p class="small mt-sm">${esc(msg)}</p>` : ''}${action ? `<div class="mt">${action}</div>` : ''}</div>`
export const errorBlock = (err) => `<div class="empty"><p class="text-red">${esc(err?.message || 'Failed to load data.')}</p><button class="btn btn-secondary btn-sm mt" data-retry>Try again</button></div>`
export function field(label, inputHtml, { hint = '', required = false, id = '', cls = '' } = {}) {
  return `<div class="${cls}">${label ? `<label class="label" ${id ? `for="${id}"` : ''}>${esc(label)}${required ? ' <span class="req">*</span>' : ''}</label>` : ''}${inputHtml}<p class="hint" data-hint-for="${id}">${esc(hint)}</p></div>`
}
export function pager(total, page, size) {
  if (!total) return ''
  const pages = Math.max(1, Math.ceil(total / size))
  return `<div class="pager"><span>${(page - 1) * size + 1}–${Math.min(total, page * size)} of ${total}</span>
    <span class="row"><button class="icon-btn" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''} aria-label="Previous page">${icon('left')}</button>
    <span>Page ${page} of ${pages}</span>
    <button class="icon-btn" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''} aria-label="Next page">${icon('right')}</button></span></div>`
}
export function stat(k, v, s = '', tone = '') {
  return `<div class="stat"><p class="k truncate">${esc(k)}</p><p class="v truncate ${tone ? `text-${tone}` : ''}">${esc(v)}</p>${s ? `<p class="s truncate">${esc(s)}</p>` : ''}</div>`
}

/** Shows/clears validation messages on inputs by id. */
export function showErrors(root, errors) {
  $$('.input.invalid', root).forEach((el) => el.classList.remove('invalid'))
  $$('.field-error', root).forEach((el) => el.remove())
  for (const [id, msg] of Object.entries(errors)) {
    const el = root.querySelector(`#${id}`)
    if (!el) continue
    el.classList.add('invalid')
    el.setAttribute('aria-invalid', 'true')
    const p = document.createElement('p')
    p.className = 'field-error'
    p.textContent = msg
    ;(el.closest('.with-icon, .pw-wrap') || el).insertAdjacentElement('afterend', p)
  }
  return Object.keys(errors).length === 0
}

export function setBusy(btn, busy, label) {
  if (!btn) return
  if (busy) {
    btn.dataset.label = btn.innerHTML
    btn.disabled = true
    btn.innerHTML = `<span class="spinner"></span>${label ? ` ${esc(label)}` : ''}`
  } else {
    btn.disabled = false
    if (btn.dataset.label) btn.innerHTML = btn.dataset.label
  }
}

export function passwordInput(id, autocomplete = 'current-password') {
  return `<div class="pw-wrap"><input id="${id}" type="password" class="input" autocomplete="${autocomplete}">
    <button type="button" class="pw-toggle" data-toggle-pw="${id}" aria-label="Show password">${icon('eye')}</button></div>`
}
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-toggle-pw]')
  if (!btn) return
  const input = document.getElementById(btn.dataset.togglePw)
  const show = input.type === 'password'
  input.type = show ? 'text' : 'password'
  btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password')
  btn.innerHTML = icon(show ? 'eyeOff' : 'eye')
})

// ------------------------------------------------------------------ toasts
export const toast = {
  show(type, msg) {
    const box = document.getElementById('toasts')
    const el = document.createElement('div')
    el.className = `toast ${type}`
    el.setAttribute('role', type === 'error' ? 'alert' : 'status')
    el.innerHTML = `${icon(type === 'success' ? 'checkCircle' : type === 'error' ? 'alert' : 'info')}<p>${esc(msg?.message || msg)}</p><button class="icon-btn" aria-label="Dismiss">${icon('x')}</button>`
    el.querySelector('button').onclick = () => el.remove()
    box.appendChild(el)
    while (box.children.length > 4) box.firstChild.remove()
    setTimeout(() => el.remove(), type === 'error' ? 6000 : 3500)
  },
  success(m) { this.show('success', m) },
  error(m) { this.show('error', m) },
  info(m) { this.show('info', m) },
}

// ------------------------------------------------------------------ modals
/**
 * Opens a modal. Returns { el, close }. `onClose` runs once when closed.
 */
export function openModal({ title, body = '', footer = '', size = '', dismissible = true, onClose }) {
  const root = document.getElementById('modal-root')
  const wrap = document.createElement('div')
  wrap.className = 'modal-backdrop'
  wrap.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head"><h2>${esc(title)}</h2>${dismissible ? `<button class="icon-btn" data-close aria-label="Close">${icon('x')}</button>` : ''}</div>
    <div class="modal-body">${body}</div><div class="modal-foot" ${footer ? '' : 'hidden'}>${footer}</div></div>`
  const prevFocus = document.activeElement
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    wrap.remove()
    document.removeEventListener('keydown', onKey)
    if (!root.children.length) document.body.style.overflow = ''
    prevFocus?.focus?.()
    onClose?.()
  }
  const onKey = (e) => { if (e.key === 'Escape' && dismissible && root.lastElementChild === wrap) close() }
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap && dismissible) close()
    if (e.target.closest('[data-close]')) close()
  })
  document.addEventListener('keydown', onKey)
  root.appendChild(wrap)
  document.body.style.overflow = 'hidden'
  setTimeout(() => {
    if (wrap.contains(document.activeElement)) return // never steal focus from a field the user already chose
    wrap.querySelector('.modal-body input:not([type=hidden]):not([disabled]), .modal-body select, .modal-body textarea')?.focus()
  }, 30)
  const el = wrap.querySelector('.modal')
  return { el, close, setBody(html) { el.querySelector('.modal-body').innerHTML = html }, setFooter(html) { const f = el.querySelector('.modal-foot'); f.innerHTML = html; f.hidden = !html } }
}

/** Confirmation dialog. `onConfirm` may be async; the dialog closes on success. */
export function confirmDialog({ title, message, confirmLabel = 'Confirm', tone = 'danger', extra = '', onConfirm }) {
  const m = openModal({
    title, size: 'sm',
    body: `<p class="muted">${esc(message)}</p>${extra}`,
    footer: `<button class="btn btn-secondary" data-close>Cancel</button><button class="btn btn-${tone}" data-ok>${esc(confirmLabel)}</button>`,
  })
  m.el.querySelector('[data-ok]').onclick = async (e) => {
    setBusy(e.currentTarget, true)
    try { if ((await onConfirm(m.el)) !== false) m.close() } catch (err) { toast.error(err) } finally { setBusy(e.currentTarget, false) }
  }
  return m
}

// --------------------------------------------------------------------- CSV
function csvCell(v) {
  if (v === null || v === undefined) return ''
  let s = String(v)
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}` // prevent spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
export function downloadCsv(filename, columns, rows) {
  const lines = [columns.map((c) => csvCell(c[0])).join(','), ...rows.map((r) => columns.map((c) => csvCell(c[1](r))).join(','))]
  const content = '\uFEFF' + lines.join('\r\n') + '\r\n'
  if (isNativeApp()) {
    // Android app: hand the file to the share sheet (save to Files/Drive, email…)
    nativeShareFile(filename, new TextEncoder().encode(content), 'text/csv').catch((err) => toast.error(err))
    return
  }
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

/** Image picker: returns HTML; call bindImagePicker(root, id, initialUrl) after render. */
export function imagePicker(id, label, hint) {
  return `<div><span class="label">${esc(label)}</span><div class="image-picker">
    <div class="thumb" id="${id}-thumb">${icon('image', 'icon-lg')}</div>
    <div class="row-wrap"><button type="button" class="btn btn-secondary btn-sm" id="${id}-pick">Upload image</button>
    <button type="button" class="btn btn-ghost btn-sm" id="${id}-remove" hidden>${icon('trash')} Remove</button></div>
    <input type="file" id="${id}" accept="image/png,image/jpeg,image/webp" hidden></div><p class="hint">${esc(hint)}</p></div>`
}
export function bindImagePicker(root, id, initialUrl) {
  const state = { file: null, removed: false, url: initialUrl || null }
  const input = root.querySelector(`#${id}`)
  const thumb = root.querySelector(`#${id}-thumb`)
  const removeBtn = root.querySelector(`#${id}-remove`)
  const pickBtn = root.querySelector(`#${id}-pick`)
  const show = (src) => {
    thumb.innerHTML = src ? `<img src="${esc(src)}" alt="">` : icon('image', 'icon-lg')
    removeBtn.hidden = !src
    pickBtn.textContent = src ? 'Change image' : 'Upload image'
  }
  show(state.url)
  pickBtn.onclick = () => input.click()
  input.onchange = () => {
    const f = input.files[0]
    if (!f) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) return toast.error('Image must be PNG, JPEG or WebP.')
    if (f.size > 2 * 1024 * 1024) return toast.error('Image must be 2 MB or smaller.')
    state.file = f
    state.removed = false
    show(URL.createObjectURL(f))
  }
  removeBtn.onclick = () => { state.file = null; state.removed = true; input.value = ''; show(null) }
  return state
}
