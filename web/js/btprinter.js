// Direct Bluetooth receipt printing (Web Bluetooth + ESC/POS).
// Works in Chrome / Edge on Android, Windows, macOS and ChromeOS over HTTPS, with
// Bluetooth Low Energy (BLE) thermal printers. Not available on iPhone/iPad or Firefox.
// Classic-Bluetooth-only printers do not appear in the list: print those through the
// system print dialog after pairing them in the operating system.
import { PAYMENT, fmtDate, fmtTime } from './util.js'

// GATT services used by common BLE ESC/POS thermal printers (must be declared up front).
const PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb', // generic BLE printers (PT-210, MTP-II, Goojprt, Xprinter…)
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // many ESC/POS printers
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // Microchip/ISSC transparent UART
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb', // HM-10 style modules
  '0000fee7-0000-1000-8000-00805f9b34fb',
  '0000ae30-0000-1000-8000-00805f9b34fb',
  '0000ae00-0000-1000-8000-00805f9b34fb',
  '00001101-0000-1000-8000-00805f9b34fb',
]

const state = { device: null, characteristic: null }
const store = {
  get saved() { try { return JSON.parse(localStorage.getItem('pos.btPrinter') || 'null') } catch { return null } },
  set saved(v) { try { v ? localStorage.setItem('pos.btPrinter', JSON.stringify(v)) : localStorage.removeItem('pos.btPrinter') } catch { /* ignore */ } },
}

export const bluetoothSupported = () => Boolean(navigator.bluetooth) && window.isSecureContext
export const savedPrinter = () => store.saved
export const isConnected = () => Boolean(state.device?.gatt?.connected && state.characteristic)

export function printMethod() {
  try { return localStorage.getItem('pos.printMethod') || 'dialog' } catch { return 'dialog' }
}
export function setPrintMethod(m) { try { localStorage.setItem('pos.printMethod', m) } catch { /* ignore */ } }

export class PrinterError extends Error {
  constructor(code, message) { super(message); this.code = code }
}

async function attach(device) {
  const server = await device.gatt.connect()
  let found = null
  for (const service of await server.getPrimaryServices()) {
    for (const c of await service.getCharacteristics()) {
      if (c.properties.writeWithoutResponse || c.properties.write) { found = c; break }
    }
    if (found) break
  }
  if (!found) {
    device.gatt.disconnect()
    throw new PrinterError('UNSUPPORTED', `"${device.name || 'This device'}" does not accept print data. Choose a Bluetooth thermal printer.`)
  }
  state.device = device
  state.characteristic = found
  device.addEventListener('gattserverdisconnected', () => { state.characteristic = null })
  store.saved = { id: device.id, name: device.name || 'Bluetooth printer' }
  return store.saved
}

/**
 * Shows the browser's list of nearby Bluetooth devices and connects to the chosen printer.
 * MUST be called directly from a click/tap handler.
 */
export async function choosePrinter() {
  if (!bluetoothSupported()) throw new PrinterError('UNSUPPORTED_BROWSER', 'This browser cannot connect to Bluetooth printers. Use Chrome or Edge on Android, Windows or Mac.')
  let device
  try {
    device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: PRINTER_SERVICES })
  } catch (err) {
    if (err.name === 'NotFoundError') throw new PrinterError('CANCELLED', 'No printer was selected.')
    throw new PrinterError('BLUETOOTH', err.message)
  }
  return attach(device)
}

/** Reconnects to the last printer without showing the list (when the browser allows it). */
export async function reconnect() {
  if (isConnected()) return true
  try {
    if (state.device) { await attach(state.device); return true }
    const saved = store.saved
    if (saved && navigator.bluetooth?.getDevices) {
      const device = (await navigator.bluetooth.getDevices()).find((d) => d.id === saved.id)
      if (device) { await attach(device); return true }
    }
  } catch { /* fall through */ }
  return false
}

