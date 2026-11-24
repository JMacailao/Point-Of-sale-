import { useCallback, useMemo, useRef, useState } from 'react'
import { Minus, Plus, Trash2, Search, ScanBarcode, ShoppingCart, Printer, PackageX, ImageOff } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { useApi, useDebounced } from '../../hooks/useApi'
import { useBarcodeScanner } from '../../hooks/useBarcodeScanner'
import { api } from '../../services/api'
import { Button, ConfirmDialog, Modal, Spinner, EmptyState } from '../../components/ui'
import { Receipt, printReceipt } from '../../components/Receipt'
import { formatMoney, toCents, fromCents, PAYMENT_LABELS } from '../../utils/format'
import { newRequestId } from '../../utils/ids'

const METHODS = ['cash', 'gcash', 'maya', 'other']

export default function CashierPage() {
  const { store, can } = useAuth()
  const toast = useToast()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const debounced = useDebounced(search, 250)
  const products = useApi('/products', { status: 'active', search: debounced, category_id: category, pageSize: 120, sort: 'name' })
  const categories = useApi('/categories')

  const [cart, setCart] = useState([]) // [{ product, quantity }]
  const [discountType, setDiscountType] = useState('none')
  const [discountValue, setDiscountValue] = useState('')
  const [method, setMethod] = useState('cash')
  const [received, setReceived] = useState('')
  const [reference, setReference] = useState('')
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [completedSale, setCompletedSale] = useState(null)
  const [mobileView, setMobileView] = useState('products')
  const requestId = useRef(newRequestId())
  const searchRef = useRef(null)

  const cur = store.currency
  const money = (v) => formatMoney(v, cur)
  const canDiscount = can('sales.discount') || store.allow_cashier_discount
  const discountLimit = can('sales.discount') ? 100 : Number(store.max_discount_percent)

  // ------------------------------------------------------------------ cart
  const addProduct = useCallback((product, qty = 1) => {
    setError(null)
    setCart((items) => {
      const existing = items.find((i) => i.product.id === product.id)
      const nextQty = (existing?.quantity || 0) + qty
      if (nextQty > product.stock_quantity) {
        toast.error(product.stock_quantity === 0 ? `${product.name} is out of stock` : `Only ${product.stock_quantity} of ${product.name} in stock`)
        return items
      }
      if (existing) return items.map((i) => (i.product.id === product.id ? { ...i, product, quantity: nextQty } : i))
      return [...items, { product, quantity: qty }]
    })
  }, [toast])

  const setQuantity = (id, qty) => {
    setCart((items) => items.flatMap((i) => {
      if (i.product.id !== id) return [i]
      if (!Number.isFinite(qty) || qty < 1) return [{ ...i, quantity: 1 }]
      if (qty > i.product.stock_quantity) {
        toast.error(`Only ${i.product.stock_quantity} of ${i.product.name} in stock`)
        return [{ ...i, quantity: i.product.stock_quantity }]
      }
      return [{ ...i, quantity: Math.floor(qty) }]
    }))
  }
  const removeItem = (id) => setCart((items) => items.filter((i) => i.product.id !== id))

  const lookupCode = useCallback(async (code) => {
    try {
      const { data } = await api.get('/products/lookup', { code })
      addProduct(data)
      setSearch('')
      return true
    } catch (err) {
      if (err.status === 404) toast.error(`No product found for "${code}"`)
      else toast.error(err)
      return false
    }
  }, [addProduct, toast])

  useBarcodeScanner(lookupCode)

  // --------------------------------------------------------------- totals
  // Preview only; the server recalculates everything from database prices.
  const totals = useMemo(() => {
    const subtotal = cart.reduce((s, i) => s + toCents(i.product.selling_price) * i.quantity, 0)
    let discount = 0
    const value = Number(discountValue) || 0
    if (discountType === 'amount') discount = Math.min(subtotal, toCents(value))
    if (discountType === 'percent') discount = Math.round(subtotal * Math.min(100, value) / 100)
    const taxable = subtotal - discount
    let tax = 0
    let total = taxable
    if (store.tax_enabled && Number(store.tax_rate) > 0) {
      const rate = Number(store.tax_rate)
      if (store.tax_inclusive) tax = Math.round(taxable * rate / (100 + rate))
      else { tax = Math.round(taxable * rate / 100); total = taxable + tax }
    }
    const discountPct = subtotal ? (discount * 100) / subtotal : 0
    return { subtotal, discount, tax, total, discountPct, items: cart.reduce((s, i) => s + i.quantity, 0) }
  }, [cart, discountType, discountValue, store])

  const receivedCents = method === 'cash' || method === 'other' ? toCents(received) : totals.total
  const change = Math.max(0, receivedCents - totals.total)

  let validation = null
  if (!cart.length) validation = 'Add products to the cart'
  else if (discountType !== 'none' && totals.discountPct > discountLimit + 1e-9) validation = `Discount exceeds the ${discountLimit}% limit`
  else if (discountType === 'amount' && toCents(discountValue) > totals.subtotal) validation = 'Discount exceeds subtotal'
  else if (method === 'cash' && (received === '' || receivedCents < totals.total)) validation = 'Amount received is less than the total'
  else if (method === 'other' && received !== '' && receivedCents < totals.total) validation = 'Amount received is less than the total'
  else if ((method === 'gcash' || method === 'maya') && reference.trim().length < 4) validation = 'Enter the reference number'

  function resetTransaction() {
    setCart([])
    setDiscountType('none')
    setDiscountValue('')
    setMethod('cash')
    setReceived('')
    setReference('')
    setError(null)
    requestId.current = newRequestId()
    setMobileView('products')
  }

  async function completePayment() {
    if (validation || processing) return
    setProcessing(true)
    setError(null)
    try {
      const { data } = await api.post('/sales', {
        client_request_id: requestId.current,
        items: cart.map((i) => ({ product_id: i.product.id, quantity: i.quantity })),
        discount_type: discountType,
        discount_value: discountType === 'none' ? 0 : Number(discountValue) || 0,
        payment_method: method,
        amount_received: method === 'cash' || (method === 'other' && received !== '') ? Number(received) : null,
        reference_number: reference.trim() || null,
      })
      setCompletedSale(data)
      if (data.duplicate) toast.info(`This payment was already recorded as ${data.transaction_number}`)
      else toast.success(`Payment completed · ${data.transaction_number}`)
      resetTransaction()
      products.reload()
    } catch (err) {
      setError(err.message)
      if (['INSUFFICIENT_STOCK', 'PRODUCT_UNAVAILABLE'].includes(err.code)) products.reload()
    } finally {
      setProcessing(false)
    }
  }

  const quickAmounts = useMemo(() => {
    const total = fromCents(totals.total)
    const set = new Set([total])
    for (const step of [20, 50, 100, 500, 1000]) {
      const v = Math.ceil(total / step) * step
      if (v > total) set.add(v)
    }
    return [...set].slice(0, 4)
  }, [totals.total])

  // ------------------------------------------------------------------ UI
  const productPanel = (
    <section className={`flex min-h-0 flex-col border-slate-200 bg-white lg:rounded-md lg:border ${mobileView === 'products' ? 'flex' : 'hidden lg:flex'}`}>
      <div className="space-y-2 border-b border-slate-200 p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-slate-400" />
          <input ref={searchRef} autoFocus value={search} onChange={(e) => setSearch(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === 'Enter' && search.trim()) {
                e.preventDefault()
                await lookupCode(search.trim())
              }
            }}
            placeholder="Search name, SKU or scan barcode…" aria-label="Search products or scan barcode"
            className="input h-10 pl-8 pr-9" />
          <ScanBarcode className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-slate-400" />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {[['', 'All'], ...(categories.data || []).map((c) => [c.id, c.name])].map(([id, name]) => (
            <button key={id || 'all'} onClick={() => setCategory(id)}
              className={`shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium ${category === id
                ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
              {name}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {products.loading && !products.data ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : products.error ? (
          <p className="p-4 text-sm text-red-600">{products.error.message}</p>
        ) : !products.data?.length ? (
          <EmptyState icon={PackageX} title="No products found" message={search ? 'Try another search or scan again.' : 'Add products in the Products module.'} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {products.data.map((p) => {
              const inCart = cart.find((i) => i.product.id === p.id)?.quantity || 0
              const out = p.stock_quantity - inCart <= 0
              return (
                <li key={p.id}>
                  <button disabled={out} onClick={() => addProduct(p)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-blue-50/50 disabled:cursor-not-allowed disabled:opacity-50">
                    <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded border border-slate-200 bg-slate-50">
                      {p.image_url ? <img src={p.image_url} alt="" loading="lazy" className="size-full object-cover" /> : <ImageOff className="size-4 text-slate-300" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{p.name}</p>
                      <p className="truncate text-xs text-slate-500">
                        {p.sku || p.barcode || '—'} · <span className={p.stock_quantity <= p.minimum_stock ? 'text-amber-700' : ''}>{p.stock_quantity} in stock</span>
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold tabular-nums">{money(p.selling_price)}</p>
                      {inCart > 0 && <p className="text-xs text-blue-700">{inCart} in cart</p>}
                    </div>
                    <Plus className="size-4 shrink-0 text-blue-600" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )

  const cartPanel = (
    <section className={`flex min-h-0 flex-col border-slate-200 bg-white lg:rounded-md lg:border ${mobileView === 'cart' ? 'flex' : 'hidden lg:flex'}`}>
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2.5">
        <h2 className="text-sm font-semibold">Current sale <span className="font-normal text-slate-500">({totals.items} {totals.items === 1 ? "item" : "items"})</span></h2>
        {cart.length > 0 && <button className="text-xs text-red-600 hover:underline" onClick={() => setConfirmCancel(true)}>Cancel Transaction</button>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!cart.length ? (
          <EmptyState icon={ShoppingCart} title="Cart is empty" message="Search, tap or scan products to add them." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {cart.map(({ product, quantity }) => (
              <li key={product.id} className="px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{product.name}</p>
                    <p className="text-xs text-slate-500">{money(product.selling_price)} each</p>
                  </div>
                  <p className="text-sm font-semibold tabular-nums">{money(fromCents(toCents(product.selling_price) * quantity))}</p>
                </div>
                <div className="mt-1.5 flex items-center gap-1">
                  <button className="flex size-8 items-center justify-center rounded border border-slate-300 hover:bg-slate-50" onClick={() => setQuantity(product.id, quantity - 1)} aria-label={`Decrease ${product.name}`} disabled={quantity <= 1}><Minus className="size-3.5" /></button>
                  <input type="number" inputMode="numeric" min={1} max={product.stock_quantity} value={quantity}
                    onChange={(e) => setQuantity(product.id, Number(e.target.value))} aria-label={`Quantity of ${product.name}`}
                    className="input h-8 w-14 text-center" />
                  <button className="flex size-8 items-center justify-center rounded border border-slate-300 hover:bg-slate-50" onClick={() => setQuantity(product.id, quantity + 1)} aria-label={`Increase ${product.name}`} disabled={quantity >= product.stock_quantity}><Plus className="size-3.5" /></button>
                  <span className="ml-2 text-xs text-slate-400">of {product.stock_quantity}</span>
                  <button className="ml-auto rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => removeItem(product.id)} aria-label={`Remove ${product.name}`}><Trash2 className="size-4" /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-3 border-t border-slate-200 p-3">
        {canDiscount && cart.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="w-20 text-xs font-medium text-slate-600">Discount</span>
            <select value={discountType} onChange={(e) => setDiscountType(e.target.value)} className="input h-8 w-28" aria-label="Discount type">
              <option value="none">None</option>
              <option value="amount">Amount ₱</option>
              <option value="percent">Percent %</option>
            </select>
            {discountType !== 'none' && (
              <input type="number" inputMode="decimal" min={0} step="0.01" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)}
                className="input h-8 flex-1" aria-label="Discount value" placeholder={discountType === 'percent' ? `max ${discountLimit}%` : '0.00'} />
            )}
          </div>
        )}

        <dl className="space-y-1 text-sm">
          <div className="flex justify-between"><dt className="text-slate-600">Subtotal</dt><dd className="tabular-nums">{money(fromCents(totals.subtotal))}</dd></div>
          {totals.discount > 0 && <div className="flex justify-between"><dt className="text-slate-600">Discount</dt><dd className="tabular-nums text-emerald-700">−{money(fromCents(totals.discount))}</dd></div>}
          {totals.tax > 0 && <div className="flex justify-between text-xs"><dt className="text-slate-500">{store.tax_name} {store.tax_inclusive ? '(included)' : ''}</dt><dd className="tabular-nums text-slate-500">{money(fromCents(totals.tax))}</dd></div>}
          <div className="flex justify-between border-t border-slate-200 pt-1.5 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{money(fromCents(totals.total))}</dd></div>
        </dl>

        <div>
          <span className="label">Payment method</span>
          <div className="grid grid-cols-4 gap-1">
            {METHODS.map((m) => (
              <button key={m} onClick={() => { setMethod(m); setReceived(''); setReference('') }}
                className={`h-9 rounded-md border text-xs font-medium ${method === m ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
                {PAYMENT_LABELS[m]}
              </button>
            ))}
          </div>
        </div>

        {(method === 'cash' || method === 'other') && (
          <div>
            <label className="label" htmlFor="received">Amount received{method === 'other' ? ' (optional)' : ''}</label>
            <input id="received" type="number" inputMode="decimal" min={0} step="0.01" value={received}
              onChange={(e) => setReceived(e.target.value)} className="input h-10 text-base tabular-nums" placeholder="0.00"
              onKeyDown={(e) => { if (e.key === 'Enter') completePayment() }} />
            {method === 'cash' && cart.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {quickAmounts.map((a, i) => (
                  <button key={a} onClick={() => setReceived(String(a))} className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">
                    {i === 0 ? 'Exact' : money(a)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {method !== 'cash' && (
          <div>
            <label className="label" htmlFor="ref">Reference number{method === 'other' ? ' (optional)' : ''}</label>
            <input id="ref" value={reference} maxLength={64} onChange={(e) => setReference(e.target.value)} className="input h-10" placeholder={method === 'other' ? 'Optional' : 'e.g. 1023 456 789'} />
          </div>
        )}
        {(method === 'cash' || (method === 'other' && received !== '')) && cart.length > 0 && (
          <div className="flex justify-between rounded-md bg-emerald-50 px-3 py-2 text-sm">
            <span className="font-medium text-emerald-800">Change</span>
            <span className="font-semibold tabular-nums text-emerald-800">{money(fromCents(change))}</span>
          </div>
        )}

        {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <Button variant="success" size="lg" className="w-full" disabled={Boolean(validation)} loading={processing} onClick={completePayment}
          title={validation || ''}>
          Complete Payment · {money(fromCents(totals.total))}
        </Button>
        {validation && cart.length > 0 && <p className="text-center text-xs text-slate-500">{validation}</p>}
      </div>
    </section>
  )

  return (
    <div className="flex h-[calc(100dvh-3.5rem-4rem)] flex-col lg:h-[calc(100dvh-3.5rem-2rem)]">
      <div className="flex border-b border-slate-200 bg-white lg:hidden">
        {[['products', 'Products'], ['cart', `Cart (${totals.items}) · ${money(fromCents(totals.total))}`]].map(([k, label]) => (
          <button key={k} onClick={() => setMobileView(k)}
            className={`flex-1 border-b-2 py-2.5 text-sm font-medium ${mobileView === k ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500'}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]">
        {productPanel}
        {cartPanel}
      </div>

      <ConfirmDialog open={confirmCancel} title="Cancel transaction?" message="All items in the cart will be removed."
        confirmLabel="Cancel Transaction" onClose={() => setConfirmCancel(false)}
        onConfirm={() => { resetTransaction(); setConfirmCancel(false); searchRef.current?.focus() }} />

      <Modal open={Boolean(completedSale)} onClose={() => { setCompletedSale(null); searchRef.current?.focus() }} title="Payment completed" size="sm"
        footer={<>
          <Button variant="secondary" icon={Printer} onClick={() => printReceipt(completedSale, store)}>Print Receipt</Button>
          <Button onClick={() => { setCompletedSale(null); setTimeout(() => searchRef.current?.focus(), 50) }}>New Sale</Button>
        </>}>
        {completedSale && (
          <div className="rounded-md border border-slate-200 bg-white p-3">
            <Receipt sale={completedSale} store={store} paper="80mm" />
          </div>
        )}
      </Modal>
    </div>
  )
}
