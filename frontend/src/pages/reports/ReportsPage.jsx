import { useState } from 'react'
import { Download } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { useApi } from '../../hooks/useApi'
import { api } from '../../services/api'
import { DateRangeFilter, rangeFor } from '../../components/DateRangeFilter'
import { Button, EmptyState, ErrorState, PageHeader, PageLoader, Panel, Stat, StatRow, Tabs, TableWrap, Badge } from '../../components/ui'
import { EXPENSE_CATEGORIES, formatDate, formatMoney, formatNumber, MOVEMENT_LABELS, PAYMENT_LABELS } from '../../utils/format'

const GROUPS = [['day', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly'], ['year', 'Annual']]
const CAT = Object.fromEntries(EXPENSE_CATEGORIES)

function periodLabel(p, group, store) {
  if (group === 'year') return p.slice(0, 4)
  if (group === 'month') return new Date(`${p}T00:00:00Z`).toLocaleDateString('en-PH', { month: 'short', year: 'numeric', timeZone: 'UTC' })
  if (group === 'week') return `Week of ${formatDate(p, store)}`
  return formatDate(p, store)
}

function SalesReport() {
  const { store } = useAuth()
  const toast = useToast()
  const [range, setRange] = useState(() => ({ preset: 'month', ...rangeFor('month', store.timezone) }))
  const [group, setGroup] = useState('day')
  const { data, error, loading, reload } = useApi('/reports/sales', { from: range.from, to: range.to, group })
  const [exporting, setExporting] = useState(false)
  const m = (v) => formatMoney(v, store.currency)
  const t = data?.totals

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <DateRangeFilter value={range} onChange={setRange} tz={store.timezone}
          presets={[['today', 'Today'], ['7d', 'Last 7 Days'], ['month', 'This Month'], ['30d', 'Last 30 Days'], ['custom', 'Custom']]} />
        <select className="input h-8 w-auto" value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Group by">
          {GROUPS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <Button className="ml-auto" size="sm" variant="secondary" icon={Download} loading={exporting} onClick={async () => {
          setExporting(true)
          try { await api.download('/reports/sales/export', { from: range.from, to: range.to, group }, 'sales-report.csv') } catch (err) { toast.error(err) } finally { setExporting(false) }
        }}>Export CSV</Button>
      </div>
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <PageLoader /> : (
        <div className={loading ? 'opacity-60' : ''}>
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Revenue</h2>
          <StatRow cols={5}>
            <Stat label="Gross Sales" value={m(t.gross_sales)} sub={`${formatNumber(t.transactions + t.refund_count)} transactions`} />
            <Stat label="Discounts" value={m(t.discounts)} />
            <Stat label="Refunds" value={m(t.refunds)} sub={`${t.refund_count} refunded`} />
            <Stat label="Net Sales" value={m(t.net_sales)} sub={`${formatNumber(t.transactions)} completed`} />
            <Stat label="Tax collected" value={m(t.tax)} />
          </StatRow>
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Profit</h2>
          <StatRow cols={5}>
            <Stat label="Revenue (ex. tax)" value={m(t.revenue_ex_tax)} />
            <Stat label="Cost of Goods Sold" value={m(t.cost_of_goods)} sub="cost at time of sale" />
            <Stat label="Gross Profit" value={m(t.gross_profit)} tone={t.gross_profit < 0 ? 'red' : 'green'}
              sub={t.revenue_ex_tax ? `${((t.gross_profit / t.revenue_ex_tax) * 100).toFixed(1)}% margin` : null} />
            <Stat label="Expenses" value={m(t.expenses)} />
            <Stat label="Net Profit" value={m(t.net_profit)} tone={t.net_profit < 0 ? 'red' : 'green'} />
          </StatRow>

          <Panel title={`${GROUPS.find((g) => g[0] === group)[1]} breakdown`} className="mb-4">
            {!data.rows.length ? <EmptyState title="No sales or expenses in this period" /> : (
              <TableWrap>
                <table className="table">
                  <thead><tr><th>Period</th><th className="num">Txns</th><th className="num">Gross</th><th className="num hidden sm:table-cell">Discounts</th><th className="num hidden sm:table-cell">Refunds</th><th className="num">Net Sales</th><th className="num hidden md:table-cell">COGS</th><th className="num hidden md:table-cell">Gross Profit</th><th className="num hidden lg:table-cell">Expenses</th><th className="num">Net Profit</th></tr></thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r.period}>
                        <td className="whitespace-nowrap">{periodLabel(r.period, group, store)}</td>
                        <td className="num">{r.transactions}</td>
                        <td className="num">{m(r.gross_sales)}</td>
                        <td className="num hidden sm:table-cell">{m(r.discounts)}</td>
                        <td className="num hidden sm:table-cell">{m(r.refunds)}</td>
                        <td className="num font-medium">{m(r.net_sales)}</td>
                        <td className="num hidden md:table-cell">{m(r.cost_of_goods)}</td>
                        <td className="num hidden md:table-cell">{m(r.gross_profit)}</td>
                        <td className="num hidden lg:table-cell">{m(r.expenses)}</td>
                        <td className={`num font-medium ${r.net_profit < 0 ? 'text-red-600' : ''}`}>{m(r.net_profit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Top Products">
              {!data.top_products.length ? <EmptyState title="No sales" /> : (
                <TableWrap><table className="table"><thead><tr><th>Product</th><th className="num">Qty</th><th className="num">Revenue</th><th className="num">Profit</th></tr></thead>
                  <tbody>{data.top_products.map((p) => <tr key={p.product_id}><td>{p.product_name}</td><td className="num">{p.quantity}</td><td className="num">{m(p.revenue)}</td><td className="num">{m(p.profit)}</td></tr>)}</tbody></table></TableWrap>
              )}
            </Panel>
            <div className="space-y-4">
              <Panel title="Payment Methods">
                {!data.payment_methods.length ? <EmptyState title="No sales" /> : (
                  <table className="table"><thead><tr><th>Method</th><th className="num">Txns</th><th className="num">Total</th></tr></thead>
                    <tbody>{data.payment_methods.map((p) => <tr key={p.payment_method}><td>{PAYMENT_LABELS[p.payment_method]}</td><td className="num">{p.transactions}</td><td className="num">{m(p.total)}</td></tr>)}</tbody></table>
                )}
              </Panel>
              <Panel title="Sales by Cashier">
                {!data.cashiers.length ? <EmptyState title="No sales" /> : (
                  <table className="table"><thead><tr><th>Cashier</th><th className="num">Txns</th><th className="num">Net Sales</th></tr></thead>
                    <tbody>{data.cashiers.map((c) => <tr key={c.cashier_id}><td>{c.cashier_name}</td><td className="num">{c.transactions}</td><td className="num">{m(c.total)}</td></tr>)}</tbody></table>
                )}
              </Panel>
              <Panel title="Expenses by Category">
                {!data.expense_categories.length ? <EmptyState title="No expenses" /> : (
                  <table className="table"><thead><tr><th>Category</th><th className="num">Entries</th><th className="num">Total</th></tr></thead>
                    <tbody>{data.expense_categories.map((c) => <tr key={c.category}><td>{CAT[c.category]}</td><td className="num">{c.count}</td><td className="num">{m(c.total)}</td></tr>)}</tbody></table>
                )}
              </Panel>
            </div>
          </div>
          <p className="mt-4 text-xs text-slate-500">Net Sales = amounts of completed (non-refunded) sales. Revenue excludes tax. Profit uses product cost snapshots recorded at the time of each sale. Refunds are reported in the period of the original sale.</p>
        </div>
      )}
    </>
  )
}

function InventoryReport() {
  const { store } = useAuth()
  const [range, setRange] = useState(() => ({ preset: 'month', ...rangeFor('month', store.timezone) }))
  const { data, error, reload } = useApi('/reports/inventory', { from: range.from, to: range.to })
  const m = (v) => formatMoney(v, store.currency)
  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!data) return <PageLoader />
  const totals = data.valuation.reduce((a, r) => ({ units: a.units + Number(r.units), cost: a.cost + Number(r.value_cost), retail: a.retail + Number(r.value_retail) }), { units: 0, cost: 0, retail: 0 })
  return (
    <div className="space-y-4">
      <StatRow cols={3}>
        <Stat label="Units on hand" value={formatNumber(totals.units)} />
        <Stat label="Stock value at cost" value={m(totals.cost)} />
        <Stat label="Stock value at retail" value={m(totals.retail)} />
      </StatRow>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Valuation by Category">
          {!data.valuation.length ? <EmptyState title="No products" /> : (
            <TableWrap><table className="table"><thead><tr><th>Category</th><th className="num">Products</th><th className="num">Units</th><th className="num">Cost Value</th></tr></thead>
              <tbody>{data.valuation.map((r) => <tr key={r.category}><td>{r.category}</td><td className="num">{r.products}</td><td className="num">{formatNumber(r.units)}</td><td className="num">{m(r.value_cost)}</td></tr>)}</tbody></table></TableWrap>
          )}
        </Panel>
        <Panel title="Low Stock">
          {!data.lowStock.length ? <EmptyState title="No low-stock products" /> : (
            <TableWrap><table className="table"><thead><tr><th>Product</th><th className="num">Stock</th><th className="num">Minimum</th></tr></thead>
              <tbody>{data.lowStock.map((p) => <tr key={p.id}><td>{p.name}<span className="block text-xs text-slate-500">{p.sku}</span></td><td className="num">{p.stock_quantity === 0 ? <Badge tone="red">0</Badge> : p.stock_quantity}</td><td className="num">{p.minimum_stock}</td></tr>)}</tbody></table></TableWrap>
          )}
        </Panel>
      </div>
      <Panel title="Stock Movement Summary" actions={<DateRangeFilter value={range} onChange={setRange} tz={store.timezone}
        presets={[['7d', '7 Days'], ['month', 'This Month'], ['30d', '30 Days'], ['custom', 'Custom']]} />}>
        {!data.movements.length ? <EmptyState title="No stock movements in this period" /> : (
          <table className="table"><thead><tr><th>Movement Type</th><th className="num">Movements</th><th className="num">Net Quantity</th></tr></thead>
            <tbody>{data.movements.map((r) => <tr key={r.movement_type}><td>{MOVEMENT_LABELS[r.movement_type]}</td><td className="num">{r.count}</td><td className={`num ${r.net_quantity < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{r.net_quantity > 0 ? '+' : ''}{r.net_quantity}</td></tr>)}</tbody></table>
        )}
      </Panel>
    </div>
  )
}

export default function ReportsPage() {
  const [tab, setTab] = useState('sales')
  return (
    <div>
      <PageHeader title="Reports" description="Revenue, profit and stock reports from live data." />
      <Tabs tabs={[['sales', 'Sales & Profit'], ['inventory', 'Inventory']]} value={tab} onChange={setTab} />
      {tab === 'sales' ? <SalesReport /> : <InventoryReport />}
    </div>
  )
}