export function forgetPrinter() {
  try { state.device?.gatt?.disconnect() } catch { /* ignore */ }
  state.device = null
  state.characteristic = null
  store.saved = null
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function sendBytes(bytes) {
  if (!isConnected() && !(await reconnect())) throw new PrinterError('NOT_CONNECTED', 'The Bluetooth printer is not connected.')
  const c = state.characteristic
  const chunk = 20 // works with the default BLE packet size on every printer
  for (let i = 0; i < bytes.length; i += chunk) {
    const part = bytes.slice(i, i + chunk)
    if (c.properties.writeWithoutResponse) { await c.writeValueWithoutResponse(part); await sleep(8) } else await c.writeValueWithResponse(part)
  }
}

// ------------------------------------------------------------------ ESC/POS
const ESC = 0x1b, GS = 0x1d

/** Thermal printers print plain ASCII reliably: strip accents, replace other characters. */
function ascii(text) {
  return String(text ?? '').replace(/₱/g, 'P').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e\n]/g, '?')
}
const amount = (v) => new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v) || 0)

/** Builds ESC/POS bytes for a receipt. width = characters per line (32 for 58mm, 48 for 80mm). */
export function receiptBytes(sale, s, paper = s?.receipt_paper || '58mm') {
  const width = paper === '80mm' ? 48 : 32
  const out = []
  const raw = (...b) => out.push(...b)
  const text = (t) => { for (const ch of ascii(t)) out.push(ch.charCodeAt(0)) }
  const line = (t = '') => { text(t); raw(0x0a) }
  // w = characters per line for the current text size (double-width text fits half as many).
  const lr = (l, r, w = width) => {
    l = ascii(l); r = ascii(r)
    if (l.length + r.length + 1 > w) { line(l); line(r.padStart(w)) } else line(l + ' '.repeat(w - l.length - r.length) + r)
  }
  const wrap = (t, w = width) => { let rest = ascii(t); while (rest.length > w) { line(rest.slice(0, w)); rest = rest.slice(w) } line(rest) }
  const rule = () => line('-'.repeat(width))
  const align = (n) => raw(ESC, 0x61, n)
  const bold = (on) => raw(ESC, 0x45, on ? 1 : 0)
  const size = (n) => raw(GS, 0x21, n)

  raw(ESC, 0x40) // initialise
  align(1); bold(true); size(0x11); wrap(s?.store_name || 'Receipt', width / 2); size(0); bold(false)
  if (s?.store_address) wrap(s.store_address)
  if (s?.contact_number) line(`Tel: ${s.contact_number}`)
  if (s?.tax_enabled) line(`${s.tax_name} ${s.tax_inclusive ? 'inclusive' : 'exclusive'}`)
  align(0); rule()
  lr('Txn #', sale.transaction_number)
  lr('Date', `${fmtDate(sale.created_at, s)} ${fmtTime(sale.created_at, s)}`)
  lr('Cashier', sale.cashier_name || '')
  if (sale.status === 'refunded') { align(1); bold(true); line('*** REFUNDED ***'); bold(false); align(0) }
  rule()
  for (const it of sale.items || []) {
    wrap(it.product_name)
    lr(`  ${it.quantity} x ${amount(it.unit_price)}`, amount(it.subtotal))
  }
  rule()
  lr('Subtotal', amount(sale.subtotal))
  if (Number(sale.discount) > 0) lr(`Discount${sale.discount_type === 'percent' ? ` (${Number(sale.discount_value)}%)` : ''}`, `-${amount(sale.discount)}`)
  if (Number(sale.tax_amount) > 0) lr(`${s?.tax_name || 'Tax'}${sale.tax_inclusive ? ' (incl.)' : ''}`, amount(sale.tax_amount))
  bold(true); size(0x10); lr('TOTAL', `P${amount(sale.total_amount)}`, width / 2); size(0); bold(false)
  rule()
  lr('Payment', PAYMENT[sale.payment_method] || sale.payment_method)
  const ref = (sale.payments || []).find((p) => p.kind === 'payment')?.reference_number
  if (ref) lr('Ref #', ref)
  lr('Amount received', amount(sale.amount_received))
  lr('Change', amount(sale.change_amount))
  rule()
  align(1)
  if (s?.receipt_footer) for (const l of String(s.receipt_footer).split('\n')) wrap(l)
  line('This serves as your sales receipt.')
  align(0)
  raw(ESC, 0x64, 4) // feed 4 lines
  raw(GS, 0x56, 0x42, 0x00) // partial cut (ignored by printers without a cutter)
  return new Uint8Array(out)
}

export async function printViaBluetooth(sale, s, paper) {
  await sendBytes(receiptBytes(sale, s, paper))
}
