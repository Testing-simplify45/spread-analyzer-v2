import { useState, useEffect, useCallback } from 'react'
import { useAuthStore } from '../hooks/useAuthStore'
import { getExpiries } from '../utils/api'
import SpreadChart, { HistoricalChart } from '../components/SpreadChart'
import { computeStatsFromData } from '../utils/computeStats'
import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL || '/api'
const ROWS = 7

function fmtVal(v) {
  if (v == null) return '—'
  return (v > 0 ? '+' : '') + v.toFixed(2)
}
function valColor(v) {
  if (v == null) return 'text-ink'
  return v > 0 ? 'text-emerald font-semibold' : v < 0 ? 'text-crimson font-semibold' : 'text-ink'
}
function roundTo50(val) { return Math.round(val / 50) * 50 }

function getPrevTradingDays(fromDate, count) {
  const days = []
  let d = new Date(fromDate)
  while (days.length < count) {
    d.setDate(d.getDate() - 1)
    if (d.getDay() !== 0 && d.getDay() !== 6) days.push(d.toISOString().split('T')[0])
  }
  return days
}

async function fetchNfoBfoData(authHeader, params, tradeDate) {
  try {
    const res = await axios.post(`${BASE_URL}/spreads/butterfly-nfobfo`, {
      ...params, trade_date: tradeDate, resolution: '1',
    }, { headers: { Authorization: authHeader } })
    return res.data.data || []
  } catch { return [] }
}

