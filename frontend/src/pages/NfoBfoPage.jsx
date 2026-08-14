import { useState, useCallback, useEffect } from 'react'
import { useAuthStore } from '../hooks/useAuthStore'
import { fetchBatchLtp, fetchSpreadHistory, fetchMultiDayHistory, getExpiries } from '../utils/api'
import SpreadChart, { HistoricalChart } from '../components/SpreadChart'

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

function Select({ label, value, onChange, options, className = '' }) {
  return (
    <div className={className}>
      {label && <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">{label}</label>}
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan transition-colors">
        {options.map(o => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
      </select>
    </div>
  )
}

function Section({ id, label, ex1, und1, exp1List, ex2, und2, exp2List, tradeDate, authHeader }) {
  const [optType,     setOptType]     = useState('CE')
  const [firstStrike, setFirstStrike] = useState(roundAtm(und1, 500))
  const [multiplier,  setMultiplier]  = useState(3.3)
  const [ratio,       setRatio]       = useState(3.3)
  const [addon,       setAddon]       = useState(500)
  const [exp1,        setExp1]        = useState(exp1List[0] || null)
  const [exp2,        setExp2]        = useState(exp2List[0] || null)

  const [rows,         setRows]        = useState([])
  const [loading,      setLoading]     = useState(false)
  const [selectedIdx,  setSelectedIdx] = useState(null)
  const [chartData,    setChartData]   = useState([])
  const [chartStats,   setChartStats]  = useState(null)
  const [chartTitle,   setChartTitle]  = useState('')
  const [chartLoading, setChartLoading]= useState(false)
  const [chartType,    setChartType]   = useState('line')
  const [resolution,   setResolution]  = useState('1min')
  const [histData,     setHistData]    = useState([])
  const [histPeriod,   setHistPeriod]  = useState('1D')
  const [histLoading,  setHistLoading] = useState(false)

  useEffect(() => { if (exp1List[0]) setExp1(exp1List[0]) }, [exp1List])
  useEffect(() => { if (exp2List[0]) setExp2(exp2List[0]) }, [exp2List])
  useEffect(() => { setFirstStrike(roundAtm(und1, addon)) }, [und1])

  const strikes = Array.from({ length: ROWS }, (_, i) => firstStrike + i * addon)

  const handleFetch = useCallback(async () => {
    if (!exp1?.code || !exp2?.code) { alert('Please load expiries first'); return }
    setLoading(true)
    try {
      const rowDefs = strikes.map(s => ({
        exchange1: ex1, underlying1: und1, expiry_code1: exp1.code,
        strike1: s, type1: optType,
        exchange2: ex2, underlying2: und2, expiry_code2: exp2.code,
        strike2: roundTo50(s / multiplier), type2: optType, ratio,
      }))
      const results = await fetchBatchLtp(rowDefs, ratio, authHeader)
      setRows(results)
      setSelectedIdx(null)
      setChartData([])
    } catch (err) {
      alert('Failed to fetch. Check connection.')
    } finally {
      setLoading(false)
    }
  }, [strikes, optType, exp1, exp2, ratio, multiplier, authHeader, ex1, und1, ex2, und2])

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
      console.error(err)
    } finally {
      setChartLoading(false)
    }
  }, [ex1, und1, exp1, ex2, und2, exp2, optType, ratio, tradeDate, authHeader])

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
      console.error(err)
    } finally {
      setHistLoading(false)
    }
  }, [selectedIdx, rows, histPeriod, ex1, und1, exp1, ex2, und2, exp2, optType, ratio, authHeader])

  const fmtVal = v => v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(2)
  const valColor = v => v == null ? 'text-ink' : v > 0 ? 'text-emerald font-semibold' : v < 0 ? 'text-crimson font-semibold' : 'text-ink'

  return (
    <div className="mb-8">
      {/* Controls */}
      <div className="bg-panel border border-edge rounded-2xl p-5 mb-4">
        <div className="flex items-center gap-2 mb-4">
          <div className={`w-2 h-2 rounded-full ${optType === 'CE' ? 'bg-cyan' : 'bg-amber-400'}`} />
          <span className="text-sm font-semibold text-bright font-mono">{label}</span>
        </div>

        {/* Expiries row */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <Select label="1st Leg Expiry" value={exp1?.code || ''}
            onChange={v => setExp1(exp1List.find(e => e.code === v))}
            options={exp1List.length ? exp1List.map(e => ({ value: e.code, label: e.label })) : [{ value: '', label: '— Load expiries —' }]} />
          <Select label="2nd Leg Expiry" value={exp2?.code || ''}
            onChange={v => setExp2(exp2List.find(e => e.code === v))}
            options={exp2List.length ? exp2List.map(e => ({ value: e.code, label: e.label })) : [{ value: '', label: '— Load expiries —' }]} />
        </div>

        {/* Params row */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
          <Select label="Type" value={optType} onChange={setOptType} options={['CE', 'PE']} />
          <div>
            <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">First Strike</label>
            <input type="number" value={firstStrike} onChange={e => setFirstStrike(Number(e.target.value))}
              step={GAP_DEFAULTS[und1] || 50}
              className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan" />
          </div>
          <div>
            <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Multiplier</label>
            <input type="number" value={multiplier} onChange={e => setMultiplier(Number(e.target.value))} step={0.01}
              className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan" />
          </div>
          <div>
            <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Ratio</label>
            <input type="number" value={ratio} onChange={e => setRatio(Number(e.target.value))} step={0.01}
              className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan" />
          </div>
          <div>
            <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Add-on</label>
            <input type="number" value={addon} onChange={e => setAddon(Number(e.target.value))} step={50}
              className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan" />
          </div>
        </div>

        <button onClick={handleFetch} disabled={loading}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-cyan text-void font-bold text-sm hover:bg-cyan/90 transition-all disabled:opacity-50">
          {loading
            ? <><svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Fetching...</>
            : <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.99"/></svg>Fetch {label} Data</>
          }
        </button>
      </div>

      {/* Table */}
      <div className="bg-panel border border-edge rounded-2xl overflow-hidden mb-4">
        <div className="flex items-center justify-between px-5 py-3 border-b border-edge">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-cyan animate-pulse" />
            <span className="text-xs font-mono font-semibold text-ink uppercase tracking-wider">Active Spread Monitor</span>
          </div>
          <span className="text-[10px] font-mono text-ink/60">Ratio: <span className="text-bright">×{ratio}</span> · Multiplier: <span className="text-bright">×{multiplier}</span></span>
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
                <tr><td colSpan={7} className="text-center py-8 text-ink font-mono text-sm">Click "Fetch Data" to load spreads</td></tr>
              ) : rows.map((row, i) => (
                <tr key={i}
                  className={`border-b border-edge/40 hover:bg-panelLight/40 transition-colors ${selectedIdx === i ? 'bg-cyan/5 border-l-2 border-l-cyan' : ''}`}>
                  <td className="table-cell font-bold text-bright">{row.strike1}</td>
                  <td className="table-cell text-ink">{row.strike2}</td>
                  <td className={`table-cell ${valColor(row.current)}`}>{fmtVal(row.current)}</td>
                  <td className="table-cell text-ink/40">—</td>
                  <td className="table-cell text-ink/40">—</td>
                  <td className="table-cell text-ink/40">—</td>
                  <td className="table-cell">
                    <button onClick={() => handleViewChart(i, row.strike1, row.strike2)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${selectedIdx === i ? 'bg-cyan text-void' : 'bg-panelLight border border-edge text-ink hover:text-bright hover:border-cyan/50'}`}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                      View Chart
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Chart */}
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
                    {s.value != null ? fmtVal(s.value) : '—'}
                  </p>
                </div>
              ))}
            </div>
          )}

          {chartLoading
            ? <div className="flex items-center justify-center h-[380px]"><svg className="animate-spin w-8 h-8 text-cyan" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg></div>
            : <SpreadChart data={chartData} stats={chartStats} title={chartTitle} type={chartType} resolution={resolution} />
          }
        </div>
      )}

      {/* Historical */}
      {selectedIdx !== null && (
        <div className="bg-panel border border-edge rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-lg bg-cyan/10 border border-cyan/20 flex items-center justify-center text-cyan text-xs">🕐</div>
              <span className="text-sm font-semibold text-bright">Historical Spread Trend</span>
            </div>
            <div className="flex items-center gap-2">
              {['1D','5D','1M','6M'].map(p => (
                <button key={p} onClick={() => setHistPeriod(p)}
                  className={`px-3 py-1 rounded-lg text-xs font-mono font-semibold transition-all ${histPeriod === p ? 'bg-cyan text-void' : 'bg-panelLight border border-edge text-ink hover:text-bright'}`}>
                  {p}
                </button>
              ))}
              <button onClick={handleLoadHistory} disabled={histLoading}
                className="ml-2 px-3 py-1 rounded-lg text-xs font-mono font-semibold bg-panelLight border border-cyan/30 text-cyan hover:bg-cyan/10 transition-all disabled:opacity-50">
                {histLoading ? '...' : 'Load'}
              </button>
            </div>
          </div>
          <HistoricalChart data={histData} title={`${chartTitle} — ${histPeriod}`} />
        </div>
      )}
    </div>
  )
}

export default function NfoBfoPage() {
  const { getAuthHeader } = useAuthStore()
  const authHeader = getAuthHeader()

  const [ex1,  setEx1]  = useState('BSE')
  const [und1, setUnd1] = useState('SENSEX')
  const [ex2,  setEx2]  = useState('NSE')
  const [und2, setUnd2] = useState('NIFTY')
  const [exp1List, setExp1List] = useState([])
  const [exp2List, setExp2List] = useState([])
  const [tradeDate, setTradeDate] = useState(new Date().toISOString().split('T')[0])
  const [loadingExp, setLoadingExp] = useState(false)

  // Auto-load expiries when underlying changes
  useEffect(() => { loadExpiries() }, [und1, und2])

  const loadExpiries = async () => {
    setLoadingExp(true)
    try {
      const [e1, e2] = await Promise.all([
        getExpiries(und1, authHeader),
        getExpiries(und2, authHeader),
      ])
      setExp1List(e1 || [])
      setExp2List(e2 || [])
    } catch (err) {
      console.error('Expiry error:', err)
    } finally {
      setLoadingExp(false)
    }
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-bright tracking-tight">NFO-BFO Spread Analysis</h1>
        <p className="text-sm text-ink mt-1">Data-only monitoring of option spread parity between NSE and BSE.</p>
      </div>

      {/* Common Controls */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
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

        <div className="bg-panel border border-edge rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-mono text-ink uppercase tracking-widest">Expiry Status</p>
            {loadingExp && <span className="text-[10px] font-mono text-cyan animate-pulse">Loading...</span>}
            {!loadingExp && exp1List.length > 0 && <span className="text-[10px] font-mono text-emerald">✓ Loaded</span>}
          </div>
          <p className="text-xs text-ink/60 font-mono">Expiries auto-load when you change the index. Select them in each section below.</p>
        </div>

        <div className="bg-panel border border-edge rounded-2xl p-4">
          <p className="text-[10px] font-mono text-ink uppercase tracking-widest mb-3">Date</p>
          <input type="date" value={tradeDate} onChange={e => setTradeDate(e.target.value)}
            max={new Date().toISOString().split('T')[0]}
            className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan" />
        </div>
      </div>

      <Section id="A" label="Section A" ex1={ex1} und1={und1} exp1List={exp1List} ex2={ex2} und2={und2} exp2List={exp2List} tradeDate={tradeDate} authHeader={authHeader} />
      <Section id="B" label="Section B" ex1={ex1} und1={und1} exp1List={exp1List} ex2={ex2} und2={und2} exp2List={exp2List} tradeDate={tradeDate} authHeader={authHeader} />
    </div>
  )
}
