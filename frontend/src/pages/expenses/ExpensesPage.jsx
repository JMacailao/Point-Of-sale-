import { useState } from 'react'
import { Download, Plus, Search, Pencil, Ban, Eye } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { useApi, useDebounced } from '../../hooks/useApi'
import { api } from '../../services/api'
import {
  Badge, Button, ConfirmDialog, EmptyState, ErrorState, IconButton, Input, Modal, PageHeader, PageLoader, Pagination, Select,
  Textarea, TableWrap, Checkbox,
} from '../../components/ui'
import { EXPENSE_CATEGORIES, formatDate, formatDateTime, formatMoney, PAYMENT_LABELS, todayIn } from '../../utils/format'

const CAT = Object.fromEntries(EXPENSE_CATEGORIES)
const METHODS = ['cash', 'gcash', 'maya', 'bank_transfer', 'other'].map((k) => [k, PAYMENT_LABELS[k]])

function ExpenseForm({ open, expense, onClose, onSaved }) {
  const { store } = useAuth()
  const toast = useToast()
  const blank = () => ({ description: '', category: 'supplies', amount: '', expense_date: todayIn(store.timezone), payment_method: 'cash', reference_number: '', notes: '' })
  const [form, setForm] = useState(blank)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [last, setLast] = useState(false)
  if (open !== last) {
    setLast(open)
    if (open) {
      setForm(expense ? { description: expense.description, category: expense.category, amount: String(expense.amount), expense_date: expense.expense_date,
        payment_method: expense.payment_method, reference_number: expense.reference_number || '', notes: expense.notes || '' } : blank())
      setErrors({})
    }
  }
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    const errs = {}
    if (!form.description.trim()) errs.description = 'Description is required.'
    if (!/^\d+(\.\d{1,2})?$/.test(form.amount) || Number(form.amount) <= 0) errs.amount = 'Enter an amount greater than zero (up to 2 decimals).'
    if (!form.expense_date) errs.expense_date = 'Date is required.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    setSaving(true)
    const body = { ...form, amount: Number(form.amount), description: form.description.trim() }
    try {
      if (expense) await api.put(`/expenses/${expense.id}`, body)
      else await api.post('/expenses', body)
      toast.success(expense ? 'Expense updated' : 'Expense recorded')
      onSaved()
    } catch (err) { toast.error(err) } finally { setSaving(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title={expense ? 'Edit Expense' : 'Add Expense'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="expense-form" loading={saving}>Save</Button></>}>
      <form id="expense-form" onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-2">
        <Input className="sm:col-span-2" label="Expense Description" required value={form.description} onChange={set('description')} error={errors.description} maxLength={200} />
        <Select label="Expense Category" value={form.category} onChange={set('category')} options={EXPENSE_CATEGORIES} />
        <Input label="Amount (₱)" required type="number" min={0} step="0.01" inputMode="decimal" value={form.amount} onChange={set('amount')} error={errors.amount} />
        <Input label="Date" required type="date" value={form.expense_date} onChange={set('expense_date')} error={errors.expense_date} />
        <Select label="Payment Method" value={form.payment_method} onChange={set('payment_method')} options={METHODS} />
        <Input className="sm:col-span-2" label="Reference Number" value={form.reference_number} onChange={set('reference_number')} maxLength={64} />
        <Textarea className="sm:col-span-2" label="Notes" value={form.notes} onChange={set('notes')} maxLength={1000} />
        {expense && <p className="text-xs text-slate-500 sm:col-span-2">Changes are recorded in the expense's audit history.</p>}
      </form>
    </Modal>
  )
}

function ExpenseDetail({ id, onClose }) {
  const { store } = useAuth()
  const { data, error } = useApi(id ? `/expenses/${id}` : null, undefined, { enabled: Boolean(id) })
  if (!id) return null
  const m = (v) => formatMoney(v, store.currency)
  const fmt = (k, v) => (v === null || v === undefined || v === '' ? '—' : k === 'amount' ? m(v) : k === 'category' ? CAT[v] || v : k === 'payment_method' ? PAYMENT_LABELS[v] || v : String(v))
  const SKIP = new Set(['id', 'store_id', 'recorded_by', 'created_at', 'updated_at', 'voided_by', 'voided_at'])
  return (
    <Modal open onClose={onClose} title="Expense Details" size="lg">
      {error ? <ErrorState error={error} /> : !data ? <PageLoader /> : (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            <div className="col-span-2 sm:col-span-3"><dt className="text-xs text-slate-500">Description</dt><dd className="font-medium">{data.description}</dd></div>
            <div><dt className="text-xs text-slate-500">Amount</dt><dd className="font-semibold">{m(data.amount)}</dd></div>
            <div><dt className="text-xs text-slate-500">Category</dt><dd>{CAT[data.category]}</dd></div>
            <div><dt className="text-xs text-slate-500">Date</dt><dd>{formatDate(data.expense_date, store)}</dd></div>
            <div><dt className="text-xs text-slate-500">Payment</dt><dd>{PAYMENT_LABELS[data.payment_method]}</dd></div>
            <div><dt className="text-xs text-slate-500">Reference</dt><dd>{data.reference_number || '—'}</dd></div>
            <div><dt className="text-xs text-slate-500">Recorded By</dt><dd>{data.recorded_by_name}</dd></div>
            {data.notes && <div className="col-span-2 sm:col-span-3"><dt className="text-xs text-slate-500">Notes</dt><dd className="whitespace-pre-line">{data.notes}</dd></div>}
            {data.is_voided && <div className="col-span-2 sm:col-span-3"><Badge tone="red">Voided</Badge> <span className="text-sm text-slate-600">{formatDateTime(data.voided_at, store)} by {data.voided_by_name}: {data.void_reason}</span></div>}
          </dl>
          <div>
            <h3 className="mb-2 text-sm font-semibold">Audit history</h3>
            <ol className="space-y-2">
              {data.history.map((h) => (
                <li key={h.id} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
                  <p className="text-xs text-slate-500">{formatDateTime(h.created_at, store)} · {h.user_name || 'System'} · <span className="capitalize">{h.action === 'insert' ? 'created' : h.action === 'update' ? 'edited' : h.action}</span></p>
                  {h.action === 'update' && (
                    <ul className="mt-1 text-xs">
                      {Object.keys(h.new_values || {}).filter((k) => !SKIP.has(k)).map((k) => (
                        <li key={k}><span className="text-slate-500">{k.replace(/_/g, ' ')}:</span> <s className="text-slate-400">{fmt(k, h.old_values?.[k])}</s> → <b>{fmt(k, h.new_values[k])}</b></li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </Modal>
  )
}

export default function ExpensesPage() {
  const { store, can } = useAuth()
  const toast = useToast()
  const manage = can('expenses.manage')
  const [f, setF] = useState({ search: '', category: '', from: '', to: '', include_voided: false, page: 1 })
  const search = useDebounced(f.search)
  const query = { ...f, search, include_voided: f.include_voided ? 'true' : undefined, pageSize: 20 }
  const list = useApi('/expenses', query)
  const [form, setForm] = useState({ open: false, expense: null })
  const [detail, setDetail] = useState(null)
  const [voiding, setVoiding] = useState(null)
  const [voidReason, setVoidReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value, page: 1 }))
  const m = (v) => formatMoney(v, store.currency)

  async function doVoid() {
    if (!voidReason.trim()) return toast.error('Enter a reason')
    setBusy(true)
    try {
      await api.del(`/expenses/${voiding.id}`, { reason: voidReason.trim() })
      toast.success('Expense voided')
      setVoiding(null); setVoidReason(''); list.reload()
    } catch (err) { toast.error(err) } finally { setBusy(false) }
  }

  return (
    <div>
      <PageHeader title="Expenses" description="Track operating costs. Voided expenses are kept for auditing."
        actions={<>
          <Button variant="secondary" icon={Download} loading={exporting} onClick={async () => {
            setExporting(true)
            try { await api.download('/expenses/export', { ...query, page: undefined, pageSize: undefined }, 'expenses.csv') } catch (err) { toast.error(err) } finally { setExporting(false) }
          }}>Export</Button>
          {manage && <Button icon={Plus} onClick={() => setForm({ open: true, expense: null })}>Add Expense</Button>}
        </>} />
      <div className="rounded-md border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
          <div className="relative min-w-44 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-slate-400" />
            <input className="input pl-8" placeholder="Search description or reference" value={f.search} onChange={set('search')} aria-label="Search expenses" />
          </div>
          <select className="input w-auto" value={f.category} onChange={set('category')} aria-label="Category">
            <option value="">All categories</option>
            {EXPENSE_CATEGORIES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input type="date" className="input w-auto" value={f.from} onChange={set('from')} aria-label="From date" />
          <input type="date" className="input w-auto" value={f.to} onChange={set('to')} aria-label="To date" />
          <Checkbox label="Show voided" checked={f.include_voided} onChange={(e) => setF((x) => ({ ...x, include_voided: e.target.checked, page: 1 }))} />
        </div>
        {list.meta && <div className="border-b border-slate-200 px-3 py-2 text-sm text-slate-600">Total (excluding voided): <b className="text-slate-900 tabular-nums">{m(list.meta.totalAmount)}</b></div>}
        {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : !list.data ? <PageLoader /> : !list.data.length ? (
          <EmptyState title="No expenses found" action={manage && <Button icon={Plus} onClick={() => setForm({ open: true, expense: null })}>Add Expense</Button>} />
        ) : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Date</th><th>Description</th><th className="hidden sm:table-cell">Category</th><th className="num">Amount</th><th className="hidden md:table-cell">Payment</th><th className="hidden lg:table-cell">Recorded By</th><th className="w-28"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {list.data.map((x) => (
                  <tr key={x.id} className={x.is_voided ? 'text-slate-400' : ''}>
                    <td className="whitespace-nowrap">{formatDate(x.expense_date, store)}</td>
                    <td><span className={x.is_voided ? 'line-through' : 'font-medium'}>{x.description}</span> {x.is_voided && <Badge tone="red">Voided</Badge>}{x.reference_number && <span className="block text-xs text-slate-500">Ref: {x.reference_number}</span>}</td>
                    <td className="hidden sm:table-cell">{CAT[x.category]}</td>
                    <td className="num font-medium">{m(x.amount)}</td>
                    <td className="hidden md:table-cell">{PAYMENT_LABELS[x.payment_method]}</td>
                    <td className="hidden lg:table-cell">{x.recorded_by_name}</td>
                    <td className="whitespace-nowrap text-right">
                      <IconButton icon={Eye} label="View details" onClick={() => setDetail(x.id)} />
                      {manage && !x.is_voided && <>
                        <IconButton icon={Pencil} label="Edit expense" onClick={() => setForm({ open: true, expense: x })} />
                        <IconButton icon={Ban} label="Void expense" className="hover:text-red-600" onClick={() => { setVoiding(x); setVoidReason('') }} />
                      </>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        <Pagination meta={list.meta} onPage={(page) => setF((x) => ({ ...x, page }))} />
      </div>
      <ExpenseForm open={form.open} expense={form.expense} onClose={() => setForm({ open: false, expense: null })} onSaved={() => { setForm({ open: false, expense: null }); list.reload() }} />
      <ExpenseDetail id={detail} onClose={() => setDetail(null)} />
      <ConfirmDialog open={Boolean(voiding)} title="Void expense?" confirmLabel="Void Expense" loading={busy} onClose={() => setVoiding(null)} onConfirm={doVoid}
        message={`"${voiding?.description}" (${voiding ? m(voiding.amount) : ''}) will be excluded from totals. The record is kept for auditing.`}>
        <Textarea className="mt-3" label="Reason" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} maxLength={300} />
      </ConfirmDialog>
    </div>
  )
}