export default function ButterflyNfoBfoPage() {
  const { getAuthHeader } = useAuthStore()
  const authHeader = getAuthHeader()

  const [leg1Underlying, setLeg1Underlying] = useState('SENSEX')
  const leg2Underlying = leg1Underlying === 'SENSEX' ? 'NIFTY' : 'SENSEX'
  const leg3Underlying = leg1Underlying
  const leg1Exchange   = leg1Underlying === 'NIFTY' ? 'NSE' : 'BSE'
  const leg2Exchange   = leg2Underlying === 'NIFTY' ? 'NSE' : 'BSE'
  const leg3Exchange   = leg1Exchange

  const [leg1ExpList, setLeg1ExpList] = useState([])
  const [leg2ExpList, setLeg2ExpList] = useState([])
  const [loadingExp,  setLoadingExp]  = useState(false)

  const [exp1,        setExp1]        = useState(null)
  const [exp2a,       setExp2a]       = useState(null)
  const [exp2b,       setExp2b]       = useState(null)
  const [exp3,        setExp3]        = useState(null)

  const [type,        setType]        = useState('CE')
  const [ratio,       setRatio]       = useState(3.3)
  const [multiplier,  setMultiplier]  = useState(3.3)
  const [addon,       setAddon]       = useState(500)
  const [firstStrike, setFirstStrike] = useState(77000)  // SENSEX default
  const [tradeDate,   setTradeDate]   = useState(new Date().toISOString().split('T')[0])

  const [rows,         setRows]         = useState([])
  const [loading,      setLoading]      = useState(false)
  const [rangeLoading, setRangeLoading] = useState(false)
  const [selectedIdx,  setSelectedIdx]  = useState(null)
  const [chartData,    setChartData]    = useState([])
  const [chartType,    setChartType]    = useState('line')
  const [resolution,   setResolution]   = useState('1min')
  const [histData,     setHistData]     = useState([])
  const [histPeriod,   setHistPeriod]   = useState('1D')
  const [histLoading,  setHistLoading]  = useState(false)

  const chartStats = computeStatsFromData(chartData)
  const strikes    = Array.from({ length: ROWS }, (_, i) => firstStrike + i * addon)

  useEffect(() => { loadExpiries() }, [leg1Underlying])
  useEffect(() => {
    setFirstStrike(leg1Underlying === 'SENSEX' ? 77000 : 23300)
  }, [leg1Underlying])

  const loadExpiries = async () => {
    setLoadingExp(true)
    try {
      const [e1, e2] = await Promise.all([
        getExpiries(leg1Underlying, authHeader),
        getExpiries(leg2Underlying, authHeader),
      ])
      setLeg1ExpList(e1 || [])
      setLeg2ExpList(e2 || [])
      if (e1?.length) { setExp1(e1[0]); setExp3(e1[0]) }
      if (e2?.length) { setExp2a(e2[0]); setExp2b(e2[0]) }
    } catch (e) { console.error(e) }
    finally { setLoadingExp(false) }
  }

  const buildParams = (stk1) => ({
    leg1_exchange: leg1Exchange, leg1_underlying: leg1Underlying,
    leg1_expiry: exp1?.code, leg1_strike: stk1,
    leg2a_exchange: leg2Exchange, leg2a_underlying: leg2Underlying,
    leg2a_expiry: exp2a?.code, leg2a_strike: roundTo50(stk1 / multiplier),
    leg2b_exchange: leg2Exchange, leg2b_underlying: leg2Underlying,
    leg2b_expiry: exp2b?.code, leg2b_strike: roundTo50(stk1 / multiplier),
    leg3_exchange: leg3Exchange, leg3_underlying: leg3Underlying,
    leg3_expiry: exp3?.code, leg3_strike: stk1,
    option_type: type, ratio,
  })

  const handleFetch = useCallback(async () => {
    if (!exp1?.code || !exp2a?.code || !exp2b?.code || !exp3?.code) {
      alert('Please wait for expiries to load'); return
    }
    setLoading(true)
    setRows(strikes.map(s => ({
      stk1: s, stk2: roundTo50(s / multiplier),
      current: null, todayHigh: null, todayLow: null, d3High: null, d3Low: null, data: []
    })))
    try {
      const results = await Promise.all(strikes.map(async (stk1) => {
        const params = buildParams(stk1)
        const data   = await fetchNfoBfoData(authHeader, params, tradeDate)
        const stats  = computeStatsFromData(data)
        return {
          stk1, stk2: roundTo50(stk1 / multiplier),
          current: stats?.current ?? null,
          todayHigh: stats?.high  ?? null,
          todayLow:  stats?.low   ?? null,
          d3High: null, d3Low: null, data,
        }
      }))
      setRows(results)
    } catch (err) {
      console.error(err)
      alert('Failed to fetch data')
    } finally {
      setLoading(false)
    }
  }, [strikes, exp1, exp2a, exp2b, exp3, multiplier, type, ratio, tradeDate, authHeader,
      leg1Exchange, leg1Underlying, leg2Exchange, leg2Underlying, leg3Exchange, leg3Underlying])

  const handleRange = useCallback(async () => {
    if (rows.length === 0) { alert('Please fetch data first'); return }
    setRangeLoading(true)
    try {
      const prevDays = getPrevTradingDays(tradeDate, 2)
      const allDays  = [tradeDate, ...prevDays]
      const updated  = await Promise.all(rows.map(async (row) => {
        const allHighs = [], allLows = []
        for (const day of allDays) {
          const params = buildParams(row.stk1)
          const data   = await fetchNfoBfoData(authHeader, params, day)
          const stats  = computeStatsFromData(data)
          if (stats?.high != null) allHighs.push(stats.high)
          if (stats?.low  != null) allLows.push(stats.low)
        }
        return { ...row, d3High: allHighs.length ? Math.max(...allHighs) : null, d3Low: allLows.length ? Math.min(...allLows) : null }
      }))
      setRows(updated)
    } catch (err) { console.error(err) }
    finally { setRangeLoading(false) }
  }, [rows, exp1, exp2a, exp2b, exp3, multiplier, type, ratio, tradeDate, authHeader,
      leg1Exchange, leg1Underlying, leg2Exchange, leg2Underlying, leg3Exchange, leg3Underlying])

  const handleViewChart = useCallback((idx) => {
    setSelectedIdx(idx)
    setChartData(rows[idx]?.data || [])
  }, [rows])

  const handleLoadHistory = useCallback(async () => {
    if (selectedIdx === null) return
    const row = rows[selectedIdx]
    if (!row) return
    const daysMap = { '1D': 1, '5D': 5, '1M': 22, '6M': 130 }
    setHistLoading(true)
    try {
      const frames = []
      let d = new Date(tradeDate)
      let collected = 0
      while (collected < daysMap[histPeriod]) {
        if (d.getDay() !== 0 && d.getDay() !== 6) {
          const dateStr = d.toISOString().split('T')[0]
          const params  = buildParams(row.stk1)
          const data    = await fetchNfoBfoData(authHeader, params, dateStr)
          frames.push(...data.map(r => ({ ...r, date: dateStr })))
          collected++
        }
        d.setDate(d.getDate() - 1)
      }
      setHistData(frames.reverse())
    } catch (err) { console.error(err) }
    finally { setHistLoading(false) }
  }, [selectedIdx, rows, histPeriod, exp1, exp2a, exp2b, exp3, multiplier, type, ratio, tradeDate, authHeader,
      leg1Exchange, leg1Underlying, leg2Exchange, leg2Underlying, leg3Exchange, leg3Underlying])

  const expSelect = (list, val, onChange) => (
    <select value={val?.code || ''} onChange={e => onChange(list.find(x => x.code === e.target.value))}
      className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan">
      {list.length ? list.map(e => <option key={e.code} value={e.code}>{e.label}</option>)
        : <option value="">{loadingExp ? 'Loading...' : '— —'}</option>}
    </select>
  )

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-bright tracking-tight">Butterfly Spread — NFO-BFO</h1>
        <p className="text-sm text-ink mt-1">Formula: (Leg1 − Leg2×Ratio) + (Leg3 − Leg2×Ratio)</p>
      </div>

      {/* Controls */}
      <div className="bg-panel border border-edge rounded-2xl p-5 mb-6">
        {/* Row 1 */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-4">
          <div>
            <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Leg 1/3</label>
            <select value={leg1Underlying} onChange={e => setLeg1Underlying(e.target.value)}
              className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan">
              <option>SENSEX</option><option>NIFTY</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Type</label>
            <select value={type} onChange={e => setType(e.target.value)}
              className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan">
              <option>CE</option><option>PE</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">First Strike</label>
            <input type="number" value={firstStrike} onChange={e => setFirstStrike(Number(e.target.value))} step={50}
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

        {/* Expiries */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
          <div>
            <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-blue" />Leg 1 Expiry {loadingExp && <span className="text-cyan">...</span>}
            </label>
            {expSelect(leg1ExpList, exp1, setExp1)}
          </div>
          <div>
            <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-cyan" />Leg 2 Expiry (S1)
            </label>
            {expSelect(leg2ExpList, exp2a, setExp2a)}
          </div>
          <div>
            <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-cyan" />Leg 2 Expiry (S2)
            </label>
            {expSelect(leg2ExpList, exp2b, setExp2b)}
          </div>
          <div>
            <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald" />Leg 3 Expiry
            </label>
            {expSelect(leg1ExpList, exp3, setExp3)}
          </div>
          <div>
            <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Date</label>
            <input type="date" value={tradeDate} onChange={e => setTradeDate(e.target.value)}
              max={new Date().toISOString().split('T')[0]}
              className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan" />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button onClick={handleFetch} disabled={loading}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-cyan text-void font-bold text-sm hover:bg-cyan/90 transition-all disabled:opacity-50">
            {loading ? <><svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Fetching...</> : '🔄 Fetch Data'}
          </button>
          <button onClick={handleRange} disabled={rangeLoading || rows.length === 0}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-panelLight border border-cyan/30 text-cyan font-bold text-sm hover:bg-cyan/10 transition-all disabled:opacity-50">
            {rangeLoading ? <><svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Loading...</> : '📊 Range (3D)'}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-panel border border-edge rounded-2xl overflow-hidden mb-4">
        <div className="flex items-center justify-between px-5 py-3 border-b border-edge">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-cyan animate-pulse" />
            <span className="text-xs font-mono font-semibold text-ink uppercase tracking-wider">Butterfly NFO-BFO Ladder</span>
          </div>
          <span className="text-[10px] font-mono text-ink/60">Ratio ×{ratio} · Multiplier ×{multiplier}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-edge bg-panelLight/40">
                {['Strike (L1/L2)','Today High','Today Low','Current','3D High','3D Low','Chart'].map(h => (
                  <th key={h} className="table-header text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-ink font-mono text-sm">Click "Fetch Data" to load the ladder</td></tr>
              ) : rows.map((row, i) => (
                <tr key={i} className={`border-b border-edge/40 hover:bg-panelLight/40 transition-colors ${selectedIdx === i ? 'bg-cyan/5 border-l-2 border-l-cyan' : ''}`}>
                  <td className="table-cell">
                    <span className="font-bold text-bright">{row.stk1}</span>
                    <span className="text-ink/50 text-xs font-mono ml-1">/{row.stk2}</span>
                  </td>
                  <td className="table-cell text-emerald font-mono font-semibold">{fmtVal(row.todayHigh)}</td>
                  <td className="table-cell text-crimson font-mono font-semibold">{fmtVal(row.todayLow)}</td>
                  <td className={`table-cell ${valColor(row.current)}`}>{fmtVal(row.current)}</td>
                  <td className="table-cell">{row.d3High != null ? <span className="text-emerald/70 font-mono">{fmtVal(row.d3High)}</span> : <span className="text-ink/30 text-xs">—</span>}</td>
                  <td className="table-cell">{row.d3Low  != null ? <span className="text-crimson/70 font-mono">{fmtVal(row.d3Low)}</span>  : <span className="text-ink/30 text-xs">—</span>}</td>
                  <td className="table-cell">
                    <button onClick={() => handleViewChart(i)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${selectedIdx === i ? 'bg-cyan text-void' : 'bg-panelLight border border-edge text-ink hover:text-bright hover:border-cyan/50'}`}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                      Chart
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Chart */}
      {selectedIdx !== null && chartData.length > 0 && (
        <div className="bg-panel border border-edge rounded-2xl p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-lg bg-cyan/10 border border-cyan/20 flex items-center justify-center text-cyan text-xs">🦋</div>
              <span className="text-sm font-semibold text-bright">
                {leg1Underlying} {rows[selectedIdx]?.stk1} / {leg2Underlying} {rows[selectedIdx]?.stk2} · {type}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <select value={chartType} onChange={e => setChartType(e.target.value)}
                className="bg-panelLight border border-edge rounded-lg px-2 py-1 text-xs text-bright font-mono outline-none focus:border-cyan">
                <option value="line">Line</option><option value="candlestick">Candlestick</option>
              </select>
              <select value={resolution} onChange={e => setResolution(e.target.value)}
                className="bg-panelLight border border-edge rounded-lg px-2 py-1 text-xs text-bright font-mono outline-none focus:border-cyan">
                <option value="1min">1m</option><option value="5min">5m</option><option value="15min">15m</option>
              </select>
            </div>
          </div>
          {chartStats && (
            <div className="grid grid-cols-4 gap-3 mb-4">
              {[
                { label: 'Open', value: chartStats.open, color: 'text-bright' },
                { label: 'High', value: chartStats.high, color: 'text-emerald' },
                { label: 'Low',  value: chartStats.low,  color: 'text-crimson' },
                { label: 'Current', value: chartStats.current, color: 'text-cyan' },
              ].map(s => (
                <div key={s.label} className="bg-panelLight border border-edge rounded-xl p-3">
                  <p className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1">{s.label}</p>
                  <p className={`text-lg font-bold font-mono ${s.color}`}>{s.value != null ? fmtVal(s.value) : '—'}</p>
                </div>
              ))}
            </div>
          )}
          <SpreadChart data={chartData} stats={chartStats}
            title={`${leg1Underlying} ${rows[selectedIdx]?.stk1} / ${leg2Underlying} ${rows[selectedIdx]?.stk2} · ${type}`}
            type={chartType} resolution={resolution} />
        </div>
      )}

      {/* Historical */}
      {selectedIdx !== null && (
        <div className="bg-panel border border-edge rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-lg bg-cyan/10 border border-cyan/20 flex items-center justify-center text-cyan text-xs">🕐</div>
              <span className="text-sm font-semibold text-bright">Historical Trend</span>
            </div>
            <div className="flex items-center gap-2">
              {['1D','5D','1M','6M'].map(p => (
                <button key={p} onClick={() => setHistPeriod(p)}
                  className={`px-3 py-1 rounded-lg text-xs font-mono font-semibold transition-all ${histPeriod === p ? 'bg-cyan text-void' : 'bg-panelLight border border-edge text-ink hover:text-bright'}`}>{p}</button>
              ))}
              <button onClick={handleLoadHistory} disabled={histLoading}
                className="ml-2 px-3 py-1 rounded-lg text-xs font-mono font-semibold bg-panelLight border border-cyan/30 text-cyan hover:bg-cyan/10 transition-all disabled:opacity-50">
                {histLoading ? '...' : 'Load'}
              </button>
            </div>
          </div>
          <HistoricalChart data={histData} title={`Butterfly NFO-BFO — ${histPeriod}`} />
        </div>
      )}
    </div>
  )
}
