import { useState, useEffect, useCallback } from 'react'
import { useAuthStore } from '../hooks/useAuthStore'
import { getExpiries } from '../utils/api'
import SpreadChart, { HistoricalChart } from '../components/SpreadChart'
import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL || '/api'

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

const ROWS = 7

function roundTo50(val) { return Math.round(val / 50) * 50 }
function roundAtm(und, addon) {
  const atm = ATM_DEFAULTS[und] || 25000
  return Math.round(atm / addon) * addon
}
function fmtVal(v) {
  if (v == null) return '—'
  return (v > 0 ? '+' : '') + v.toFixed(2)
}
function valColor(v) {
  if (v == null) return 'text-ink'
  return v > 0 ? 'text-emerald font-semibold' : v < 0 ? 'text-crimson font-semibold' : 'text-ink'
}

export default function StraddleSpreadPage() {
  const { getAuthHeader } = useAuthStore()
  const authHeader = getAuthHeader()

  // Leg 1 & 3 controls (same exchange/underlying/expiry, different strikes handled by ladder)
  const [ex1,      setEx1]      = useState('BSE')
  const [und1,     setUnd1]     = useState('SENSEX')
  const [exp1List, setExp1List] = useState([])
  const [exp1,     setExp1]     = useState(null)

  // Leg 2 & 4 controls
  const [ex2,      setEx2]      = useState('NSE')
  const [und2,     setUnd2]     = useState('NIFTY')
  const [exp2List, setExp2List] = useState([])
  const [exp2,     setExp2]     = useState(null)

  // Ladder params
  const [ratio,       setRatio]       = useState(3.3)
  const [multiplier,  setMultiplier]  = useState(3.3)
  const [addon,       setAddon]       = useState(500)
  const [firstStrike, setFirstStrike] = useState(roundAtm('SENSEX', 500))
  const [tradeDate,   setTradeDate]   = useState(new Date().toISOString().split('T')[0])

  // Data
  const [rows,         setRows]        = useState([])
  const [loading,      setLoading]     = useState(false)
  const [loadingExp,   setLoadingExp]  = useState(false)
  const [selectedIdx,  setSelectedIdx] = useState(null)
  const [chartData,    setChartData]   = useState([])
  const [chartStats,   setChartStats]  = useState(null)
  const [chartLoading, setChartLoading]= useState(false)
  const [chartType,    setChartType]   = useState('line')
  const [resolution,   setResolution]  = useState('1min')
  const [histData,     setHistData]    = useState([])
  const [histPeriod,   setHistPeriod]  = useState('1D')
  const [histLoading,  setHistLoading] = useState(false)

  // Auto load expiries
  useEffect(() => { loadExp1() }, [und1])
  useEffect(() => { loadExp2() }, [und2])
  useEffect(() => { setFirstStrike(roundAtm(und1, addon)) }, [und1])

  const loadExp1 = async () => {
    setLoadingExp(true)
    try {
      const list = await getExpiries(und1, authHeader)
      setExp1List(list || [])
      if (list?.length) setExp1(list[0])
    } catch (e) { console.error(e) }
    finally { setLoadingExp(false) }
  }

  const loadExp2 = async () => {
    try {
      const list = await getExpiries(und2, authHeader)
      setExp2List(list || [])
      if (list?.length) setExp2(list[0])
    } catch (e) { console.error(e) }
  }

  // Generate strikes
  const strikes = Array.from({ length: ROWS }, (_, i) => firstStrike + i * addon)

  // Batch fetch all LTPs for the ladder
  const handleFetch = useCallback(async () => {
    if (!exp1?.code || !exp2?.code) { alert('Please wait for expiries to load'); return }
    setLoading(true)
    setRows([])
    try {
      // Build all symbols for batch call
      const sym1List = [] // Leg1 CE
      const sym2List = [] // Leg2 CE
      const sym3List = [] // Leg3 PE
      const sym4List = [] // Leg4 PE
      const stk2List = []

      strikes.forEach(stk1 => {
        const stk2 = roundTo50(stk1 / multiplier)
        stk2List.push(stk2)
        sym1List.push(`${ex1}:${und1}${formatExpCode(exp1.code)}${stk1}CE`)
        sym2List.push(`${ex2}:${und2}${formatExpCode(exp2.code)}${stk2}CE`)
        sym3List.push(`${ex1}:${und1}${formatExpCode(exp1.code)}${stk1}PE`)
        sym4List.push(`${ex2}:${und2}${formatExpCode(exp2.code)}${stk2}PE`)
      })

      const allSyms = [...sym1List, ...sym2List, ...sym3List, ...sym4List]

      // Single batch LTP call
      const resp = await axios.post(`${BASE_URL}/spreads/batch-ltp`,
        { rows: buildBatchRows(strikes, stk2List, exp1, exp2), ratio },
        { headers: { Authorization: authHeader } }
      )

      // Also need CE and PE separately - use custom batch
      const ltpResp = await axios.post(`${BASE_URL}/spreads/raw-ltp`,
        { symbols: allSyms },
        { headers: { Authorization: authHeader } }
      )

      const ltpMap = ltpResp.data?.ltp_map || {}

      const result = strikes.map((stk1, i) => {
        const stk2 = stk2List[i]
        const ltp1ce = ltpMap[sym1List[i]]
        const ltp2ce = ltpMap[sym2List[i]]
        const ltp3pe = ltpMap[sym3List[i]]
        const ltp4pe = ltpMap[sym4List[i]]

        const ceSpread = ltp1ce != null && ltp2ce != null
          ? round2(ltp1ce - ltp2ce * ratio) : null
        const peSpread = ltp3pe != null && ltp4pe != null
          ? round2(ltp3pe - ltp4pe * ratio) : null
        const total = ceSpread != null && peSpread != null
          ? round2(ceSpread + peSpread) : null

        return { stk1, stk2, ceSpread, peSpread, total }
      })

      setRows(result)
      setSelectedIdx(null)
    } catch (err) {
      console.error(err)
      // Fallback: try simpler batch approach
      await handleFetchSimple(strikes, stk2List)
    } finally {
      setLoading(false)
    }
  }, [strikes, exp1, exp2, ratio, multiplier, authHeader, ex1, und1, ex2, und2])

  // Simpler fetch using two separate batch calls (CE + PE)
  const handleFetchSimple = async (strikesArr, stk2Arr) => {
    try {
      const ceRows = strikesArr.map((stk1, i) => ({
        exchange1: ex1, underlying1: und1, expiry_code1: exp1.code,
        strike1: stk1, type1: 'CE',
        exchange2: ex2, underlying2: und2, expiry_code2: exp2.code,
        strike2: stk2Arr[i], type2: 'CE', ratio,
      }))
      const peRows = strikesArr.map((stk1, i) => ({
        exchange1: ex1, underlying1: und1, expiry_code1: exp1.code,
        strike1: stk1, type1: 'PE',
        exchange2: ex2, underlying2: und2, expiry_code2: exp2.code,
        strike2: stk2Arr[i], type2: 'PE', ratio,
      }))

      const [ceResp, peResp] = await Promise.all([
        axios.post(`${BASE_URL}/spreads/batch-ltp`, { rows: ceRows, ratio }, { headers: { Authorization: authHeader } }),
        axios.post(`${BASE_URL}/spreads/batch-ltp`, { rows: peRows, ratio }, { headers: { Authorization: authHeader } }),
      ])

      const ceResults = ceResp.data?.results || []
      const peResults = peResp.data?.results || []

      const result = strikesArr.map((stk1, i) => {
        const stk2     = stk2Arr[i]
        const ceSpread = ceResults[i]?.current ?? null
        const peSpread = peResults[i]?.current ?? null
        const total    = ceSpread != null && peSpread != null ? round2(ceSpread + peSpread) : null
        return { stk1, stk2, ceSpread, peSpread, total }
      })

      setRows(result)
    } catch (err) {
      console.error('Fallback fetch error:', err)
      alert('Failed to fetch data. Please try again.')
    }
  }

  const stk2List = strikes.map(s => roundTo50(s / multiplier))

  // On fetch button click — use simple approach directly
  const handleFetchData = useCallback(async () => {
    if (!exp1?.code || !exp2?.code) { alert('Please wait for expiries to load'); return }
    setLoading(true)
    setRows([])
    setSelectedIdx(null)
    await handleFetchSimple(strikes, stk2List)
    setLoading(false)
  }, [strikes, stk2List, exp1, exp2, ratio, multiplier, authHeader, ex1, und1, ex2, und2])

  // View chart for a row
  const handleViewChart = useCallback(async (idx, stk1, stk2) => {
    setSelectedIdx(idx)
    setChartLoading(true)
    setChartData([])
    setChartStats(null)
    try {
      // Fetch CE spread history
      const [ceResp, peResp] = await Promise.all([
        axios.post(`${BASE_URL}/spreads/history`,
          { exchange1: ex1, underlying1: und1, expiry_code1: exp1?.code,
            strike1: stk1, type1: 'CE',
            exchange2: ex2, underlying2: und2, expiry_code2: exp2?.code,
            strike2: stk2, type2: 'CE', ratio },
          { params: { trade_date: tradeDate, resolution: '1' },
            headers: { Authorization: authHeader } }),
        axios.post(`${BASE_URL}/spreads/history`,
          { exchange1: ex1, underlying1: und1, expiry_code1: exp1?.code,
            strike1: stk1, type1: 'PE',
            exchange2: ex2, underlying2: und2, expiry_code2: exp2?.code,
            strike2: stk2, type2: 'PE', ratio },
          { params: { trade_date: tradeDate, resolution: '1' },
            headers: { Authorization: authHeader } }),
      ])

      const ceData = ceResp.data?.data || []
      const peData = peResp.data?.data || []

      // Combine: total = CE spread + PE spread at each timestamp
      const tsMap = {}
      ceData.forEach(d => { tsMap[d.timestamp] = { timestamp: d.timestamp, ce: d.spread } })
      peData.forEach(d => {
        if (tsMap[d.timestamp]) tsMap[d.timestamp].pe = d.spread
      })

      const combined = Object.values(tsMap)
        .filter(d => d.ce != null && d.pe != null)
        .map(d => ({ timestamp: d.timestamp, spread: round2(d.ce + d.pe),
                     spread_high: round2(d.ce + d.pe), spread_low: round2(d.ce + d.pe) }))
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))

      // Stats
      const spreads = combined.map(d => d.spread)
      const stats = spreads.length ? {
        open:    round2(spreads[0]),
        high:    round2(Math.max(...spreads)),
        low:     round2(Math.min(...spreads)),
        current: round2(spreads[spreads.length - 1]),
      } : null

      setChartData(combined)
      setChartStats(stats)
    } catch (err) {
      console.error(err)
    } finally {
      setChartLoading(false)
    }
  }, [ex1, und1, exp1, ex2, und2, exp2, ratio, tradeDate, authHeader])

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
          try {
            const [ceResp, peResp] = await Promise.all([
              axios.post(`${BASE_URL}/spreads/history`,
                { exchange1: ex1, underlying1: und1, expiry_code1: exp1?.code,
                  strike1: row.stk1, type1: 'CE',
                  exchange2: ex2, underlying2: und2, expiry_code2: exp2?.code,
                  strike2: row.stk2, type2: 'CE', ratio },
                { params: { trade_date: dateStr, resolution: '1' }, headers: { Authorization: authHeader } }),
              axios.post(`${BASE_URL}/spreads/history`,
                { exchange1: ex1, underlying1: und1, expiry_code1: exp1?.code,
                  strike1: row.stk1, type1: 'PE',
                  exchange2: ex2, underlying2: und2, expiry_code2: exp2?.code,
                  strike2: row.stk2, type2: 'PE', ratio },
                { params: { trade_date: dateStr, resolution: '1' }, headers: { Authorization: authHeader } }),
            ])
            const ceData = ceResp.data?.data || []
            const peData = peResp.data?.data || []
            const tsMap = {}
            ceData.forEach(d2 => { tsMap[d2.timestamp] = { timestamp: d2.timestamp, ce: d2.spread } })
            peData.forEach(d2 => { if (tsMap[d2.timestamp]) tsMap[d2.timestamp].pe = d2.spread })
            Object.values(tsMap).filter(d2 => d2.ce != null && d2.pe != null).forEach(d2 => {
              frames.push({ timestamp: d2.timestamp, spread: round2(d2.ce + d2.pe), date: dateStr })
            })
          } catch (e) { console.error(e) }
          collected++
        }
        d.setDate(d.getDate() - 1)
      }
      setHistData(frames.reverse())
    } catch (err) { console.error(err) }
    finally { setHistLoading(false) }
  }, [selectedIdx, rows, histPeriod, ex1, und1, exp1, ex2, und2, exp2, ratio, tradeDate, authHeader])

  const selectedRow = rows[selectedIdx]
  const chartTitle = selectedRow
    ? `${und1} ${selectedRow.stk1} vs ${und2} ${selectedRow.stk2} · CE+PE Straddle`
    : ''

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-bright tracking-tight">Straddle Spread — NFO-BFO</h1>
        <p className="text-sm text-ink mt-1">
          Formula: (Leg1<span className="text-cyan">CE</span> − Leg2<span className="text-cyan">CE</span>×Ratio) + (Leg3<span className="text-amber-400">PE</span> − Leg4<span className="text-amber-400">PE</span>×Ratio)
        </p>
      </div>

      {/* Controls */}
      <div className="bg-panel border border-edge rounded-2xl p-5 mb-6">

        {/* Leg selectors */}
        <div className="grid grid-cols-2 gap-6 mb-4">

          {/* Leg 1 & 3 */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full bg-blue" />
              <span className="text-xs font-mono font-semibold text-bright">Leg 1 (CE) &amp; Leg 3 (PE)</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Exchange</label>
                <select value={ex1} onChange={e => { setEx1(e.target.value); setUnd1(UNDERLYINGS[e.target.value][0]) }}
                  className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan">
                  <option>BSE</option><option>NSE</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Index</label>
                <select value={und1} onChange={e => setUnd1(e.target.value)}
                  className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan">
                  {(UNDERLYINGS[ex1] || []).map(u => <option key={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">
                  Expiry {loadingExp && <span className="text-cyan">...</span>}
                </label>
                <select value={exp1?.code || ''} onChange={e => setExp1(exp1List.find(x => x.code === e.target.value))}
                  className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan">
                  {exp1List.length ? exp1List.map(e => <option key={e.code} value={e.code}>{e.label}</option>)
                    : <option value="">Loading...</option>}
                </select>
              </div>
            </div>
          </div>

          {/* Leg 2 & 4 */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full bg-cyan" />
              <span className="text-xs font-mono font-semibold text-bright">Leg 2 (CE) &amp; Leg 4 (PE)</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Exchange</label>
                <select value={ex2} onChange={e => { setEx2(e.target.value); setUnd2(UNDERLYINGS[e.target.value][0]) }}
                  className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan">
                  <option>NSE</option><option>BSE</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Index</label>
                <select value={und2} onChange={e => setUnd2(e.target.value)}
                  className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan">
                  {(UNDERLYINGS[ex2] || []).map(u => <option key={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Expiry</label>
                <select value={exp2?.code || ''} onChange={e => setExp2(exp2List.find(x => x.code === e.target.value))}
                  className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan">
                  {exp2List.length ? exp2List.map(e => <option key={e.code} value={e.code}>{e.label}</option>)
                    : <option value="">Loading...</option>}
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Ladder params */}
        <div className="grid grid-cols-5 gap-3 mb-4">
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
          <div>
            <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Date</label>
            <input type="date" value={tradeDate} onChange={e => setTradeDate(e.target.value)}
              max={new Date().toISOString().split('T')[0]}
              className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan" />
          </div>
        </div>

        <button onClick={handleFetchData} disabled={loading}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-cyan text-void font-bold text-sm hover:bg-cyan/90 transition-all disabled:opacity-50">
          {loading
            ? <><svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Fetching...</>
            : 'Fetch Straddle Spread Data'}
        </button>
      </div>

      {/* Table */}
      <div className="bg-panel border border-edge rounded-2xl overflow-hidden mb-4">
        <div className="flex items-center justify-between px-5 py-3 border-b border-edge">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-cyan animate-pulse" />
            <span className="text-xs font-mono font-semibold text-ink uppercase tracking-wider">
              Straddle Spread Monitor
            </span>
          </div>
          <span className="text-[10px] font-mono text-ink/60">
            Ratio: <span className="text-bright">×{ratio}</span> · Multiplier: <span className="text-bright">×{multiplier}</span>
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-edge bg-panelLight/40">
                {['First Strike','Second Strike','CE Spread','PE Spread','Total (CE+PE)','Action'].map(h => (
                  <th key={h} className="table-header text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-ink font-mono text-sm">
                    {loading ? 'Fetching data...' : 'Click "Fetch Straddle Spread Data" to load'}
                  </td>
                </tr>
              ) : rows.map((row, i) => (
                <tr key={i}
                  className={`border-b border-edge/40 hover:bg-panelLight/40 transition-colors
                    ${selectedIdx === i ? 'bg-cyan/5 border-l-2 border-l-cyan' : ''}`}>
                  <td className="table-cell font-bold text-bright">{row.stk1}</td>
                  <td className="table-cell text-ink">{row.stk2}</td>
                  <td className={`table-cell ${valColor(row.ceSpread)}`}>{fmtVal(row.ceSpread)}</td>
                  <td className={`table-cell ${valColor(row.peSpread)}`}>{fmtVal(row.peSpread)}</td>
                  <td className={`table-cell text-lg font-bold ${valColor(row.total)}`}>{fmtVal(row.total)}</td>
                  <td className="table-cell">
                    <button onClick={() => handleViewChart(i, row.stk1, row.stk2)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all
                        ${selectedIdx === i ? 'bg-cyan text-void' : 'bg-panelLight border border-edge text-ink hover:text-bright hover:border-cyan/50'}`}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                      </svg>
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
              <span className="text-sm font-semibold text-bright">{chartTitle}</span>
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
                  <p className={`text-lg font-bold font-mono ${s.color}`}>{s.value != null ? fmtVal(s.value) : '—'}</p>
                </div>
              ))}
            </div>
          )}

          {chartLoading
            ? <div className="flex items-center justify-center h-[380px]">
                <svg className="animate-spin w-8 h-8 text-cyan" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              </div>
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
                  className={`px-3 py-1 rounded-lg text-xs font-mono font-semibold transition-all
                    ${histPeriod === p ? 'bg-cyan text-void' : 'bg-panelLight border border-edge text-ink hover:text-bright'}`}>
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

// Helpers
function round2(v) { return Math.round(v * 100) / 100 }

function formatExpCode(code) {
  if (!code) return ''
  if (/[a-zA-Z]/.test(code)) return code.toUpperCase()
  const yy = code.slice(0, 2)
  const mm = String(parseInt(code.slice(2, 4)))
  const dd = code.slice(4, 6)
  return `${yy}${mm}${dd}`
}

function buildBatchRows(strikes, stk2List, exp1, exp2) {
  return strikes.map((stk1, i) => ({
    exchange1: 'BSE', underlying1: 'SENSEX', expiry_code1: exp1?.code || '',
    strike1: stk1, type1: 'CE',
    exchange2: 'NSE', underlying2: 'NIFTY', expiry_code2: exp2?.code || '',
    strike2: stk2List[i], type2: 'CE', ratio: 1,
  }))
}
