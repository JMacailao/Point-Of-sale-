import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { formatDate, formatMoney, formatTime, PAYMENT_LABELS } from '../utils/format'

// Thermal rolls are continuous: the page height is set to the measured receipt height at print time.
const PAPER = {
  '58mm': { width: '48mm', font: '10px', paperWidth: 58, marginX: 5, marginY: 3 },
  '80mm': { width: '72mm', font: '11.5px', paperWidth: 80, marginX: 4, marginY: 3 },
  a4: { width: '90mm', font: '12px' },
}
const PX_PER_MM = 96 / 25.4

/** Printable receipt. Uses inline styles so it renders identically on screen and in print. */
export function Receipt({ sale, store, paper = store?.receipt_paper || '80mm' }) {
  const cfg = PAPER[paper] || PAPER['80mm']
  const cur = store?.currency || 'PHP'
  const m = (v) => formatMoney(v, cur)
  const payment = sale.payments?.find((p) => p.kind === 'payment')
  const row = { display: 'flex', justifyContent: 'space-between', gap: '8px' }
  const hr = { borderTop: '1px dashed #000', margin: '6px 0' }

  return (
    <div style={{ width: cfg.width, fontSize: cfg.font, lineHeight: 1.35, color: '#000', background: '#fff',
      fontFamily: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace', margin: '0 auto' }}>
      <div style={{ textAlign: 'center' }}>
        {store?.logo_url && <img src={store.logo_url} alt="" style={{ maxWidth: '60%', maxHeight: '18mm', margin: '0 auto 4px', display: 'block', filter: 'grayscale(1)' }} />}
        <div style={{ fontWeight: 700, fontSize: '1.15em' }}>{store?.store_name}</div>
        {store?.store_address && <div>{store.store_address}</div>}
        {store?.contact_number && <div>Tel: {store.contact_number}</div>}
        {store?.tax_enabled && <div>{store.tax_name} {store.tax_inclusive ? 'inclusive' : 'exclusive'}</div>}
      </div>
      <div style={hr} />
      <div style={row}><span>Txn #</span><span>{sale.transaction_number}</span></div>
      <div style={row}><span>Date</span><span>{formatDate(sale.created_at, store)} {formatTime(sale.created_at, store)}</span></div>
      <div style={row}><span>Cashier</span><span style={{ textAlign: 'right' }}>{sale.cashier_name}</span></div>
      {sale.status === 'refunded' && <div style={{ textAlign: 'center', fontWeight: 700, margin: '4px 0' }}>*** REFUNDED ***</div>}
      <div style={hr} />
      {sale.items.map((it) => (
        <div key={it.id} style={{ marginBottom: '3px' }}>
          <div style={{ wordBreak: 'break-word' }}>{it.product_name}</div>
          <div style={row}><span>{it.quantity} x {m(it.unit_price)}</span><span>{m(it.subtotal)}</span></div>
        </div>
      ))}
      <div style={hr} />
      <div style={row}><span>Subtotal</span><span>{m(sale.subtotal)}</span></div>
      {Number(sale.discount) > 0 && (
        <div style={row}><span>Discount{sale.discount_type === 'percent' ? ` (${Number(sale.discount_value)}%)` : ''}</span><span>-{m(sale.discount)}</span></div>
      )}
      {Number(sale.tax_amount) > 0 && (
        <div style={row}><span>{store?.tax_name || 'Tax'}{sale.tax_inclusive ? ' (incl.)' : ''}</span><span>{m(sale.tax_amount)}</span></div>
      )}
      <div style={{ ...row, fontWeight: 700, fontSize: '1.2em', marginTop: '2px' }}><span>TOTAL</span><span>{m(sale.total_amount)}</span></div>
      <div style={hr} />
      <div style={row}><span>Payment</span><span>{PAYMENT_LABELS[sale.payment_method]}</span></div>
      {payment?.reference_number && <div style={row}><span>Ref #</span><span>{payment.reference_number}</span></div>}
      <div style={row}><span>Amount received</span><span>{m(sale.amount_received)}</span></div>
      <div style={row}><span>Change</span><span>{m(sale.change_amount)}</span></div>
      <div style={hr} />
      {store?.receipt_footer && <div style={{ textAlign: 'center', whiteSpace: 'pre-line' }}>{store.receipt_footer}</div>}
      <div style={{ textAlign: 'center', marginTop: '4px', fontSize: '0.9em' }}>This serves as your sales receipt.</div>
    </div>
  )
}

/**
 * Prints a receipt using the browser print dialog. Works with USB/network
 * thermal printers installed in the OS and with Android print services that
 * support 58mm/80mm paper. (No direct Bluetooth printing integration.)
 */
export async function printReceipt(sale, store, paper) {
  const size = paper || store?.receipt_paper || '80mm'
  const container = document.getElementById('print-root')
  const cfg = PAPER[size] || PAPER['80mm']
  const root = createRoot(container)
  flushSync(() => root.render(<Receipt sale={sale} store={store} paper={size} />))
  await Promise.all([...container.querySelectorAll('img')].map((img) => (img.complete ? null
    : new Promise((r) => { img.onload = r; img.onerror = r; setTimeout(r, 2000) }))))

  // #print-root is hidden on screen; measure it off-screen to size the roll page.
  container.style.cssText = 'display:block;position:fixed;left:-10000px;top:0'
  const heightMm = Math.ceil(container.scrollHeight / PX_PER_MM)
  container.style.cssText = ''

  const style = document.createElement('style')
  style.id = 'receipt-page-style'
  style.textContent = cfg.paperWidth
    ? `@page { size: ${cfg.paperWidth}mm ${heightMm + cfg.marginY * 2 + 2}mm; margin: ${cfg.marginY}mm ${cfg.marginX}mm; }`
    : '@page { size: A4; margin: 15mm; }'
  document.getElementById('receipt-page-style')?.remove()
  document.head.appendChild(style)

  const cleanup = () => {
    root.unmount()
    style.remove()
    window.removeEventListener('afterprint', cleanup)
  }
  window.addEventListener('afterprint', cleanup)
  window.print()
}
