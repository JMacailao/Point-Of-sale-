import { addDays, startOfMonth, todayIn } from '../utils/format'

export function rangeFor(preset, tz) {
  const today = todayIn(tz)
  switch (preset) {
    case '7d': return { from: addDays(today, -6), to: today }
    case 'month': return { from: startOfMonth(today), to: today }
    case '30d': return { from: addDays(today, -29), to: today }
    default: return { from: today, to: today }
  }
}

/** Preset buttons + custom date range, in one row. */
export function DateRangeFilter({ value, onChange, tz, presets = [['today', 'Today'], ['7d', 'Last 7 Days'], ['month', 'This Month'], ['custom', 'Custom']] }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex overflow-hidden rounded-md border border-slate-300" role="group" aria-label="Date range">
        {presets.map(([k, label]) => (
          <button key={k} onClick={() => onChange(k === 'custom' ? { ...value, preset: 'custom' } : { preset: k, ...rangeFor(k, tz) })}
            className={`border-r border-slate-300 px-2.5 py-1.5 text-xs font-medium last:border-r-0 ${value.preset === k ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
            {label}
          </button>
        ))}
      </div>
      {value.preset === 'custom' && (
        <div className="flex items-center gap-1.5">
          <input type="date" className="input h-8 w-auto" value={value.from} max={value.to} aria-label="From date"
            onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} />
          <span className="text-xs text-slate-500">to</span>
          <input type="date" className="input h-8 w-auto" value={value.to} min={value.from} aria-label="To date"
            onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} />
        </div>
      )}
    </div>
  )
}
