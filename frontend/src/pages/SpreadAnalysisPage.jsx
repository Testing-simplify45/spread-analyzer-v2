import { useState, useEffect, useCallback } from 'react'
import { useAuthStore } from '../hooks/useAuthStore'
import { getExpiries, fetchSpreadHistory, fetchMultiDayHistory } from '../utils/api'
import SpreadChart, { HistoricalChart } from '../components/SpreadChart'
import { computeStatsFromData } from '../utils/computeStats'

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

function fmtVal(v) {
  if (v == null) return '—'
  return (v > 0 ? '+' : '') + v.toFixed(2)
}

export default function SpreadAnalysisPage() {
  const { getAuthHeader } = useAuthStore()
  const authHeader = getAuthHeader()

  const [ex1,      setEx1]      = useState('NSE')
  const [und1,     setUnd1]     = useState('NIFTY')
  const [exp1List, setExp1List] = useState([])
  const [exp1,     setExp1]     = useState(null)
  const [strike1,  setStrike1]  = useState(ATM_DEFAULTS['NIFTY'])
  const [type1,    setType1]    = useState('CE')

  const [ex2,      setEx2]      = useState('BSE')
  const [und2,     setUnd2]     = useState('SENSEX')
  const [exp2List, setExp2List] = useState([])
  const [exp2,     setExp2]     = useState(null)
  const [strike2,  setStrike2]  = useState(ATM_DEFAULTS['SENSEX'])
  const [type2,    setType2]    = useState('CE')

  const [tradeDate,   setTradeDate]   = useState(new Date().toISOString().split('T')[0])
  const [loading,     setLoading]     = useState(false)
  const [chartData,   setChartData]   = useState([])
  const [chartType,   setChartType]   = useState('line')
  const [resolution,  setResolution]  = useState('1min')
  const [histData,    setHistData]    = useState([])
  const [histPeriod,  setHistPeriod]  = useState('1D')
  const [histLoading, setHistLoading] = useState(false)
  const [loadingExp1, setLoadingExp1] = useState(false)
  const [loadingExp2, setLoadingExp2] = useState(false)

  // Compute stats from actual chart data
  const chartStats = computeStatsFromData(chartData)

  useEffect(() => { loadExp1() }, [und1])
  useEffect(() => { loadExp2() }, [und2])
  useEffect(() => { setStrike1(ATM_DEFAULTS[und1] || 25000) }, [und1])
  useEffect(() => { setStrike2(ATM_DEFAULTS[und2] || 25000) }, [und2])

  const loadExp1 = async () => {
    setLoadingExp1(true)
    try {
      const list = await getExpiries(und1, authHeader)
      setExp1List(list || [])
      if (list?.length) setExp1(list[0])
    } catch (e) { console.error(e) }
    finally { setLoadingExp1(false) }
  }

  const loadExp2 = async () => {
    setLoadingExp2(true)
    try {
      const list = await getExpiries(und2, authHeader)
      setExp2List(list || [])
      if (list?.length) setExp2(list[0])
    } catch (e) { console.error(e) }
    finally { setLoadingExp2(false) }
  }

  const handleFetch = useCallback(async () => {
    if (!exp1?.code || !exp2?.code) { alert('Please wait for expiries to load'); return }
    setLoading(true)
    setChartData([])
    try {
      // Spread = Leg2 - Leg1 (ratio=1)
      const rowDef = {
        exchange1: ex2, underlying1: und2, expiry_code1: exp2.code,
        strike1: strike2, type1: type2,
        exchange2: ex1, underlying2: und1, expiry_code2: exp1.code,
        strike2: strike1, type2: type1,
        ratio: 1.0,
      }
      const result = await fetchSpreadHistory(rowDef, tradeDate, '1', authHeader)
      setChartData(result.data || [])
    } catch (err) {
      console.error(err)
      alert('Failed to fetch data')
    } finally {
      setLoading(false)
    }
  }, [ex1, und1, exp1, strike1, type1, ex2, und2, exp2, strike2, type2, tradeDate, authHeader])

  const handleLoadHistory = useCallback(async () => {
    if (!exp1?.code || !exp2?.code) return
    const daysMap = { '1D': 1, '5D': 5, '1M': 22, '6M': 130 }
    setHistLoading(true)
    try {
      const rowDef = {
        exchange1: ex2, underlying1: und2, expiry_code1: exp2.code,
        strike1: strike2, type1: type2,
        exchange2: ex1, underlying2: und1, expiry_code2: exp1.code,
        strike2: strike1, type2: type1,
        ratio: 1.0,
      }
      const result = await fetchMultiDayHistory(rowDef, daysMap[histPeriod], '1', authHeader)
      setHistData(result.data || [])
    } catch (err) { console.error(err) }
    finally { setHistLoading(false) }
  }, [exp1, exp2, strike1, strike2, type1, type2, histPeriod, authHeader, ex1, und1, ex2, und2])

  const chartTitle = `${und2} ${strike2}${type2} − ${und1} ${strike1}${type1}`

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-bright tracking-tight">Spread Analysis</h1>
        <p className="text-sm text-ink mt-1">Formula: Leg 2 − Leg 1</p>
      </div>

      {/* Controls */}
      <div className="bg-panel border border-edge rounded-2xl p-5 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">

          {/* Leg 1 */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full bg-blue" />
              <span className="text-sm font-semibold text-bright font-mono">Leg 1</span>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Exchange</label>
                <select value={ex1} onChange={e => { setEx1(e.target.value); setUnd1(UNDERLYINGS[e.target.value][0]) }}
                  className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan">
                  <option>NSE</option><option>BSE</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Index</label>
                <select value={und1} onChange={e => setUnd1(e.target.value)}
                  className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan">
                  {(UNDERLYINGS[ex1] || []).map(u => <option key={u}>{u}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">
                  Expiry {loadingExp1 && <span className="text-cyan">...</span>}
                </label>
                <select value={exp1?.code || ''} onChange={e => setExp1(exp1List.find(x => x.code === e.target.value))}
                  className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan">
                  {exp1List.length ? exp1List.map(e => <option key={e.code} value={e.code}>{e.label}</option>)
                    : <option value="">Loading...</option>}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Strike</label>
                <input type="number" value={strike1} onChange={e => setStrike1(Number(e.target.value))}
                  step={GAP_DEFAULTS[und1] || 50}
                  className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan" />
              </div>
              <div>
                <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Type</label>
                <select value={type1} onChange={e => setType1(e.target.value)}
                  className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan">
                  <option>CE</option><option>PE</option>
                </select>
              </div>
            </div>
          </div>

          {/* Leg 2 */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full bg-cyan" />
              <span className="text-sm font-semibold text-bright font-mono">Leg 2</span>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Exchange</label>
                <select value={ex2} onChange={e => { setEx2(e.target.value); setUnd2(UNDERLYINGS[e.target.value][0]) }}
                  className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan">
                  <option>BSE</option><option>NSE</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Index</label>
                <select value={und2} onChange={e => setUnd2(e.target.value)}
                  className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan">
                  {(UNDERLYINGS[ex2] || []).map(u => <option key={u}>{u}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">
                  Expiry {loadingExp2 && <span className="text-cyan">...</span>}
                </label>
                <select value={exp2?.code || ''} onChange={e => setExp2(exp2List.find(x => x.code === e.target.value))}
                  className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan">
                  {exp2List.length ? exp2List.map(e => <option key={e.code} value={e.code}>{e.label}</option>)
                    : <option value="">Loading...</option>}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Strike</label>
                <input type="number" value={strike2} onChange={e => setStrike2(Number(e.target.value))}
                  step={GAP_DEFAULTS[und2] || 50}
                  className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan" />
              </div>
              <div>
                <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Type</label>
                <select value={type2} onChange={e => setType2(e.target.value)}
                  className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan">
                  <option>CE</option><option>PE</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <input type="date" value={tradeDate} onChange={e => setTradeDate(e.target.value)}
            max={new Date().toISOString().split('T')[0]}
            className="bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan" />
          <button onClick={handleFetch} disabled={loading}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-cyan text-void font-bold text-sm hover:bg-cyan/90 transition-all disabled:opacity-50">
            {loading ? (
              <><svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Fetching...</>
            ) : 'Fetch Spread Data'}
          </button>
        </div>
      </div>

      {/* Stats — computed from actual chart data */}
      {chartStats && (
        <div className="grid grid-cols-4 gap-3 mb-4">
          {[
            { label: 'Open',    value: chartStats.open,    color: 'text-bright' },
            { label: 'High',    value: chartStats.high,    color: 'text-emerald' },
            { label: 'Low',     value: chartStats.low,     color: 'text-crimson' },
            { label: 'Current', value: chartStats.current, color: 'text-cyan' },
          ].map(s => (
            <div key={s.label} className="bg-panel border border-edge rounded-xl p-4">
              <p className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1">{s.label}</p>
              <p className={`text-xl font-bold font-mono ${s.color}`}>
                {s.value != null ? fmtVal(s.value) : '—'}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Chart */}
      {chartData.length > 0 && (
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
          <SpreadChart data={chartData} stats={chartStats} title={chartTitle} type={chartType} resolution={resolution} />
        </div>
      )}

      {/* Historical */}
      {chartData.length > 0 && (
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
