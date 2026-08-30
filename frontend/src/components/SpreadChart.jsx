import Plot from 'react-plotly.js'

const COLORS = {
  cyan:    '#00cbd6',
  emerald: '#00c676',
  crimson: '#ff5252',
  amber:   '#d29922',
  panel:   '#0e1220',
  edge:    '#1e263d',
  ink:     '#8b92a8',
  bright:  '#f1f3f9',
}

export default function SpreadChart({ data, stats, title, type = 'line', resolution = '1min' }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[380px] bg-panel rounded-xl border border-edge">
        <p className="text-ink font-mono text-sm">No data available</p>
      </div>
    )
  }

  const timestamps = data.map(d => d.timestamp)
  const spreads    = data.map(d => d.spread)

  // ── Compute H/L/O from ACTUAL spread close values only ───────────────────
  const yMin    = Math.min(...spreads)
  const yMax    = Math.max(...spreads)
  const yRange  = Math.max(yMax - yMin, 1)
  const pad     = yRange * 0.07
  const yLo     = yMin - pad
  const yHi     = yMax + pad

  const dayOpen  = spreads[0]
  const dayHigh  = yMax
  const dayLow   = yMin
  const dayCurrent = spreads[spreads.length - 1]

  // Market hours X range
  const firstTs = timestamps[0]
  const dayStr  = firstTs ? firstTs.split(' ')[0] : ''
  const xMin    = dayStr ? `${dayStr} 09:10:00` : null
  const xMax    = dayStr ? `${dayStr} 15:35:00` : null

  // ── H/L/O reference lines ─────────────────────────────────────────────────
  const shapes      = []
  const annotations = []

  shapes.push({ type: 'line', x0: 0, x1: 1, xref: 'paper', y0: dayHigh, y1: dayHigh,
    line: { color: COLORS.emerald, width: 1, dash: 'dash' } })
  annotations.push({ x: 1, xref: 'paper', y: dayHigh,
    text: `H ${dayHigh.toFixed(2)}`, showarrow: false,
    xanchor: 'left', font: { color: COLORS.emerald, size: 10 }, xshift: 8 })

  shapes.push({ type: 'line', x0: 0, x1: 1, xref: 'paper', y0: dayLow, y1: dayLow,
    line: { color: COLORS.crimson, width: 1, dash: 'dash' } })
  annotations.push({ x: 1, xref: 'paper', y: dayLow,
    text: `L ${dayLow.toFixed(2)}`, showarrow: false,
    xanchor: 'left', font: { color: COLORS.crimson, size: 10 }, xshift: 8 })

  shapes.push({ type: 'line', x0: 0, x1: 1, xref: 'paper', y0: dayOpen, y1: dayOpen,
    line: { color: COLORS.amber, width: 1, dash: 'longdash' } })
  annotations.push({ x: 1, xref: 'paper', y: dayOpen,
    text: `O ${dayOpen.toFixed(2)}`, showarrow: false,
    xanchor: 'left', font: { color: COLORS.amber, size: 10 }, xshift: 8 })

  // ── Build traces ──────────────────────────────────────────────────────────
  const traces = []

  if (type === 'candlestick') {
    const grouped = groupIntoCandles(data, resolutionToMinutes(resolution))
    if (grouped.length > 0) {
      // Recompute Y range from candle H/L
      const candleHighs = grouped.map(c => c.high)
      const candleLows  = grouped.map(c => c.low)
      const cMin = Math.min(...candleLows)
      const cMax = Math.max(...candleHighs)

      traces.push({
        type: 'candlestick',
        x:     grouped.map(c => c.time),
        open:  grouped.map(c => c.open),
        high:  grouped.map(c => c.high),
        low:   grouped.map(c => c.low),
        close: grouped.map(c => c.close),
        increasing: { line: { color: COLORS.emerald } },
        decreasing: { line: { color: COLORS.crimson } },
        name: 'Spread',
      })
    }
  } else {
    traces.push({
      type: 'scatter',
      mode: 'lines',
      x:    timestamps,
      y:    spreads,
      name: 'Spread',
      line: { color: COLORS.cyan, width: 2, shape: 'spline' },
      hovertemplate: '<b>%{x|%H:%M}</b><br>Spread: <b>%{y:.2f}</b><extra></extra>',
    })
  }

  const layout = {
    title: { text: title, font: { size: 12, color: COLORS.bright }, x: 0.01 },
    height: 380,
    plot_bgcolor:  COLORS.panel,
    paper_bgcolor: '#06080f',
    font: { color: COLORS.ink, size: 11, family: 'JetBrains Mono' },
    margin: { l: 55, r: 90, t: 40, b: 45 },
    xaxis: {
      gridcolor: COLORS.edge,
      rangeslider: { visible: false },
      showspikes: true, spikecolor: COLORS.ink, spikemode: 'across', spikethickness: 1,
      tickformat: '%H:%M',
      range: xMin && xMax ? [xMin, xMax] : undefined,
    },
    yaxis: {
      gridcolor: COLORS.edge,
      showspikes: true, spikecolor: COLORS.ink,
      range: [yLo, yHi], autorange: false,
    },
    hovermode: 'x unified',
    shapes,
    annotations,
    legend: { bgcolor: COLORS.panel, bordercolor: COLORS.edge, borderwidth: 1,
      font: { color: COLORS.bright, size: 10 } },
    modebar: { bgcolor: COLORS.panel, color: COLORS.ink, activecolor: COLORS.cyan },
  }

  return (
    <Plot
      data={traces}
      layout={layout}
      config={{ scrollZoom: true, displayModeBar: true, responsive: true }}
      style={{ width: '100%' }}
    />
  )
}

