import { useState, useEffect, useCallback } from 'react'
import { useAuthStore } from '../hooks/useAuthStore'
import { getExpiries } from '../utils/api'
import SpreadChart, { HistoricalChart } from '../components/SpreadChart'
import { computeStatsFromData } from '../utils/computeStats'
import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL || '/api'

function fmtVal(v) {
  if (v == null) return '—'
  return (v > 0 ? '+' : '') + v.toFixed(2)
}

export default function ButterflyIndexPage() {
  const { getAuthHeader } = useAuthStore()
  const authHeader = getAuthHeader()

  const [exchange,   setExchange]   = useState('NSE')
  const [expList,    setExpList]    = useState([])
  const [loadingExp, setLoadingExp] = useState(false)
  const [type,       setType]       = useState('CE')
  const [tradeDate,  setTradeDate]  = useState(new Date().toISOString().split('T')[0])

  const [exp1,    setExp1]    = useState(null)
  const [strike1, setStrike1] = useState(23300)
  const [exp2,    setExp2]    = useState(null)
  const [strike2, setStrike2] = useState(23300)
  const [exp3,    setExp3]    = useState(null)
  const [strike3, setStrike3] = useState(23300)

  const [loading,    setLoading]    = useState(false)
  const [chartData,  setChartData]  = useState([])
  const [chartType,  setChartType]  = useState('line')
  const [resolution, setResolution] = useState('1min')
  const [histData,   setHistData]   = useState([])
  const [histPeriod, setHistPeriod] = useState('1D')
  const [histLoading,setHistLoading]= useState(false)

  // Compute stats from actual chart data
  const chartStats = computeStatsFromData(chartData)

  useEffect(() => { loadExpiries() }, [exchange])

  const loadExpiries = async () => {
    setLoadingExp(true)
    try {
      const list = await getExpiries('NIFTY', authHeader)
      setExpList(list || [])
      if (list?.length) { setExp1(list[0]); setExp2(list[0]); setExp3(list[0]) }
    } catch (e) { console.error(e) }
    finally { setLoadingExp(false) }
  }

  const handleFetch = useCallback(async () => {
    if (!exp1?.code || !exp2?.code || !exp3?.code) { alert('Please wait for expiries to load'); return }
    setLoading(true)
    setChartData([])
    try {
      const res = await axios.post(`${BASE_URL}/spreads/butterfly-index`, {
        exchange, underlying: 'NIFTY',
        exp1: exp1.code, strike1, type,
        exp2: exp2.code, strike2,
        exp3: exp3.code, strike3,
        trade_date: tradeDate, resolution: '1',
      }, { headers: { Authorization: authHeader } })
      setChartData(res.data.data || [])
    } catch (err) {
      console.error(err)
      alert('Failed to fetch butterfly spread data')
    } finally {
      setLoading(false)
    }
  }, [exchange, exp1, strike1, exp2, strike2, exp3, strike3, type, tradeDate, authHeader])

  const handleLoadHistory = useCallback(async () => {
    if (!exp1?.code || !exp2?.code || !exp3?.code) return
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
            const res = await axios.post(`${BASE_URL}/spreads/butterfly-index`, {
              exchange, underlying: 'NIFTY',
              exp1: exp1.code, strike1, type,
              exp2: exp2.code, strike2,
              exp3: exp3.code, strike3,
              trade_date: dateStr, resolution: '1',
            }, { headers: { Authorization: authHeader } })
            if (res.data.data?.length) {
              frames.push(...res.data.data.map(r => ({ ...r, date: dateStr })))
            }
          } catch (e) { console.error(e) }
          collected++
        }
        d.setDate(d.getDate() - 1)
      }
      setHistData(frames.reverse())
    } catch (err) { console.error(err) }
    finally { setHistLoading(false) }
  }, [exp1, exp2, exp3, strike1, strike2, strike3, type, tradeDate, histPeriod, exchange, authHeader])

  const chartTitle = `${exchange} NIFTY Butterfly · ${strike1}/${strike2}/${strike3} ${type}`

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-bright tracking-tight">Butterfly Spread — Index</h1>
        <p className="text-sm text-ink mt-1">Formula: (Leg3 − Leg2) − (Leg2 − Leg1)</p>
      </div>

      {/* Controls */}
      <div className="bg-panel border border-edge rounded-2xl p-5 mb-6">
        <div className="grid grid-cols-3 gap-3 mb-5">
          <div>
            <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Exchange</label>
            <select value={exchange} onChange={e => setExchange(e.target.value)}
              className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan">
              <option>NSE</option><option>BSE</option>
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
            <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Date</label>
            <input type="date" value={tradeDate} onChange={e => setTradeDate(e.target.value)}
              max={new Date().toISOString().split('T')[0]}
              className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan" />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-5">
          {[
            { label: 'Leg 1', exp: exp1, setExp: setExp1, strike: strike1, setStrike: setStrike1, color: 'bg-blue' },
            { label: 'Leg 2 (Middle)', exp: exp2, setExp: setExp2, strike: strike2, setStrike: setStrike2, color: 'bg-cyan' },
            { label: 'Leg 3', exp: exp3, setExp: setExp3, strike: strike3, setStrike: setStrike3, color: 'bg-emerald' },
          ].map(leg => (
            <div key={leg.label} className="bg-panelLight/40 border border-edge rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className={`w-2 h-2 rounded-full ${leg.color}`} />
                <span className="text-xs font-mono font-semibold text-bright">{leg.label}</span>
                <span className="text-[10px] font-mono text-ink ml-1">NIFTY</span>
              </div>
              <div className="space-y-2">
                <div>
                  <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">
                    Expiry {loadingExp && <span className="text-cyan">...</span>}
                  </label>
                  <select value={leg.exp?.code || ''} onChange={e => leg.setExp(expList.find(x => x.code === e.target.value))}
                    className="w-full bg-panel border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan">
                    {expList.length ? expList.map(e => <option key={e.code} value={e.code}>{e.label}</option>)
                      : <option value="">Loading...</option>}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Strike</label>
                  <input type="number" value={leg.strike} onChange={e => leg.setStrike(Number(e.target.value))} step={50}
                    className="w-full bg-panel border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan" />
                </div>
              </div>
            </div>
          ))}
        </div>

        <button onClick={handleFetch} disabled={loading}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-cyan text-void font-bold text-sm hover:bg-cyan/90 transition-all disabled:opacity-50">
          {loading
            ? <><svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Fetching...</>
            : '🦋 Fetch Butterfly Data'}
        </button>
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
              <p className={`text-xl font-bold font-mono ${s.color}`}>{s.value != null ? fmtVal(s.value) : '—'}</p>
            </div>
          ))}
        </div>
      )}

      {/* Chart */}
      {chartData.length > 0 && (
        <div className="bg-panel border border-edge rounded-2xl p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-lg bg-cyan/10 border border-cyan/20 flex items-center justify-center text-cyan text-xs">🦋</div>
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
              <span className="text-sm font-semibold text-bright">Historical Trend</span>
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
