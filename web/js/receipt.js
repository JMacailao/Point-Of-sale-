import { esc, money, fmtDate, fmtTime, PAYMENT, openModal, toast, setBusy } from './util.js'
import { printMethod, printViaBluetooth, choosePrinter, savedPrinter } from './btprinter.js'

// Thermal rolls are continuous: the page height is set to the measured receipt height at print time.
const PAPER = {
  '58mm': { width: '48mm', font: '10px', paper: 58, mx: 5, my: 3 },
  '80mm': { width: '72mm', font: '11.5px', paper: 80, mx: 4, my: 3 },
  a4: { width: '90mm', font: '12px' },
}

/** Receipt HTML with inline styles so it renders identically on screen and in print. */
export function receiptHtml(sale, store, paper = store?.receipt_paper || '80mm') {
  const c = PAPER[paper] || PAPER['80mm']
  const m = (v) => money(v, store?.currency)
  const pay = (sale.payments || []).find((p) => p.kind === 'payment')
  const row = 'display:flex;justify-content:space-between;gap:8px'
  const hr = '<div style="border-top:1px dashed #000;margin:6px 0"></div>'
  const line = (a, b, extra = '') => `<div style="${row};${extra}"><span>${a}</span><span style="text-align:right">${b}</span></div>`
  return `<div style="width:${c.width};font-size:${c.font};line-height:1.35;color:#000;background:#fff;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace;margin:0 auto">
    <div style="text-align:center">
      ${store?.logo_url ? `<img src="${esc(store.logo_url)}" alt="" style="max-width:60%;max-height:18mm;margin:0 auto 4px;display:block;filter:grayscale(1)">` : ''}
      <div style="font-weight:700;font-size:1.15em">${esc(store?.store_name)}</div>
      ${store?.store_address ? `<div>${esc(store.store_address)}</div>` : ''}
      ${store?.contact_number ? `<div>Tel: ${esc(store.contact_number)}</div>` : ''}
      ${store?.tax_enabled ? `<div>${esc(store.tax_name)} ${store.tax_inclusive ? 'inclusive' : 'exclusive'}</div>` : ''}
    </div>${hr}
    ${line('Txn #', esc(sale.transaction_number))}
    ${line('Date', `${fmtDate(sale.created_at, store)} ${fmtTime(sale.created_at, store)}`)}
    ${line('Cashier', esc(sale.cashier_name))}
    ${sale.status === 'refunded' ? '<div style="text-align:center;font-weight:700;margin:4px 0">*** REFUNDED ***</div>' : ''}${hr}
    ${(sale.items || []).map((it) => `<div style="margin-bottom:3px"><div style="word-break:break-word">${esc(it.product_name)}</div>${line(`${it.quantity} x ${m(it.unit_price)}`, m(it.subtotal))}</div>`).join('')}${hr}
    ${line('Subtotal', m(sale.subtotal))}
    ${Number(sale.discount) > 0 ? line(`Discount${sale.discount_type === 'percent' ? ` (${Number(sale.discount_value)}%)` : ''}`, `-${m(sale.discount)}`) : ''}
    ${Number(sale.tax_amount) > 0 ? line(`${esc(store?.tax_name || 'Tax')}${sale.tax_inclusive ? ' (incl.)' : ''}`, m(sale.tax_amount)) : ''}
    ${line('TOTAL', m(sale.total_amount), 'font-weight:700;font-size:1.2em;margin-top:2px')}${hr}
    ${line('Payment', esc(PAYMENT[sale.payment_method]))}
    ${pay?.reference_number ? line('Ref #', esc(pay.reference_number)) : ''}
    ${line('Amount received', m(sale.amount_received))}
    ${line('Change', m(sale.change_amount))}${hr}
    ${store?.receipt_footer ? `<div style="text-align:center;white-space:pre-line">${esc(store.receipt_footer)}</div>` : ''}
    <div style="text-align:center;margin-top:4px;font-size:.9em">This serves as your sales receipt.</div>
  </div>`
}

/**
 * Prints a receipt with the method chosen in Settings > Printer & Scanner:
 *  - "bluetooth": straight to the connected Bluetooth thermal printer (ESC/POS)
 *  - "dialog":    the browser/system print dialog (USB, network, Android print services)
 */
export async function printReceipt(sale, store, paper) {
  if (printMethod() !== 'bluetooth') return printWithDialog(sale, store, paper)
  try {
    await printViaBluetooth(sale, store, paper || store?.receipt_paper)
    toast.success('Receipt sent to the Bluetooth printer')
  } catch (err) {
    const saved = savedPrinter()
    const md = openModal({
      title: 'Bluetooth printer', size: 'sm',
      body: `<p>${esc(err.code === 'NOT_CONNECTED' ? `${saved ? `"${saved.name}"` : 'The Bluetooth printer'} is not connected. Turn the printer on and keep it near this device.` : err.message)}</p>`,
      footer: '<button class="btn btn-secondary" id="use-dialog">Use print dialog</button><button class="btn btn-primary" id="connect">Connect printer</button>',
    })
    md.el.querySelector('#use-dialog').onclick = () => { md.close(); printWithDialog(sale, store, paper) }
    md.el.querySelector('#connect').onclick = async (e) => {
      const btn = e.currentTarget
      try {
        const p = choosePrinter() // opens the browser's list of nearby Bluetooth devices
        setBusy(btn, true, 'Connecting…')
        await p
        await printViaBluetooth(sale, store, paper || store?.receipt_paper)
        md.close()
        toast.success('Receipt sent to the Bluetooth printer')
      } catch (e2) { setBusy(btn, false); if (e2.code !== 'CANCELLED') toast.error(e2) }
    }
  }
}

/** Browser print dialog (any printer installed on the device). */
export async function printWithDialog(sale, store, paper) {
  const size = paper || store?.receipt_paper || '80mm'
  const c = PAPER[size] || PAPER['80mm']
  const root = document.getElementById('print-root')
  root.innerHTML = receiptHtml(sale, store, size)
  await Promise.all([...root.querySelectorAll('img')].map((img) => (img.complete ? null
    : new Promise((r) => { img.onload = r; img.onerror = r; setTimeout(r, 2000) }))))
  root.style.cssText = 'display:block;position:fixed;left:-10000px;top:0'
  const heightMm = Math.ceil(root.scrollHeight / (96 / 25.4))
  root.style.cssText = ''
  document.getElementById('receipt-page-style')?.remove()
  const style = document.createElement('style')
  style.id = 'receipt-page-style'
  style.textContent = c.paper
    ? `@page { size: ${c.paper}mm ${heightMm + c.my * 2 + 2}mm; margin: ${c.my}mm ${c.mx}mm; }`
    : '@page { size: A4; margin: 15mm; }'
  document.head.appendChild(style)
  const cleanup = () => { root.innerHTML = ''; style.remove(); window.removeEventListener('afterprint', cleanup) }
  window.addEventListener('afterprint', cleanup)
  window.print()
}