// ── Historical daily OHLC chart ───────────────────────────────────────────────
export function HistoricalChart({ data, title }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[280px] bg-panel rounded-xl border border-edge">
        <p className="text-ink font-mono text-sm">No historical data — click Load History</p>
      </div>
    )
  }

  // Group by date for daily OHLC — use actual spread values
  const byDate = {}
  data.forEach(d => {
    const date = d.date || d.timestamp?.split(' ')[0] || d.timestamp?.split('T')[0]
    if (!byDate[date]) byDate[date] = []
    byDate[date].push(d.spread)
  })

  const dates  = Object.keys(byDate).sort()
  const open   = dates.map(d => byDate[d][0])
  const close  = dates.map(d => byDate[d][byDate[d].length - 1])
  const high   = dates.map(d => Math.max(...byDate[d]))
  const low    = dates.map(d => Math.min(...byDate[d]))

  // Smart Y range from actual candle data
  const allH  = [...high, ...low].filter(v => v != null)
  const yMin  = Math.min(...allH)
  const yMax  = Math.max(...allH)
  const yRng  = Math.max(yMax - yMin, 1)
  const padH  = yRng * 0.07

  const layout = {
    title: { text: title, font: { size: 12, color: COLORS.bright }, x: 0.01 },
    height: 280,
    plot_bgcolor:  COLORS.panel,
    paper_bgcolor: '#06080f',
    font: { color: COLORS.ink, size: 11 },
    margin: { l: 55, r: 30, t: 40, b: 45 },
    xaxis: { gridcolor: COLORS.edge, rangeslider: { visible: false } },
    yaxis: { gridcolor: COLORS.edge, range: [yMin - padH, yMax + padH], autorange: false },
    hovermode: 'x unified',
  }

  return (
    <Plot
      data={[{
        type: 'candlestick', x: dates,
        open, high, low, close,
        increasing: { line: { color: COLORS.emerald } },
        decreasing: { line: { color: COLORS.crimson } },
        name: 'Daily Spread',
      }]}
      layout={layout}
      config={{ scrollZoom: true, responsive: true }}
      style={{ width: '100%' }}
    />
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolutionToMinutes(resolution) {
  const map = { '1min': 1, '5min': 5, '15min': 15, '30min': 30 }
  return map[resolution] || 1
}

function groupIntoCandles(data, minutes) {
  const grouped = {}
  data.forEach(d => {
    const ts   = new Date(d.timestamp)
    const slot = Math.floor(ts.getTime() / (minutes * 60 * 1000)) * (minutes * 60 * 1000)
    if (!grouped[slot]) grouped[slot] = []
    grouped[slot].push(d.spread)
  })
  return Object.entries(grouped).sort(([a],[b]) => a-b).map(([ts, vals]) => ({
    time:  new Date(parseInt(ts)).toISOString().replace('T',' ').slice(0,19),
    open:  vals[0],
    high:  Math.max(...vals),
    low:   Math.min(...vals),
    close: vals[vals.length-1],
  }))
}
