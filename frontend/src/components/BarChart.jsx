import { useMemo, useState } from 'react'

/** Round tick step so the 4 gridlines land on whole, readable values. */
function niceStep(v) {
  const raw = Math.max(v, 1) / 4
  const p = 10 ** Math.floor(Math.log10(raw))
  for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p
  return 10 * p
}

/**
 * Single-series bar chart (one hue, no legend). Hovering/tapping a bar shows a
 * tooltip; values are in text ink, never the series color.
 */
export function BarChart({ data, valueKey, labelKey, formatValue, formatLabel, formatTick, height = 220, ariaLabel }) {
  const [hover, setHover] = useState(null)
  const step = useMemo(() => niceStep(Math.max(0, ...data.map((d) => Number(d[valueKey]) || 0))), [data, valueKey])
  const max = step * 4
  const ticks = [0, 1, 2, 3, 4].map((t) => t * step)
  const n = data.length
  const W = 640
  const pad = { l: 56, r: 8, t: 8, b: 24 }
  const iw = W - pad.l - pad.r
  const ih = height - pad.t - pad.b
  const slot = iw / Math.max(1, n)
  const barW = Math.max(2, Math.min(28, slot - 2))
  const labelEvery = Math.ceil(n / 8)

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${height}`} className="h-auto w-full" role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => {
          const y = pad.t + ih - (t / max) * ih
          return (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y} y2={y} stroke="#e2e8f0" strokeWidth="1" />
              <text x={pad.l - 6} y={y + 3} textAnchor="end" fontSize="10" fill="#64748b">{formatTick ? formatTick(t) : t}</text>
            </g>
          )
        })}
        {data.map((d, i) => {
          const v = Number(d[valueKey]) || 0
          const h = (v / max) * ih
          const x = pad.l + i * slot + (slot - barW) / 2
          const y = pad.t + ih - h
          const r = Math.min(4, barW / 2, h)
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}>
              <rect x={pad.l + i * slot} y={pad.t} width={slot} height={ih} fill="transparent" />
              {h > 0 && (
                <path fill={hover === i ? '#1d4ed8' : '#2563eb'}
                  d={`M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${y + h} Z`} />
              )}
              {(i % labelEvery === 0 || n <= 8) && (
                <text x={pad.l + i * slot + slot / 2} y={height - 8} textAnchor="middle" fontSize="10" fill="#64748b">
                  {formatLabel ? formatLabel(d[labelKey]) : d[labelKey]}
                </text>
              )}
            </g>
          )
        })}
        <line x1={pad.l} x2={W - pad.r} y1={pad.t + ih} y2={pad.t + ih} stroke="#cbd5e1" strokeWidth="1" />
      </svg>
      {hover !== null && data[hover] && (
        <div className="pointer-events-none absolute top-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-md"
          style={{ left: `${Math.min(80, Math.max(8, ((pad.l + hover * slot + slot / 2) / W) * 100))}%`, transform: 'translateX(-50%)' }}>
          <p className="text-slate-500">{formatLabel ? formatLabel(data[hover][labelKey], true) : data[hover][labelKey]}</p>
          <p className="font-semibold text-slate-900 tabular-nums">{formatValue(data[hover][valueKey])}</p>
          {data[hover].transactions !== undefined && <p className="text-slate-500">{data[hover].transactions} transactions</p>}
        </div>
      )}
    </div>
  )
}
