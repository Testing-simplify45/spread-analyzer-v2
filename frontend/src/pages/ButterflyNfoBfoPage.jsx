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

export default function ButterflyNfoBfoPage() {
  const { getAuthHeader } = useAuthStore()
  const authHeader = getAuthHeader()

  const [leg1Underlying, setLeg1Underlying] = useState('NIFTY')
  const leg2Underlying = leg1Underlying === 'NIFTY' ? 'SENSEX' : 'NIFTY'
  const leg3Underlying = leg1Underlying
  const leg1Exchange   = leg1Underlying === 'NIFTY' ? 'NSE' : 'BSE'
  const leg2Exchange   = leg2Underlying === 'NIFTY' ? 'NSE' : 'BSE'
  const leg3Exchange   = leg1Exchange

  const [leg1ExpList, setLeg1ExpList] = useState([])
  const [leg2ExpList, setLeg2ExpList] = useState([])
  const [loadingExp,  setLoadingExp]  = useState(false)

  const [exp1,     setExp1]     = useState(null)
  const [strike1,  setStrike1]  = useState(23300)
  const [exp2a,    setExp2a]    = useState(null)
  const [strike2a, setStrike2a] = useState(77000)
  const [exp2b,    setExp2b]    = useState(null)
  const [strike2b, setStrike2b] = useState(77000)
  const [exp3,     setExp3]     = useState(null)
  const [strike3,  setStrike3]  = useState(23300)

  const [type,      setType]      = useState('CE')
  const [ratio,     setRatio]     = useState(3.3)
  const [tradeDate, setTradeDate] = useState(new Date().toISOString().split('T')[0])

  const [loading,    setLoading]    = useState(false)
  const [chartData,  setChartData]  = useState([])
  const [chartType,  setChartType]  = useState('line')
  const [resolution, setResolution] = useState('1min')
  const [histData,   setHistData]   = useState([])
  const [histPeriod, setHistPeriod] = useState('1D')
  const [histLoading,setHistLoading]= useState(false)

  // Compute stats from actual chart data
  const chartStats = computeStatsFromData(chartData)

  useEffect(() => { loadExpiries() }, [leg1Underlying])
  useEffect(() => {
    if (leg1Underlying === 'NIFTY') {
      setStrike1(23300); setStrike3(23300)
      setStrike2a(77000); setStrike2b(77000)
    } else {
      setStrike1(77000); setStrike3(77000)
      setStrike2a(23300); setStrike2b(23300)
    }
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

  const handleFetch = useCallback(async () => {
    if (!exp1?.code || !exp2a?.code || !exp2b?.code || !exp3?.code) {
      alert('Please wait for expiries to load'); return
    }
    setLoading(true)
    setChartData([])
    try {
      const res = await axios.post(`${BASE_URL}/spreads/butterfly-nfobfo`, {
        leg1_exchange: leg1Exchange, leg1_underlying: leg1Underlying,
        leg1_expiry: exp1.code, leg1_strike: strike1,
        leg2a_exchange: leg2Exchange, leg2a_underlying: leg2Underlying,
        leg2a_expiry: exp2a.code, leg2a_strike: strike2a,
        leg2b_exchange: leg2Exchange, leg2b_underlying: leg2Underlying,
        leg2b_expiry: exp2b.code, leg2b_strike: strike2b,
        leg3_exchange: leg3Exchange, leg3_underlying: leg3Underlying,
        leg3_expiry: exp3.code, leg3_strike: strike3,
        option_type: type, ratio, trade_date: tradeDate, resolution: '1',
      }, { headers: { Authorization: authHeader } })
      setChartData(res.data.data || [])
    } catch (err) {
      console.error(err)
      alert('Failed to fetch butterfly NFO-BFO data')
    } finally {
      setLoading(false)
    }
  }, [leg1Exchange, leg1Underlying, exp1, strike1,
      leg2Exchange, leg2Underlying, exp2a, strike2a, exp2b, strike2b,
      leg3Exchange, leg3Underlying, exp3, strike3,
      type, ratio, tradeDate, authHeader])

  const handleLoadHistory = useCallback(async () => {
    if (!exp1?.code || !exp2a?.code || !exp2b?.code || !exp3?.code) return
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
            const res = await axios.post(`${BASE_URL}/spreads/butterfly-nfobfo`, {
              leg1_exchange: leg1Exchange, leg1_underlying: leg1Underlying,
              leg1_expiry: exp1.code, leg1_strike: strike1,
              leg2a_exchange: leg2Exchange, leg2a_underlying: leg2Underlying,
              leg2a_expiry: exp2a.code, leg2a_strike: strike2a,
              leg2b_exchange: leg2Exchange, leg2b_underlying: leg2Underlying,
              leg2b_expiry: exp2b.code, leg2b_strike: strike2b,
              leg3_exchange: leg3Exchange, leg3_underlying: leg3Underlying,
              leg3_expiry: exp3.code, leg3_strike: strike3,
              option_type: type, ratio, trade_date: dateStr, resolution: '1',
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
  }, [exp1, exp2a, exp2b, exp3, strike1, strike2a, strike2b, strike3,
      leg1Exchange, leg1Underlying, leg2Exchange, leg2Underlying,
      leg3Exchange, leg3Underlying, type, ratio, tradeDate, histPeriod, authHeader])

  const chartTitle = `${leg2Underlying} − ${leg1Underlying}×${ratio} + ${leg2Underlying} − ${leg3Underlying}×${ratio}`

  const expSelect = (list, val, onChange) => (
    <select value={val?.code || ''} onChange={e => onChange(list.find(x => x.code === e.target.value))}
      className="w-full bg-panel border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan">
      {list.length ? list.map(e => <option key={e.code} value={e.code}>{e.label}</option>)
        : <option value="">{loadingExp ? 'Loading...' : '— Load —'}</option>}
    </select>
  )

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-bright tracking-tight">Butterfly Spread — NFO-BFO</h1>
        <p className="text-sm text-ink mt-1">Formula: (Leg2 − Leg1×Ratio) + (Leg2 − Leg3×Ratio)</p>
      </div>

      {/* Controls */}
      <div className="bg-panel border border-edge rounded-2xl p-5 mb-6">
        <div className="grid grid-cols-4 gap-3 mb-5">
          <div>
            <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Leg 1 / Leg 3</label>
            <select value={leg1Underlying} onChange={e => setLeg1Underlying(e.target.value)}
              className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan">
              <option>NIFTY</option><option>SENSEX</option>
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
            <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Ratio</label>
            <input type="number" value={ratio} onChange={e => setRatio(Number(e.target.value))} step={0.01}
              className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan" />
          </div>
          <div>
            <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Date</label>
            <input type="date" value={tradeDate} onChange={e => setTradeDate(e.target.value)}
              max={new Date().toISOString().split('T')[0]}
              className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan" />
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
          {/* Leg 1 */}
          <div className="bg-panelLight/40 border border-edge rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full bg-blue" />
              <span className="text-xs font-mono font-semibold text-bright">Leg 1</span>
              <span className="text-[10px] font-mono text-ink">{leg1Underlying}</span>
            </div>
            <div className="space-y-2">
              <div>
                <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">
                  Expiry {loadingExp && <span className="text-cyan">...</span>}
                </label>
                {expSelect(leg1ExpList, exp1, setExp1)}
              </div>
              <div>
                <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Strike</label>
                <input type="number" value={strike1} onChange={e => setStrike1(Number(e.target.value))} step={50}
                  className="w-full bg-panel border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan" />
              </div>
            </div>
          </div>

          {/* Leg 2a */}
          <div className="bg-panelLight/40 border border-cyan/20 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full bg-cyan" />
              <span className="text-xs font-mono font-semibold text-bright">Leg 2 (Spread 1)</span>
              <span className="text-[10px] font-mono text-ink">{leg2Underlying}</span>
            </div>
            <div className="space-y-2">
              <div>
                <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Expiry</label>
                {expSelect(leg2ExpList, exp2a, setExp2a)}
              </div>
              <div>
                <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Strike</label>
                <input type="number" value={strike2a} onChange={e => setStrike2a(Number(e.target.value))} step={100}
                  className="w-full bg-panel border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan" />
              </div>
            </div>
          </div>

          {/* Leg 2b */}
          <div className="bg-panelLight/40 border border-cyan/20 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full bg-cyan" />
              <span className="text-xs font-mono font-semibold text-bright">Leg 2 (Spread 2)</span>
              <span className="text-[10px] font-mono text-ink">{leg2Underlying}</span>
            </div>
            <div className="space-y-2">
              <div>
                <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Expiry</label>
                {expSelect(leg2ExpList, exp2b, setExp2b)}
              </div>
              <div>
                <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Strike</label>
                <input type="number" value={strike2b} onChange={e => setStrike2b(Number(e.target.value))} step={100}
                  className="w-full bg-panel border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan" />
              </div>
            </div>
          </div>

          {/* Leg 3 */}
          <div className="bg-panelLight/40 border border-edge rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full bg-emerald" />
              <span className="text-xs font-mono font-semibold text-bright">Leg 3</span>
              <span className="text-[10px] font-mono text-ink">{leg3Underlying}</span>
            </div>
            <div className="space-y-2">
              <div>
                <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Expiry</label>
                {expSelect(leg1ExpList, exp3, setExp3)}
              </div>
              <div>
                <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Strike</label>
                <input type="number" value={strike3} onChange={e => setStrike3(Number(e.target.value))} step={50}
                  className="w-full bg-panel border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan" />
              </div>
            </div>
          </div>
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
          <HistoricalChart data={histData} title={`Butterfly NFO-BFO — ${histPeriod}`} />
        </div>
      )}
    </div>
  )
}
