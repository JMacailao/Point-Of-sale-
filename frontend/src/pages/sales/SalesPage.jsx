import { useState } from 'react'
import { Download, Printer, Search, Undo2 } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { useApi, useDebounced } from '../../hooks/useApi'
import { api } from '../../services/api'
import {
  Badge, Button, EmptyState, ErrorState, Modal, PageHeader, PageLoader, Pagination, Stat, StatRow, Textarea, TableWrap,
} from '../../components/ui'
import { printReceipt } from '../../components/Receipt'
import { formatDateTime, formatMoney, PAYMENT_LABELS } from '../../utils/format'

function SaleDetail({ saleId, onClose, onChanged }) {
  const { store, can } = useAuth()
  const toast = useToast()
  const { data: sale, error, loading, setData } = useApi(saleId ? `/sales/${saleId}` : null, undefined, { enabled: Boolean(saleId) })
  const [refunding, setRefunding] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [paper, setPaper] = useState(store.receipt_paper)
  const m = (v) => formatMoney(v, store.currency)
  if (!saleId) return null

  async function refund() {
    if (!reason.trim()) return toast.error('Enter a refund reason')
    setBusy(true)
    try {
      const { data } = await api.post(`/sales/${saleId}/refund`, { reason: reason.trim() })
      setData(data)
      setRefunding(false)
      toast.success('Sale refunded and items restocked')
      onChanged()
    } catch (err) { toast.error(err) } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} title={sale ? `Transaction ${sale.transaction_number}` : 'Transaction'} size="lg"
      footer={sale && <>
        {can('sales.refund') && sale.status === 'completed' && !refunding && <Button variant="danger" icon={Undo2} onClick={() => setRefunding(true)}>Refund</Button>}
        <select className="input h-9 w-auto" value={paper} onChange={(e) => setPaper(e.target.value)} aria-label="Paper size">
          <option value="58mm">58mm</option><option value="80mm">80mm</option><option value="a4">A4 / Letter</option>
        </select>
        <Button icon={Printer} onClick={() => printReceipt(sale, store, paper)}>Print Receipt</Button>
      </>}>
      {error ? <ErrorState error={error} /> : loading || !sale ? <PageLoader /> : (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            <div><dt className="text-xs text-slate-500">Date & Time</dt><dd>{formatDateTime(sale.created_at, store)}</dd></div>
            <div><dt className="text-xs text-slate-500">Cashier</dt><dd>{sale.cashier_name}</dd></div>
            <div><dt className="text-xs text-slate-500">Payment</dt><dd>{PAYMENT_LABELS[sale.payment_method]}</dd></div>
            <div><dt className="text-xs text-slate-500">Status</dt><dd>{sale.status === 'completed' ? <Badge tone="green">Completed</Badge> : <Badge tone="red">Refunded</Badge>}</dd></div>
          </dl>
          {sale.status === 'refunded' && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">Refunded {formatDateTime(sale.refunded_at, store)} by {sale.refunded_by_name}: {sale.refund_reason}</p>
          )}
          <div className="rounded-md border border-slate-200">
            <TableWrap>
              <table className="table">
                <thead><tr><th>Product</th><th className="num">Qty</th><th className="num">Unit Price</th><th className="num">Subtotal</th></tr></thead>
                <tbody>
                  {sale.items.map((i) => (
                    <tr key={i.id}><td>{i.product_name}<span className="block text-xs text-slate-500">{i.sku}</span></td><td className="num">{i.quantity}</td><td className="num">{m(i.unit_price)}</td><td className="num">{m(i.subtotal)}</td></tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </div>
          <dl className="ml-auto max-w-xs space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-slate-600">Subtotal</dt><dd className="tabular-nums">{m(sale.subtotal)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-600">Discount</dt><dd className="tabular-nums">−{m(sale.discount)}</dd></div>
            {sale.tax_amount > 0 && <div className="flex justify-between"><dt className="text-slate-600">{store.tax_name} {sale.tax_inclusive ? '(incl.)' : ''}</dt><dd className="tabular-nums">{m(sale.tax_amount)}</dd></div>}
            <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold"><dt>Total</dt><dd className="tabular-nums">{m(sale.total_amount)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-600">Amount received</dt><dd className="tabular-nums">{m(sale.amount_received)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-600">Change</dt><dd className="tabular-nums">{m(sale.change_amount)}</dd></div>
            {sale.payments.filter((p) => p.reference_number).map((p) => <div key={p.id} className="flex justify-between"><dt className="text-slate-600">Reference #</dt><dd>{p.reference_number}</dd></div>)}
          </dl>
          {refunding && (
            <div className="rounded-md border border-red-200 bg-red-50/50 p-3">
              <p className="mb-2 text-sm text-slate-700">Refund the full amount of <b>{m(sale.total_amount)}</b> and return all items to stock.</p>
              <Textarea label="Refund reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
              <div className="mt-2 flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setRefunding(false)}>Cancel</Button>
                <Button variant="danger" loading={busy} onClick={refund}>Confirm Refund</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

export default function SalesPage() {
  const { store, can } = useAuth()
  const toast = useToast()
  const viewAll = can('sales.view_all')
  const [f, setF] = useState({ search: '', from: '', to: '', cashier_id: '', payment_method: '', status: '', page: 1 })
  const search = useDebounced(f.search)
  const query = { ...f, search, pageSize: 20 }
  const list = useApi('/sales', query)
  const cashiers = useApi('/sales/cashiers', undefined, { enabled: viewAll })
  const [selected, setSelected] = useState(null)
  const [exporting, setExporting] = useState(false)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value, page: 1 }))
  const m = (v) => formatMoney(v, store.currency)

  async function exportCsv() {
    setExporting(true)
    try { await api.download('/sales/export', { ...query, page: undefined, pageSize: undefined }, 'sales.csv') }
    catch (err) { toast.error(err) } finally { setExporting(false) }
  }

  const t = list.meta?.totals
  return (
    <div>
      <PageHeader title="Revenue & Sales" description={viewAll ? 'All transactions in this store.' : 'Your transactions.'}
        actions={<Button variant="secondary" icon={Download} loading={exporting} onClick={exportCsv}>Export CSV</Button>} />
      {t && (
        <StatRow cols={3}>
          <Stat label="Completed sales (filtered)" value={m(t.completed_total)} sub={`${t.completed_count} transactions`} />
          <Stat label="Refunded (filtered)" value={m(t.refunded_total)} />
          <Stat label="Average sale" value={m(t.completed_count ? t.completed_total / t.completed_count : 0)} />
        </StatRow>
      )}
      <div className="rounded-md border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
          <div className="relative min-w-44 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-slate-400" />
            <input className="input pl-8" placeholder="Transaction number" value={f.search} onChange={set('search')} aria-label="Search transaction number" />
          </div>
          <input type="date" className="input w-auto" value={f.from} onChange={set('from')} aria-label="From date" />
          <input type="date" className="input w-auto" value={f.to} onChange={set('to')} aria-label="To date" />
          {viewAll && (
            <select className="input w-auto" value={f.cashier_id} onChange={set('cashier_id')} aria-label="Cashier">
              <option value="">All cashiers</option>
              {(cashiers.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <select className="input w-auto" value={f.payment_method} onChange={set('payment_method')} aria-label="Payment method">
            <option value="">All payments</option>
            {['cash', 'gcash', 'maya', 'other'].map((p) => <option key={p} value={p}>{PAYMENT_LABELS[p]}</option>)}
          </select>
          <select className="input w-auto" value={f.status} onChange={set('status')} aria-label="Status">
            <option value="">All statuses</option><option value="completed">Completed</option><option value="refunded">Refunded</option>
          </select>
        </div>
        {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : !list.data ? <PageLoader /> : !list.data.length ? <EmptyState title="No transactions found" /> : (
          <TableWrap>
            <table className={`table ${list.loading ? 'opacity-60' : ''}`}>
              <thead><tr>
                <th>Transaction #</th><th>Date & Time</th>{viewAll && <th className="hidden md:table-cell">Cashier</th>}
                <th className="num hidden lg:table-cell">Subtotal</th><th className="num hidden lg:table-cell">Discount</th>
                <th className="num">Total</th><th className="hidden sm:table-cell">Payment</th><th>Status</th>
              </tr></thead>
              <tbody>
                {list.data.map((s) => (
                  <tr key={s.id} className="cursor-pointer" onClick={() => setSelected(s.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setSelected(s.id)}>
                    <td className="font-medium whitespace-nowrap text-blue-700">{s.transaction_number}</td>
                    <td className="whitespace-nowrap text-slate-600">{formatDateTime(s.created_at, store)}</td>
                    {viewAll && <td className="hidden md:table-cell">{s.cashier_name}</td>}
                    <td className="num hidden lg:table-cell">{m(s.subtotal)}</td>
                    <td className="num hidden text-slate-600 lg:table-cell">{s.discount > 0 ? `−${m(s.discount)}` : '—'}</td>
                    <td className="num font-medium">{m(s.total_amount)}</td>
                    <td className="hidden sm:table-cell">{PAYMENT_LABELS[s.payment_method]}</td>
                    <td>{s.status === 'completed' ? <Badge tone="green">Completed</Badge> : <Badge tone="red">Refunded</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        <Pagination meta={list.meta} onPage={(page) => setF((x) => ({ ...x, page }))} />
      </div>
      <SaleDetail saleId={selected} onClose={() => setSelected(null)} onChanged={list.reload} />
    </div>
  )
}
