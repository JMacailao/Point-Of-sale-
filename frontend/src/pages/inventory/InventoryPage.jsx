import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowDownToLine, ArrowUpFromLine, ClipboardCheck, History, Search } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { useApi, useDebounced } from '../../hooks/useApi'
import { api } from '../../services/api'
import {
  Badge, Button, EmptyState, ErrorState, IconButton, Input, Modal, PageHeader, PageLoader, Pagination, Stat, StatRow,
  Tabs, Textarea, TableWrap,
} from '../../components/ui'
import { formatDateTime, formatMoney, formatNumber, MOVEMENT_LABELS } from '../../utils/format'

const TYPE_INFO = {
  stock_in: { title: 'Stock In', endpoint: '/inventory/stock-in', qtyLabel: 'Quantity received', reasonRequired: false },
  stock_out: { title: 'Stock Out', endpoint: '/inventory/stock-out', qtyLabel: 'Quantity removed', reasonRequired: true },
  adjustment: { title: 'Stock Adjustment', endpoint: '/inventory/adjustment', qtyLabel: 'Counted quantity (new stock level)', reasonRequired: true },
}

function StockModal({ action, onClose, onDone }) {
  const toast = useToast()
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [lastKey, setLastKey] = useState(null)
  const key = action ? `${action.type}:${action.product.id}` : null
  if (key !== lastKey) { setLastKey(key); setQty(''); setReason(''); setErrors({}) }
  if (!action) return null
  const info = TYPE_INFO[action.type]
  const p = action.product
  const n = Number(qty)
  const preview = qty === '' || !Number.isInteger(n) ? null
    : action.type === 'stock_in' ? p.stock_quantity + n : action.type === 'stock_out' ? p.stock_quantity - n : n

  async function submit(e) {
    e.preventDefault()
    const errs = {}
    const min = action.type === 'adjustment' ? 0 : 1
    if (!/^\d+$/.test(qty) || n < min) errs.qty = `Enter a whole number of at least ${min}.`
    else if (action.type === 'stock_out' && n > p.stock_quantity) errs.qty = `Only ${p.stock_quantity} in stock.`
    else if (action.type === 'adjustment' && n === p.stock_quantity) errs.qty = 'Counted quantity equals current stock.'
    if (info.reasonRequired && !reason.trim()) errs.reason = 'A reason is required.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    setSaving(true)
    try {
      const body = action.type === 'adjustment'
        ? { product_id: p.id, counted_quantity: n, reason: reason.trim() }
        : { product_id: p.id, quantity: n, reason: reason.trim() || null }
      const { data } = await api.post(info.endpoint, body)
      toast.success(`${info.title}: ${p.name} is now ${data.new_quantity}`)
      onDone()
    } catch (err) { toast.error(err) } finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} title={info.title} size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="stock-form" loading={saving}>Save</Button></>}>
      <form id="stock-form" onSubmit={submit} noValidate className="space-y-3">
        <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
          <p className="font-medium">{p.name}</p>
          <p className="text-xs text-slate-500">Current stock: <b className="text-slate-800">{p.stock_quantity}</b></p>
        </div>
        <Input label={info.qtyLabel} type="number" inputMode="numeric" min={0} value={qty} onChange={(e) => setQty(e.target.value)} error={errors.qty}
          hint={preview !== null ? `New stock will be ${preview}` : undefined} />
        <Textarea label={`Reason${info.reasonRequired ? '' : ' (optional)'}`} value={reason} onChange={(e) => setReason(e.target.value)} error={errors.reason} maxLength={300}
          placeholder={action.type === 'stock_in' ? 'e.g. Supplier delivery #123' : action.type === 'stock_out' ? 'e.g. Damaged, expired' : 'e.g. Monthly physical count'} />
      </form>
    </Modal>
  )
}

