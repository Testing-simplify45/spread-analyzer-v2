import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuthStore } from '../hooks/useAuthStore'
import { useNotificationStore } from '../hooks/useNotificationStore'
import { fetchStraddleTable, fetchIntradayStraddle } from '../utils/api'
import Plot from 'react-plotly.js'

const UNDERLYINGS = ['SENSEX', 'NIFTY', 'BANKNIFTY']
const THRESHOLD = { SENSEX: 30, NIFTY: 15, BANKNIFTY: 20 }

function fmtVal(v, decimals = 2) {
  if (v == null) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(decimals)}`
}

function ChangeChip({ value }) {
  if (value == null) return <span className="text-ink">—</span>
  const pos = value >= 0
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono font-semibold
      ${pos ? 'bg-emerald/10 text-emerald' : 'bg-crimson/10 text-crimson'}`}>
      {pos ? '▲' : '▼'} {Math.abs(value).toFixed(2)}
    </span>
  )
}

function IntradayChart({ data, stats, title, underlying }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[300px] text-ink font-mono text-sm">
        No intraday data available
      </div>
    )
  }

  const timestamps = data.map(d => d.timestamp)
  const straddles  = data.map(d => d.straddle)
  const yMin  = Math.min(...straddles)
  const yMax  = Math.max(...straddles)
  const pad   = Math.max((yMax - yMin) * 0.07, 1)
  const dayStr = timestamps[0]?.split(' ')[0] || ''
  const threshold = THRESHOLD[underlying] || 15

  const shapes = []
  const annotations = []

  if (stats?.low != null) {
    shapes.push({ type: 'line', x0: 0, x1: 1, xref: 'paper', y0: stats.low, y1: stats.low,
      line: { color: '#ff5252', width: 1, dash: 'dash' } })
    annotations.push({ x: 1, xref: 'paper', y: stats.low,
      text: `Low ${stats.low.toFixed(2)}`, showarrow: false,
      xanchor: 'left', xshift: 8, font: { color: '#ff5252', size: 10 } })

    // Alert line (low + threshold)
    const alertLine = stats.low + threshold
    shapes.push({ type: 'line', x0: 0, x1: 1, xref: 'paper', y0: alertLine, y1: alertLine,
      line: { color: '#d29922', width: 1, dash: 'dot' } })
    annotations.push({ x: 1, xref: 'paper', y: alertLine,
      text: `Alert +${threshold}`, showarrow: false,
      xanchor: 'left', xshift: 8, font: { color: '#d29922', size: 10 } })
  }
  if (stats?.open != null) {
    shapes.push({ type: 'line', x0: 0, x1: 1, xref: 'paper', y0: stats.open, y1: stats.open,
      line: { color: '#d29922', width: 1, dash: 'longdash' } })
    annotations.push({ x: 1, xref: 'paper', y: stats.open,
      text: `Open ${stats.open.toFixed(2)}`, showarrow: false,
      xanchor: 'left', xshift: 8, font: { color: '#d29922', size: 10 } })
  }

  return (
    <Plot
      data={[{
        type: 'scatter', mode: 'lines',
        x: timestamps, y: straddles,
        name: 'Straddle',
        line: { color: '#00cbd6', width: 2, shape: 'spline' },
        hovertemplate: '<b>%{x}</b><br>Straddle: <b>%{y:.2f}</b><extra></extra>',
      }]}
      layout={{
        title: { text: title, font: { size: 12, color: '#f1f3f9' }, x: 0.01 },
        height: 300,
        plot_bgcolor: '#0e1220', paper_bgcolor: '#06080f',
        font: { color: '#8b92a8', size: 11, family: 'JetBrains Mono' },
        margin: { l: 55, r: 90, t: 40, b: 45 },
        xaxis: {
          gridcolor: '#1e263d', rangeslider: { visible: false },
          tickformat: '%H:%M',
          range: dayStr ? [`${dayStr} 09:10:00`, `${dayStr} 15:35:00`] : undefined,
        },
        yaxis: {
          gridcolor: '#1e263d',
          range: [yMin - pad, yMax + pad], autorange: false,
        },
        shapes, annotations,
        hovermode: 'x unified',
      }}
      config={{ scrollZoom: true, responsive: true }}
      style={{ width: '100%' }}
    />
  )
}

