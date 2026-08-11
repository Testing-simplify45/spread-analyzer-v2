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

  const timestamps  = data.map(d => d.timestamp)
  const spreads     = data.map(d => d.spread)
  const spreadHigh  = data.map(d => d.spread_high ?? d.spread)
  const spreadLow   = data.map(d => d.spread_low  ?? d.spread)

  // Smart Y-axis range
  const allY   = [...spreads, ...spreadHigh, ...spreadLow].filter(v => v != null)
  const yMin   = Math.min(...allY)
  const yMax   = Math.max(...allY)
  const yRange = Math.max(yMax - yMin, 1)
  const pad    = yRange * 0.07
  const yLo    = yMin - pad
  const yHi    = yMax + pad

  // Market hours X range
  const firstTs = timestamps[0]
  const dayStr  = firstTs ? firstTs.split(' ')[0] : ''
  const xMin    = dayStr ? `${dayStr} 09:10:00` : null
  const xMax    = dayStr ? `${dayStr} 15:35:00` : null

  // Build traces
  const traces = []

  if (type === 'candlestick') {
    // Group into candles by resolution
    const minutes = resolution === '5min' ? 5 : resolution === '15min' ? 15 : 1
    const grouped = groupIntoCandles(data, minutes)

    traces.push({
      type:  'candlestick',
      x:     grouped.map(c => c.time),
      open:  grouped.map(c => c.open),
      high:  grouped.map(c => c.high),
      low:   grouped.map(c => c.low),
      close: grouped.map(c => c.close),
      increasing: { line: { color: COLORS.emerald } },
      decreasing: { line: { color: COLORS.crimson } },
      name: 'Spread',
    })
  } else {
    traces.push({
      type: 'scatter',
      mode: 'lines',
      x:    timestamps,
      y:    spreads,
      name: 'Spread',
      line: { color: COLORS.cyan, width: 2, shape: 'spline' },
      hovertemplate: '<b>%{x}</b><br>Spread: <b>%{y:.2f}</b><extra></extra>',
    })
  }

  // H/L/O reference lines
  const shapes = []
  const annotations = []

  if (stats?.high != null) {
    shapes.push({ type: 'line', x0: 0, x1: 1, xref: 'paper', y0: stats.high, y1: stats.high,
      line: { color: COLORS.emerald, width: 1, dash: 'dash' } })
    annotations.push({ x: 1, xref: 'paper', y: stats.high, text: `H ${stats.high.toFixed(2)}`,
      showarrow: false, xanchor: 'left', font: { color: COLORS.emerald, size: 10 }, xshift: 8 })
  }
  if (stats?.low != null) {
    shapes.push({ type: 'line', x0: 0, x1: 1, xref: 'paper', y0: stats.low, y1: stats.low,
      line: { color: COLORS.crimson, width: 1, dash: 'dash' } })
    annotations.push({ x: 1, xref: 'paper', y: stats.low, text: `L ${stats.low.toFixed(2)}`,
      showarrow: false, xanchor: 'left', font: { color: COLORS.crimson, size: 10 }, xshift: 8 })
  }
  if (stats?.open != null) {
    shapes.push({ type: 'line', x0: 0, x1: 1, xref: 'paper', y0: stats.open, y1: stats.open,
      line: { color: COLORS.amber, width: 1, dash: 'longdash' } })
    annotations.push({ x: 1, xref: 'paper', y: stats.open, text: `O ${stats.open.toFixed(2)}`,
      showarrow: false, xanchor: 'left', font: { color: COLORS.amber, size: 10 }, xshift: 8 })
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

// Historical daily candlestick chart
export function HistoricalChart({ data, title }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[280px] bg-panel rounded-xl border border-edge">
        <p className="text-ink font-mono text-sm">No historical data — click Load History</p>
      </div>
    )
  }

  // Group by date for daily OHLC
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

  const allY   = [...high, ...low].filter(v => v != null)
  const yMin   = Math.min(...allY)
  const yMax   = Math.max(...allY)
  const yRange = Math.max(yMax - yMin, 1)
  const pad    = yRange * 0.07

  const layout = {
    title: { text: title, font: { size: 12, color: COLORS.bright }, x: 0.01 },
    height: 280,
    plot_bgcolor:  COLORS.panel,
    paper_bgcolor: '#06080f',
    font: { color: COLORS.ink, size: 11 },
    margin: { l: 55, r: 30, t: 40, b: 45 },
    xaxis: { gridcolor: COLORS.edge, rangeslider: { visible: false } },
    yaxis: { gridcolor: COLORS.edge, range: [yMin - pad, yMax + pad], autorange: false },
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

// Helper: group tick data into OHLC candles
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