function StockLevels({ onMovements }) {
  const { can, store } = useAuth()
  const [params] = useSearchParams()
  const [filter, setFilter] = useState(params.get('filter') || 'all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const q = useDebounced(search)
  const list = useApi('/inventory', { filter, search: q, page, pageSize: 25 })
  const [action, setAction] = useState(null)
  const manage = can('inventory.manage')
  const s = list.meta?.summary
  const m = (v) => formatMoney(v, store.currency)

  return (
    <>
      {s && (
        <StatRow cols={4}>
          <Stat label="Units in stock" value={formatNumber(s.total_units)} sub={`${s.product_count} products`} />
          <Stat label="Stock value (cost)" value={m(s.stock_value_cost)} sub={`Retail ${m(s.stock_value_retail)}`} />
          <Stat label="Low stock" value={s.low_stock_count} tone={s.low_stock_count ? 'red' : undefined} />
          <Stat label="Out of stock" value={s.out_of_stock_count} tone={s.out_of_stock_count ? 'red' : undefined} />
        </StatRow>
      )}
      <div className="rounded-md border border-slate-200 bg-white">
        <div className="flex flex-wrap gap-2 border-b border-slate-200 p-3">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-slate-400" />
            <input className="input pl-8" placeholder="Search product" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} aria-label="Search" />
          </div>
          <select className="input w-auto" value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1) }} aria-label="Filter">
            <option value="all">All products</option><option value="low">Low stock alerts</option><option value="out">Out of stock</option>
          </select>
        </div>
        {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : !list.data ? <PageLoader /> : !list.data.length ? (
          <EmptyState title={filter === 'low' ? 'No low-stock products' : 'No products'} message={filter === 'low' ? 'Everything is above its minimum stock level.' : undefined} />
        ) : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Product</th><th className="num">Stock</th><th className="num hidden sm:table-cell">Minimum</th><th className="num hidden md:table-cell">Value (cost)</th><th className="hidden lg:table-cell">Last movement</th><th className="w-36"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {list.data.map((p) => (
                  <tr key={p.id}>
                    <td><p className="font-medium">{p.name}</p><p className="text-xs text-slate-500">{p.sku || p.barcode || '—'}{p.category_name ? ` · ${p.category_name}` : ''}</p></td>
                    <td className="num">{p.stock_quantity === 0 ? <Badge tone="red">0 · Out</Badge> : p.is_low_stock ? <Badge tone="amber">{p.stock_quantity} · Low</Badge> : <span className="font-medium">{p.stock_quantity}</span>}</td>
                    <td className="num hidden text-slate-600 sm:table-cell">{p.minimum_stock}</td>
                    <td className="num hidden text-slate-600 md:table-cell">{m(p.stock_value)}</td>
                    <td className="hidden text-xs text-slate-500 lg:table-cell">{p.last_movement_at ? formatDateTime(p.last_movement_at, store) : '—'}</td>
                    <td className="whitespace-nowrap text-right">
                      {manage && <>
                        <IconButton icon={ArrowDownToLine} label={`Stock in ${p.name}`} onClick={() => setAction({ type: 'stock_in', product: p })} />
                        <IconButton icon={ArrowUpFromLine} label={`Stock out ${p.name}`} onClick={() => setAction({ type: 'stock_out', product: p })} />
                        <IconButton icon={ClipboardCheck} label={`Adjust ${p.name}`} onClick={() => setAction({ type: 'adjustment', product: p })} />
                      </>}
                      <IconButton icon={History} label={`History of ${p.name}`} onClick={() => onMovements(p)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        <Pagination meta={list.meta} onPage={setPage} />
      </div>
      <StockModal action={action} onClose={() => setAction(null)} onDone={() => { setAction(null); list.reload() }} />
    </>
  )
}

function Movements({ product, onClearProduct }) {
  const { store } = useAuth()
  const [f, setF] = useState({ type: '', from: '', to: '', search: '', page: 1 })
  const search = useDebounced(f.search)
  const list = useApi('/inventory/movements', { ...f, search, product_id: product?.id, pageSize: 25 })
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value, page: 1 }))
  return (
    <div className="rounded-md border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
        {product ? (
          <span className="inline-flex items-center gap-2 rounded-md bg-blue-50 px-2.5 py-1.5 text-xs text-blue-800">
            {product.name} <button className="font-medium underline" onClick={onClearProduct}>Show all</button>
          </span>
        ) : <input className="input w-48" placeholder="Search product" value={f.search} onChange={set('search')} aria-label="Search product" />}
        <select className="input w-auto" value={f.type} onChange={set('type')} aria-label="Movement type">
          <option value="">All movement types</option>
          {Object.entries(MOVEMENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input type="date" className="input w-auto" value={f.from} onChange={set('from')} aria-label="From date" />
        <input type="date" className="input w-auto" value={f.to} onChange={set('to')} aria-label="To date" />
      </div>
      {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : !list.data ? <PageLoader /> : !list.data.length ? (
        <EmptyState title="No stock movements" />
      ) : (
        <TableWrap>
          <table className="table">
            <thead><tr><th>Date & Time</th><th>Product</th><th>Type</th><th className="num">Previous</th><th className="num">Change</th><th className="num">New</th><th className="hidden md:table-cell">Reason</th><th className="hidden sm:table-cell">Performed By</th></tr></thead>
            <tbody>
              {list.data.map((mv) => (
                <tr key={mv.id}>
                  <td className="whitespace-nowrap text-slate-600">{formatDateTime(mv.created_at, store)}</td>
                  <td className="font-medium">{mv.product_name}</td>
                  <td><Badge tone={mv.quantity_changed > 0 ? 'green' : mv.movement_type === 'sale' ? 'blue' : 'amber'}>{MOVEMENT_LABELS[mv.movement_type]}</Badge></td>
                  <td className="num text-slate-600">{mv.previous_quantity}</td>
                  <td className={`num font-medium ${mv.quantity_changed > 0 ? 'text-emerald-700' : 'text-red-600'}`}>{mv.quantity_changed > 0 ? '+' : ''}{mv.quantity_changed}</td>
                  <td className="num">{mv.new_quantity}</td>
                  <td className="hidden max-w-64 truncate text-slate-600 md:table-cell" title={mv.reason || ''}>{mv.reason || '—'}</td>
                  <td className="hidden text-slate-600 sm:table-cell">{mv.performed_by_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      <Pagination meta={list.meta} onPage={(page) => setF((x) => ({ ...x, page }))} />
    </div>
  )
}

export default function InventoryPage() {
  const [tab, setTab] = useState('stock')
  const [product, setProduct] = useState(null)
  return (
    <div>
      <PageHeader title="Stock / Inventory" description="Every stock change is recorded with who, when and why." />
      <Tabs tabs={[['stock', 'Current Inventory'], ['movements', 'Inventory History']]} value={tab} onChange={(t) => { setTab(t); if (t === 'stock') setProduct(null) }} />
      {tab === 'stock'
        ? <StockLevels onMovements={(p) => { setProduct(p); setTab('movements') }} />
        : <Movements product={product} onClearProduct={() => setProduct(null)} />}
    </div>
  )
}
