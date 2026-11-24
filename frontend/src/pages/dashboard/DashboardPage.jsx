import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useApi } from '../../hooks/useApi'
import { BarChart } from '../../components/BarChart'
import { DateRangeFilter, rangeFor } from '../../components/DateRangeFilter'
import { Badge, ErrorState, PageHeader, PageLoader, Panel, Stat, StatRow, EmptyState, TableWrap } from '../../components/ui'
import { formatDate, formatMoney, formatNumber, formatTime, PAYMENT_LABELS } from '../../utils/format'

const RANGE_LABEL = { today: 'Today', '7d': 'Last 7 days', month: 'This month', custom: 'Selected range' }

export default function DashboardPage() {
  const { store, can, user } = useAuth()
  const [range, setRange] = useState(() => ({ preset: 'today', ...rangeFor('today', store.timezone) }))
  const { data, error, loading, reload } = useApi('/dashboard/summary', { from: range.from, to: range.to })
  const m = (v) => formatMoney(v, store.currency)
  const label = RANGE_LABEL[range.preset]

  return (
    <div>
      <PageHeader title="Dashboard"
        description={data?.scope === 'own' ? `Your sales, ${user.fullName || user.email}` : store.store_name}
        actions={<DateRangeFilter value={range} onChange={setRange} tz={store.timezone} />} />

      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <PageLoader /> : (
        <div className={loading ? 'opacity-60 transition-opacity' : ''}>
          <StatRow>
            <Stat label={`Total Sales · ${label}`} value={m(data.total_sales)} sub={data.refunded_count ? `${data.refunded_count} refunded` : null} />
            <Stat label={`Transactions · ${label}`} value={formatNumber(data.transactions)} sub={`${formatNumber(data.items_sold)} items sold`} />
            <Stat label="Total Products" value={formatNumber(data.total_products)} sub="active" />
            <Stat label="Low Stock Products" value={formatNumber(data.low_stock_count)} tone={data.low_stock_count > 0 ? 'red' : undefined}
              sub={data.low_stock_count > 0 ? 'at or below minimum' : 'all stocked'} />
          </StatRow>

          {store.low_stock_alerts && data.low_stock_count > 0 && can('inventory.view') && (
            <div className="mb-4 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <AlertTriangle className="size-4 shrink-0" />
              <span>{data.low_stock_count} product{data.low_stock_count > 1 ? 's are' : ' is'} low on stock.</span>
              <Link to="/inventory?filter=low" className="ml-auto font-medium text-amber-900 underline">Review stock</Link>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="Sales Overview" className="lg:col-span-2" bodyClassName="p-3">
              {data.series.length <= 1 ? (
                <div className="flex h-[220px] flex-col items-center justify-center text-center">
                  <p className="text-3xl font-semibold tabular-nums">{m(data.total_sales)}</p>
                  <p className="mt-1 text-sm text-slate-500">{data.transactions} transactions on {formatDate(range.from, store)}</p>
                  <p className="mt-2 text-xs text-slate-400">Choose a longer range to see the daily trend.</p>
                </div>
              ) : (
                <BarChart data={data.series} valueKey="total" labelKey="date" ariaLabel="Daily sales"
                  formatValue={m}
                  formatTick={(v) => (v >= 1000 ? `₱${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k` : `₱${v}`)}
                  formatLabel={(d, long) => (long ? formatDate(d, store) : formatDate(d, store).slice(0, 5))} />
              )}
            </Panel>

            <Panel title="Best-Selling Products">
              {!data.best_sellers.length ? <EmptyState title="No sales yet" message="Best sellers appear once sales are recorded." /> : (
                <ol className="divide-y divide-slate-100">
                  {data.best_sellers.map((p, i) => (
                    <li key={p.product_id} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <span className="w-4 text-xs text-slate-400">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate">{p.product_name}</span>
                      <span className="text-xs text-slate-500">{p.quantity} sold</span>
                      <span className="w-24 text-right tabular-nums">{m(p.revenue)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>
          </div>

          <Panel title="Recent Sales" className="mt-4" actions={<Link to="/sales" className="text-xs text-blue-600 hover:underline">View all</Link>}>
            {!data.recent_sales.length ? <EmptyState title="No sales in this period" /> : (
              <TableWrap>
                <table className="table">
                  <thead><tr><th>Transaction</th><th>Time</th><th className="hidden sm:table-cell">Cashier</th><th className="hidden sm:table-cell">Payment</th><th className="num">Total</th></tr></thead>
                  <tbody>
                    {data.recent_sales.map((s) => (
                      <tr key={s.id}>
                        <td className="font-medium whitespace-nowrap">{s.transaction_number} {s.status === 'refunded' && <Badge tone="red">Refunded</Badge>}</td>
                        <td className="whitespace-nowrap text-slate-600">{formatDate(s.created_at, store)} {formatTime(s.created_at, store)}</td>
                        <td className="hidden text-slate-600 sm:table-cell">{s.cashier_name || s.cashier_email}</td>
                        <td className="hidden sm:table-cell">{PAYMENT_LABELS[s.payment_method]}</td>
                        <td className="num font-medium">{m(s.total_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Panel>
        </div>
      )}
    </div>
  )
}