function StraddleTable({ underlying, authHeader }) {
  const [data,         setData]         = useState([])
  const [loading,      setLoading]      = useState(false)
  const [spot,         setSpot]         = useState(null)
  const [atm,          setAtm]          = useState(null)
  const [selectedRow,  setSelectedRow]  = useState(null)
  const [chartData,    setChartData]    = useState([])
  const [chartStats,   setChartStats]   = useState(null)
  const [chartLoading, setChartLoading] = useState(false)
  const { addNotification } = useNotificationStore()
  const alertedRef = useRef(new Set())

  const loadTable = useCallback(async () => {
    setLoading(true)
    try {
      const result = await fetchStraddleTable(underlying, authHeader)
      setData(result.data || [])
      setSpot(result.spot)
      setAtm(result.atm)

      // Check alerts for each row
      result.data?.forEach(row => {
        if (row.today && row.yesterday) {
          const changeFromLow = row.today - Math.min(row.today, row.yesterday)
          const threshold = THRESHOLD[underlying] || 15
          const alertKey = `${underlying}-${row.expiry_code}-${Math.floor(Date.now() / 60000)}`

          if (changeFromLow >= threshold && !alertedRef.current.has(alertKey)) {
            alertedRef.current.add(alertKey)
            addNotification({
              type:      'straddle_alert',
              title:     `${underlying} Straddle Alert`,
              message:   `${row.expiry} straddle rose ${changeFromLow.toFixed(0)} pts above day low (${row.today?.toFixed(0)})`,
              underlying,
              expiry:    row.expiry,
            })
          }
        }
      })
    } catch (err) {
      console.error('Straddle table error:', err)
    } finally {
      setLoading(false)
    }
  }, [underlying, authHeader, addNotification])

  useEffect(() => { loadTable() }, [underlying])

  const handleViewChart = useCallback(async (row) => {
    setSelectedRow(row)
    setChartLoading(true)
    try {
      const result = await fetchIntradayStraddle(
        underlying, row.expiry_code, row.atm_strike, authHeader
      )
      setChartData(result.data || [])
      setChartStats(result.stats || null)

      // Check alert
      if (result.alert) {
        const alertKey = `chart-${underlying}-${row.expiry_code}-${Math.floor(Date.now() / 60000)}`
        if (!alertedRef.current.has(alertKey)) {
          alertedRef.current.add(alertKey)
          addNotification({
            type:    'straddle_alert',
            title:   `${underlying} Straddle Alert`,
            message: `${row.expiry} straddle is ${result.stats?.change_from_low?.toFixed(0)} pts above day low!`,
            underlying,
            expiry:  row.expiry,
          })
        }
      }
    } catch (err) {
      console.error('Intraday error:', err)
    } finally {
      setChartLoading(false)
    }
  }, [underlying, authHeader, addNotification])

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          {spot && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-panelLight border border-edge">
              <span className="text-[10px] font-mono text-ink uppercase">Spot</span>
              <span className="text-sm font-bold font-mono text-bright">{spot.toFixed(2)}</span>
              <span className="text-[10px] font-mono text-ink">ATM</span>
              <span className="text-sm font-bold font-mono text-cyan">{atm}</span>
            </div>
          )}
          <button onClick={loadTable} disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-cyan/10 border border-cyan/20 text-cyan text-xs font-semibold hover:bg-cyan/20 transition-all disabled:opacity-50">
            {loading
              ? <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
              : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.99"/></svg>
            }
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
        <span className="text-[10px] font-mono text-ink/60">
          Alert threshold: <span className="text-amber-400">+{THRESHOLD[underlying]}</span> pts above day low
        </span>
      </div>

      {/* Table */}
      <div className="bg-panel border border-edge rounded-2xl overflow-hidden mb-4">
        <table className="w-full">
          <thead>
            <tr className="border-b border-edge bg-panelLight/40">
              {['Expiry','ATM Strike','Yesterday Close','Today','Change','CE','PE','Chart'].map(h => (
                <th key={h} className="table-header text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.length === 0 && !loading ? (
              <tr><td colSpan={8} className="text-center py-8 text-ink font-mono text-sm">
                {loading ? 'Loading...' : 'Click Refresh to load straddle data'}
              </td></tr>
            ) : data.map((row, i) => {
              const isSelected = selectedRow?.expiry_code === row.expiry_code
              const hasAlert = row.today && row.yesterday &&
                (row.today - Math.min(row.today, row.yesterday)) >= THRESHOLD[underlying]

              return (
                <tr key={i}
                  className={`border-b border-edge/40 hover:bg-panelLight/40 transition-colors
                    ${isSelected ? 'bg-cyan/5 border-l-2 border-l-cyan' : ''}
                    ${hasAlert ? 'bg-amber-400/5' : ''}`}>
                  <td className="table-cell font-semibold text-bright">
                    <div className="flex items-center gap-2">
                      {hasAlert && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />}
                      {row.expiry}
                    </div>
                  </td>
                  <td className="table-cell font-mono text-cyan">{row.atm_strike}</td>
                  <td className="table-cell font-mono text-ink">{row.yesterday?.toFixed(2) ?? '—'}</td>
                  <td className="table-cell font-mono font-semibold text-bright">{row.today?.toFixed(2) ?? '—'}</td>
                  <td className="table-cell"><ChangeChip value={row.change} /></td>
                  <td className="table-cell font-mono text-emerald/80">{row.ce_ltp?.toFixed(2) ?? '—'}</td>
                  <td className="table-cell font-mono text-crimson/80">{row.pe_ltp?.toFixed(2) ?? '—'}</td>
                  <td className="table-cell">
                    <button onClick={() => handleViewChart(row)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all
                        ${isSelected ? 'bg-cyan text-void' : 'bg-panelLight border border-edge text-ink hover:text-bright hover:border-cyan/50'}`}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                      </svg>
                      Chart
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Intraday Chart */}
      {selectedRow && (
        <div className="bg-panel border border-edge rounded-2xl p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-7 h-7 rounded-lg bg-cyan/10 border border-cyan/20 flex items-center justify-center text-cyan text-xs">⚡</div>
            <span className="text-sm font-semibold text-bright">
              {underlying} {selectedRow.atm_strike} Straddle — {selectedRow.expiry}
            </span>
          </div>

          {/* Stats */}
          {chartStats && (
            <div className="grid grid-cols-5 gap-3 mb-4">
              {[
                { label: 'Open',         value: chartStats.open,            color: 'text-bright' },
                { label: 'High',         value: chartStats.high,            color: 'text-emerald' },
                { label: 'Low',          value: chartStats.low,             color: 'text-crimson' },
                { label: 'Current',      value: chartStats.current,         color: 'text-cyan' },
                { label: '↑ From Low',   value: chartStats.change_from_low, color: chartStats.change_from_low >= THRESHOLD[underlying] ? 'text-amber-400' : 'text-ink' },
              ].map(s => (
                <div key={s.label} className="bg-panelLight border border-edge rounded-xl p-3">
                  <p className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1">{s.label}</p>
                  <p className={`text-lg font-bold font-mono ${s.color}`}>
                    {s.value != null ? fmtVal(s.value) : '—'}
                  </p>
                </div>
              ))}
            </div>
          )}

          {chartLoading
            ? <div className="flex items-center justify-center h-[300px]">
                <svg className="animate-spin w-8 h-8 text-cyan" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              </div>
            : <IntradayChart data={chartData} stats={chartStats}
                title={`${underlying} ${selectedRow.atm_strike} Straddle`}
                underlying={underlying} />
          }
        </div>
      )}
    </div>
  )
}

export default function StraddlePage() {
  const { getAuthHeader } = useAuthStore()
  const authHeader = getAuthHeader()
  const [activeTab, setActiveTab] = useState('SENSEX')

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-bright tracking-tight">Straddle Monitor</h1>
        <p className="text-sm text-ink mt-1">
          ATM Call + ATM Put · Alerts when straddle rises above day low by threshold
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 bg-panel border border-edge rounded-xl mb-6 w-fit">
        {UNDERLYINGS.map(u => (
          <button key={u} onClick={() => setActiveTab(u)}
            className={`px-5 py-2 rounded-lg text-sm font-semibold font-mono transition-all
              ${activeTab === u ? 'bg-cyan text-void' : 'text-ink hover:text-bright'}`}>
            {u === 'SENSEX' ? 'BSE · SENSEX' : u === 'NIFTY' ? 'NSE · NIFTY' : 'NSE · BANKNIFTY'}
          </button>
        ))}
      </div>

      {/* Table for active tab */}
      <StraddleTable
        key={activeTab}
        underlying={activeTab}
        authHeader={authHeader}
      />
    </div>
  )
}
