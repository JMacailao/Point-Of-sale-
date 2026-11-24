const moneyFormatters = new Map()

export function formatMoney(value, currency = 'PHP') {
  if (!moneyFormatters.has(currency)) {
    moneyFormatters.set(currency, new Intl.NumberFormat('en-PH', { style: 'currency', currency, minimumFractionDigits: 2 }))
  }
  return moneyFormatters.get(currency).format(Number(value) || 0)
}

export function formatNumber(value) {
  return new Intl.NumberFormat('en-PH').format(Number(value) || 0)
}

function parts(date, timeZone, opts) {
  const d = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : new Date(date)
  const tz = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? 'UTC' : timeZone
  const p = {}
  for (const { type, value } of new Intl.DateTimeFormat('en-US', { timeZone: tz || 'Asia/Manila', ...opts }).formatToParts(d)) {
    p[type] = value
  }
  return p
}

/** Formats a date according to the store's date format (DD/MM/YYYY by default) and time zone. */
export function formatDate(date, store) {
  if (!date) return ''
  const p = parts(date, store?.timezone, { year: 'numeric', month: '2-digit', day: '2-digit' })
  switch (store?.date_format) {
    case 'MM/DD/YYYY': return `${p.month}/${p.day}/${p.year}`
    case 'YYYY-MM-DD': return `${p.year}-${p.month}-${p.day}`
    default: return `${p.day}/${p.month}/${p.year}`
  }
}

export function formatTime(date, store) {
  if (!date) return ''
  const p = parts(date, store?.timezone, { hour: 'numeric', minute: '2-digit', hour12: true })
  return `${p.hour}:${p.minute} ${p.dayPeriod}`
}

export function formatDateTime(date, store) {
  if (!date) return ''
  return `${formatDate(date, store)} ${formatTime(date, store)}`
}

/** YYYY-MM-DD for "today" in the store's time zone. */
export function todayIn(timeZone = 'Asia/Manila') {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date())
}

export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function startOfMonth(isoDate) {
  return `${isoDate.slice(0, 8)}01`
}

export const PAYMENT_LABELS = { cash: 'Cash', gcash: 'GCash', maya: 'Maya', other: 'Other', bank_transfer: 'Bank transfer' }
export const BUSINESS_TYPES = [
  ['retail', 'Retail Store'], ['grocery', 'Grocery Store'], ['convenience', 'Convenience Store'],
  ['restaurant', 'Restaurant'], ['school_canteen', 'School Canteen'], ['pharmacy', 'Pharmacy'], ['other', 'Other'],
]
export const EXPENSE_CATEGORIES = [
  ['rent', 'Rent'], ['utilities', 'Utilities'], ['supplies', 'Supplies'], ['salaries', 'Salaries'],
  ['transportation', 'Transportation'], ['maintenance', 'Maintenance'], ['other', 'Other'],
]
export const MOVEMENT_LABELS = { stock_in: 'Stock In', stock_out: 'Stock Out', sale: 'Sale', return: 'Return', adjustment: 'Adjustment' }
export const TIMEZONES = ['Asia/Manila', 'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Tokyo', 'Asia/Dubai', 'Asia/Jakarta',
  'Asia/Kuala_Lumpur', 'Asia/Bangkok', 'Australia/Sydney', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'UTC']

/** Money math in integer centavos, mirroring the server (which is authoritative). */
export const toCents = (v) => Math.round((Number(v) || 0) * 100)
export const fromCents = (c) => c / 100
