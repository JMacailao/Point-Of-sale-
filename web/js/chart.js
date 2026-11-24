import { esc } from './util.js'

function niceStep(v) {
  const raw = Math.max(v, 1) / 4
  const p = 10 ** Math.floor(Math.log10(raw))
  for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p
  return 10 * p
}

/**
 * Single-series line chart (one hue, no legend) with crosshair + tooltip.
 * data: [{ label, longLabel, value, sub }]
 */
export function renderLineChart(container, data, { formatValue, formatTick, ariaLabel, height = 230 }) {
  const step = niceStep(Math.max(0, ...data.map((d) => d.value)))
  const max = step * 4
  const W = 640, pad = { l: 52, r: 14, t: 12, b: 26 }
  const iw = W - pad.l - pad.r, ih = height - pad.t - pad.b
  const n = data.length
  const xAt = (i) => pad.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw)
  const yAt = (v) => pad.t + ih - (v / max) * ih
  const every = Math.ceil(n / 8)
  let svg = ''
  for (let t = 0; t <= 4; t++) {
    const y = pad.t + ih - (t / 4) * ih
    svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}" stroke="#e3ebe5"/><text x="${pad.l - 8}" y="${y + 3}" text-anchor="end" font-size="10" fill="#66756b">${esc(formatTick(t * step))}</text>`
  }
  const pts = data.map((d, i) => [xAt(i), yAt(d.value)])
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  if (n > 1) svg += `<path d="${line} L${pts[n - 1][0]},${pad.t + ih} L${pts[0][0]},${pad.t + ih} Z" fill="#16a34a" opacity=".08"/>`
  svg += `<path d="${line}" fill="none" stroke="#16a34a" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`
  data.forEach((d, i) => {
    if (i % every === 0 || n <= 8) svg += `<text x="${xAt(i)}" y="${height - 8}" text-anchor="middle" font-size="10" fill="#66756b">${esc(d.label)}</text>`
  })
  if (n <= 31) pts.forEach(([x, y]) => { svg += `<circle cx="${x}" cy="${y}" r="4" fill="#16a34a" stroke="#fff" stroke-width="2"/>` })
  svg += `<line class="cross" x1="0" x2="0" y1="${pad.t}" y2="${pad.t + ih}" stroke="#98a69d" stroke-dasharray="3 3" visibility="hidden"/>
    <circle class="dot" r="5" fill="#15803d" stroke="#fff" stroke-width="2" visibility="hidden"/>
    <rect class="hit" x="${pad.l}" y="${pad.t}" width="${iw}" height="${ih}" fill="transparent"/>`
  container.innerHTML = `<div class="chart"><svg viewBox="0 0 ${W} ${height}" role="img" aria-label="${esc(ariaLabel)}">${svg}</svg><div class="tip" hidden></div></div>`
  const svgEl = container.querySelector('svg'), tip = container.querySelector('.tip')
  const cross = svgEl.querySelector('.cross'), dot = svgEl.querySelector('.dot')
  const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden') }
  const move = (e) => {
    const r = svgEl.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * W
    const i = n <= 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((x - pad.l) / iw) * (n - 1))))
    const [px, py] = pts[i], d = data[i]
    cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible')
    dot.setAttribute('cx', px); dot.setAttribute('cy', py); dot.setAttribute('visibility', 'visible')
    tip.innerHTML = `<div class="muted">${esc(d.longLabel)}</div><div class="bold tabular">${esc(formatValue(d.value))}</div>${d.sub ? `<div class="muted">${esc(d.sub)}</div>` : ''}`
    tip.style.left = `${Math.min(85, Math.max(12, (px / W) * 100))}%`
    tip.hidden = false
  }
  const hit = svgEl.querySelector('.hit')
  hit.addEventListener('pointermove', move)
  hit.addEventListener('pointerdown', move)
  hit.addEventListener('pointerleave', hide)
}
