import { useState, useCallback } from 'react'
import { useAuthStore } from '../hooks/useAuthStore'
import { fetchBatchLtp, fetchSpreadHistory, fetchMultiDayHistory, getExpiries } from '../utils/api'
import SpreadTableRow from '../components/SpreadTableRow'
import SpreadChart, { HistoricalChart } from '../components/SpreadChart'

// ── Constants ─────────────────────────────────────────────────────────────────
const ROWS = 7
const UNDERLYINGS = {
  NSE: ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'],
  BSE: ['SENSEX', 'BANKEX'],
}
const ATM_DEFAULTS = {
  NIFTY: 23300, BANKNIFTY: 52000, FINNIFTY: 23500,
  MIDCPNIFTY: 11500, SENSEX: 77000, BANKEX: 59000,
}
const GAP_DEFAULTS = {
  NIFTY: 50, BANKNIFTY: 100, FINNIFTY: 50,
  MIDCPNIFTY: 25, SENSEX: 100, BANKEX: 100,
}

function roundAtm(underlying, addon) {
  const atm = ATM_DEFAULTS[underlying] || 25000
  return Math.round(atm / addon) * addon
}

function roundTo50(val) { return Math.round(val / 50) * 50 }

// ── Section component ─────────────────────────────────────────────────────────
function Section({ id, label, ex1, und1, exp1, ex2, und2, exp2, tradeDate, authHeader }) {
  // Section-level controls
  const [optType,      setOptType]      = useState('CE')
  const [firstStrike,  setFirstStrike]  = useState(roundAtm(und1, 500))
  const [multiplier,   setMultiplier]   = useState(3.3)
  const [ratio,        setRatio]        = useState(3.3)
  const [addon,        setAddon]        = useState(500)

  // Data state
  const [rows,         setRows]         = useState([])
  const [loading,      setLoading]      = useState(false)
  const [selectedIdx,  setSelectedIdx]  = useState(null)
  const [chartData,    setChartData]    = useState([])
  const [chartStats,   setChartStats]   = useState(null)
  const [chartTitle,   setChartTitle]   = useState('')
  const [chartLoading, setChartLoading] = useState(false)
  const [chartType,    setChartType]    = useState('line')
  const [resolution,   setResolution]   = useState('1min')
  const [histData,     setHistData]     = useState([])
  const [histPeriod,   setHistPeriod]   = useState('1D')
  const [histLoading,  setHistLoading]  = useState(false)

  // Generate strikes
  const strikes = Array.from({ length: ROWS }, (_, i) => firstStrike + i * addon)

  const buildRows = (strikes) => strikes.map(s => ({
    exchange1:    ex1,
    underlying1:  und1,
    expiry_code1: exp1?.code || '',
    strike1:      s,
    type1:        optType,
    exchange2:    ex2,
    underlying2:  und2,
    expiry_code2: exp2?.code || '',
    strike2:      roundTo50(s / multiplier),
    type2:        optType,
    ratio,
  }))

  // Fetch all LTPs in one batch call
  const handleFetch = useCallback(async () => {
    if (!exp1?.code || !exp2?.code) {
      alert('Please select expiries first')
      return
    }
    setLoading(true)
    try {
      const rowDefs  = buildRows(strikes)
      const results  = await fetchBatchLtp(rowDefs, ratio, authHeader)
      setRows(results)
      setSelectedIdx(null)
      setChartData([])
    } catch (err) {
      console.error('Fetch error:', err)
      alert('Failed to fetch data. Check connection.')
    } finally {
      setLoading(false)
    }
  }, [strikes, optType, exp1, exp2, ratio, multiplier, authHeader])

  // View chart for a row
  const handleViewChart = useCallback(async (idx, strike1, strike2) => {
    setSelectedIdx(idx)
    setChartLoading(true)
    setChartTitle(`${und1} ${strike1} vs ${und2} ${strike2} · ${optType}`)
    try {
      const rowDef = {
        exchange1: ex1, underlying1: und1, expiry_code1: exp1?.code || '',
        strike1, type1: optType,
        exchange2: ex2, underlying2: und2, expiry_code2: exp2?.code || '',
        strike2, type2: optType, ratio,
      }
      const result = await fetchSpreadHistory(rowDef, tradeDate, '1', authHeader)
      setChartData(result.data || [])
      setChartStats(result.stats || null)
    } catch (err) {
      console.error('Chart error:', err)
    } finally {
      setChartLoading(false)
    }
  }, [ex1, und1, exp1, ex2, und2, exp2, optType, ratio, tradeDate, authHeader])

  // Load historical data
  const handleLoadHistory = useCallback(async () => {
    if (selectedIdx === null || !rows[selectedIdx]) return
    const row = rows[selectedIdx]
    const daysMap = { '1D': 1, '5D': 5, '1M': 22, '6M': 130 }
    setHistLoading(true)
    try {
      const rowDef = {
        exchange1: ex1, underlying1: und1, expiry_code1: exp1?.code || '',
        strike1: row.strike1, type1: optType,
        exchange2: ex2, underlying2: und2, expiry_code2: exp2?.code || '',
        strike2: row.strike2, type2: optType, ratio,
      }
      const result = await fetchMultiDayHistory(rowDef, daysMap[histPeriod], '1', authHeader)
      setHistData(result.data || [])
    } catch (err) {
      console.error('History error:', err)
    } finally {
      setHistLoading(false)
    }
  }, [selectedIdx, rows, histPeriod, ex1, und1, exp1, ex2, und2, exp2, optType, ratio, authHeader])

  return (
    <div className="mb-10">

      {/* Section controls */}
      <div className="bg-panel border border-edge rounded-2xl p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${optType === 'CE' ? 'bg-cyan' : 'bg-amber-400'}`} />
            <span className="text-sm font-semibold text-bright font-mono">{label}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
          {/* CE/PE */}
          <div>
            <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Type</label>
            <select
              value={optType}
              onChange={e => setOptType(e.target.value)}
              className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan transition-colors"
            >
              <option value="CE">CE</option>
              <option value="PE">PE</option>
            </select>
          </div>

          {/* First Strike */}
          <div>
            <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">First Strike</label>
            <input
              type="number"
              value={firstStrike}
              onChange={e => setFirstStrike(Number(e.target.value))}
              step={GAP_DEFAULTS[und1] || 50}
              className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan transition-colors"
            />
          </div>

          {/* Multiplier */}
          <div>
            <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Multiplier</label>
            <input
              type="number"
              value={multiplier}
              onChange={e => setMultiplier(Number(e.target.value))}
              step={0.01}
              className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan transition-colors"
            />
          </div>

          {/* Ratio */}
          <div>
            <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Ratio</label>
            <input
              type="number"
              value={ratio}
              onChange={e => setRatio(Number(e.target.value))}
              step={0.01}
              className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan transition-colors"
            />
          </div>

          {/* Add-on */}
          <div>
            <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Add-on</label>
            <input
              type="number"
              value={addon}
              onChange={e => setAddon(Number(e.target.value))}
              step={50}
              className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan transition-colors"
            />
          </div>
        </div>

        <button
          onClick={handleFetch}
          disabled={loading}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-cyan text-void font-bold text-sm hover:bg-cyan/90 transition-all disabled:opacity-50"
        >
          {loading ? (
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="1 4 1 10 7 10"/>
              <path d="M3.51 15a9 9 0 1 0 .49-3.99"/>
            </svg>
          )}
          {loading ? 'Fetching...' : `Fetch ${label} Data`}
        </button>
      </div>

      {/* Spread Table */}
      <div className="bg-panel border border-edge rounded-2xl overflow-hidden mb-4">
        <div className="flex items-center justify-between px-5 py-3 border-b border-edge">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-cyan animate-pulse" />
            <span className="text-xs font-mono font-semibold text-ink uppercase tracking-wider">Active Spread Monitor</span>
          </div>
          <span className="text-[10px] font-mono text-ink/60">
            Ratio: <span className="text-bright">×{ratio}</span> &nbsp;
            Multiplier: <span className="text-bright">×{multiplier}</span>
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-edge bg-panelLight/40">
                {['First Strike','Second Strike','Current Spread','+/-','Day High','Day Low','Action'].map(h => (
                  <th key={h} className="table-header text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-ink font-mono text-sm">
                    Click "Fetch Data" to load spreads
                  </td>
                </tr>
              ) : rows.map((row, i) => (
                <SpreadTableRow
                  key={i}
                  strike1={row.strike1}
                  strike2={row.strike2}
                  current={row.current}
                  dayHigh={null}
                  dayLow={null}
                  isSelected={selectedIdx === i}
                  onViewChart={() => handleViewChart(i, row.strike1, row.strike2)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Live Chart */}
      {selectedIdx !== null && (
        <div className="bg-panel border border-edge rounded-2xl p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-lg bg-cyan/10 border border-cyan/20 flex items-center justify-center text-cyan text-xs">⚡</div>
              <div>
                <span className="text-sm font-semibold text-bright">Live Spread Chart</span>
                <span className="text-[11px] text-ink font-mono ml-3">{chartTitle}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <select value={chartType} onChange={e => setChartType(e.target.value)}
                className="bg-panelLight border border-edge rounded-lg px-2 py-1 text-xs text-bright font-mono outline-none focus:border-cyan">
                <option value="line">Line</option>
                <option value="candlestick">Candlestick</option>
              </select>
              <select value={resolution} onChange={e => setResolution(e.target.value)}
                className="bg-panelLight border border-edge rounded-lg px-2 py-1 text-xs text-bright font-mono outline-none focus:border-cyan">
                <option value="1min">1m</option>
                <option value="5min">5m</option>
                <option value="15min">15m</option>
              </select>
            </div>
          </div>

          {/* Stats bar */}
          {chartStats && (
            <div className="grid grid-cols-4 gap-3 mb-4">
              {[
                { label: 'Open',    value: chartStats.open,    color: 'text-bright' },
                { label: 'High',    value: chartStats.high,    color: 'text-emerald' },
                { label: 'Low',     value: chartStats.low,     color: 'text-crimson' },
                { label: 'Current', value: chartStats.current, color: 'text-cyan' },
              ].map(s => (
                <div key={s.label} className="bg-panelLight border border-edge rounded-xl p-3">
                  <p className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1">{s.label}</p>
                  <p className={`text-lg font-bold font-mono ${s.color}`}>
                    {s.value != null ? `${s.value > 0 ? '+' : ''}${s.value.toFixed(2)}` : '—'}
                  </p>
                </div>
              ))}
            </div>
          )}

          {chartLoading ? (
            <div className="flex items-center justify-center h-[380px]">
              <svg className="animate-spin w-8 h-8 text-cyan" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
            </div>
          ) : (
            <SpreadChart
              data={chartData}
              stats={chartStats}
              title={chartTitle}
              type={chartType}
              resolution={resolution}
            />
          )}
        </div>
      )}

      {/* Historical Chart */}
      {selectedIdx !== null && (
        <div className="bg-panel border border-edge rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-lg bg-cyan/10 border border-cyan/20 flex items-center justify-center text-cyan text-xs">🕐</div>
              <span className="text-sm font-semibold text-bright">Historical Spread Trend</span>
            </div>
            <div className="flex items-center gap-2">
              {['1D','5D','1M','6M'].map(p => (
                <button key={p}
                  onClick={() => setHistPeriod(p)}
                  className={`px-3 py-1 rounded-lg text-xs font-mono font-semibold transition-all ${
                    histPeriod === p
                      ? 'bg-cyan text-void'
                      : 'bg-panelLight border border-edge text-ink hover:text-bright'
                  }`}
                >
                  {p}
                </button>
              ))}
              <button
                onClick={handleLoadHistory}
                disabled={histLoading}
                className="ml-2 px-3 py-1 rounded-lg text-xs font-mono font-semibold bg-panelLight border border-cyan/30 text-cyan hover:bg-cyan/10 transition-all disabled:opacity-50"
              >
                {histLoading ? '...' : 'Load'}
              </button>
            </div>
          </div>

          <HistoricalChart
            data={histData}
            title={`${chartTitle} — ${histPeriod}`}
          />
        </div>
      )}
    </div>
  )
}

// ── Main NFO-BFO Page ─────────────────────────────────────────────────────────
export default function NfoBfoPage() {
  const { getAuthHeader } = useAuthStore()
  const authHeader        = getAuthHeader()

  // Common controls
  const [ex1,       setEx1]       = useState('BSE')
  const [und1,      setUnd1]      = useState('SENSEX')
  const [ex2,       setEx2]       = useState('NSE')
  const [und2,      setUnd2]      = useState('NIFTY')
  const [exp1List,  setExp1List]  = useState([])
  const [exp2List,  setExp2List]  = useState([])
  const [exp1,      setExp1]      = useState(null)
  const [exp2,      setExp2]      = useState(null)
  const [tradeDate, setTradeDate] = useState(new Date().toISOString().split('T')[0])
  const [loadingExp, setLoadingExp] = useState(false)

  const loadExpiries = async () => {
    setLoadingExp(true)
    try {
      const [e1, e2] = await Promise.all([
        getExpiries(und1, authHeader),
        getExpiries(und2, authHeader),
      ])
      setExp1List(e1 || [])
      setExp2List(e2 || [])
      if (e1?.length) setExp1(e1[0])
      if (e2?.length) setExp2(e2[0])
    } catch (err) {
      console.error('Expiry error:', err)
    } finally {
      setLoadingExp(false)
    }
  }

  return (
    <div className="p-6">

      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-bright tracking-tight">NFO-BFO Spread Analysis</h1>
        <p className="text-sm text-ink mt-1">Data-only monitoring of option spread parity between NSE and BSE.</p>
      </div>

      {/* Common controls */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">

        {/* Exchange */}
        <div className="bg-panel border border-edge rounded-2xl p-4">
          <p className="text-[10px] font-mono text-ink uppercase tracking-widest mb-3">Exchange</p>
          <div className="space-y-2">
            <div>
              <label className="text-[10px] text-ink/60 font-mono mb-1 block">1st Leg</label>
              <select value={ex1} onChange={e => { setEx1(e.target.value); setUnd1(UNDERLYINGS[e.target.value][0]) }}
                className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan">
                <option>BSE</option><option>NSE</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-ink/60 font-mono mb-1 block">2nd Leg</label>
              <select value={ex2} onChange={e => { setEx2(e.target.value); setUnd2(UNDERLYINGS[e.target.value][0]) }}
                className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan">
                <option>NSE</option><option>BSE</option>
              </select>
            </div>
          </div>
        </div>

        {/* Index */}
        <div className="bg-panel border border-edge rounded-2xl p-4">
          <p className="text-[10px] font-mono text-ink uppercase tracking-widest mb-3">Index</p>
          <div className="space-y-2">
            <div>
              <label className="text-[10px] text-ink/60 font-mono mb-1 block">1st Leg</label>
              <select value={und1} onChange={e => setUnd1(e.target.value)}
                className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan">
                {(UNDERLYINGS[ex1] || []).map(u => <option key={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-ink/60 font-mono mb-1 block">2nd Leg</label>
              <select value={und2} onChange={e => setUnd2(e.target.value)}
                className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan">
                {(UNDERLYINGS[ex2] || []).map(u => <option key={u}>{u}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Expiry */}
        <div className="bg-panel border border-edge rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-mono text-ink uppercase tracking-widest">Expiry</p>
            <button onClick={loadExpiries} disabled={loadingExp}
              className="text-[10px] font-mono text-cyan hover:text-cyan/80 transition-colors disabled:opacity-50">
              {loadingExp ? 'Loading...' : 'Load →'}
            </button>
          </div>
          <div className="space-y-2">
            <div>
              <label className="text-[10px] text-ink/60 font-mono mb-1 block">1st Leg</label>
              <select
                value={exp1?.code || ''}
                onChange={e => setExp1(exp1List.find(x => x.code === e.target.value))}
                className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan"
              >
                {exp1List.length === 0
                  ? <option value="">— Load expiries —</option>
                  : exp1List.map(e => <option key={e.code} value={e.code}>{e.label}</option>)
                }
              </select>
            </div>
            <div>
              <label className="text-[10px] text-ink/60 font-mono mb-1 block">2nd Leg</label>
              <select
                value={exp2?.code || ''}
                onChange={e => setExp2(exp2List.find(x => x.code === e.target.value))}
                className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan"
              >
                {exp2List.length === 0
                  ? <option value="">— Load expiries —</option>
                  : exp2List.map(e => <option key={e.code} value={e.code}>{e.label}</option>)
                }
              </select>
            </div>
          </div>
        </div>

        {/* Date */}
        <div className="bg-panel border border-edge rounded-2xl p-4">
          <p className="text-[10px] font-mono text-ink uppercase tracking-widest mb-3">Strike Ladder</p>
          <div>
            <label className="text-[10px] text-ink/60 font-mono mb-1 block">Date</label>
            <input type="date" value={tradeDate}
              onChange={e => setTradeDate(e.target.value)}
              max={new Date().toISOString().split('T')[0]}
              className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan"
            />
          </div>
        </div>

      </div>

      {/* Section A */}
      <Section
        id="A" label="Section A"
        ex1={ex1} und1={und1} exp1={exp1}
        ex2={ex2} und2={und2} exp2={exp2}
        tradeDate={tradeDate}
        authHeader={authHeader}
      />

      {/* Section B */}
      <Section
        id="B" label="Section B"
        ex1={ex1} und1={und1} exp1={exp1}
        ex2={ex2} und2={und2} exp2={exp2}
        tradeDate={tradeDate}
        authHeader={authHeader}
      />

    </div>
  )
}
