import { useState, useEffect, useCallback, useRef, useImperativeHandle, forwardRef } from 'react'
import { useAuthStore } from '../hooks/useAuthStore'
import { getExpiries } from '../utils/api'
import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL || '/api'

const INDEXES = ['NIFTY', 'BANKNIFTY', 'SENSEX', 'BANKEX', 'FINNIFTY', 'MIDCPNIFTY']
const EXCHANGE_MAP = { NIFTY: 'NSE', BANKNIFTY: 'NSE', FINNIFTY: 'NSE', MIDCPNIFTY: 'NSE', SENSEX: 'BSE', BANKEX: 'BSE' }

const STRATEGIES = [
  { value: 'index_p1',    label: 'Index Pair Part 1 (Calendar)' },
  { value: 'index_p2',    label: 'Index Pair Part 2 (Interval)' },
  { value: 'nfo_bfo',     label: 'NFO/BFO Spread' },
  { value: 'butterfly_index', label: 'Butterfly Index' },
  { value: 'butterfly_nfo',   label: 'Butterfly NFO/BFO' },
]

// ── Formula helpers ───────────────────────────────────────────────────────────
function computeSpread(strategy, ltp1, ltp2, ltp3, ratio, multiplier) {
  const r = ratio || 1
  const m = multiplier || 3.3
  if (ltp1 == null) return null

  switch (strategy) {
    case 'index_p1':
    case 'index_p2':
      if (ltp2 == null) return null
      return round2(ltp1 - (ltp2 * r))
    case 'nfo_bfo':
      if (ltp2 == null) return null
      return round2(ltp1 - (ltp2 * m * r))
    case 'butterfly_index':
      if (ltp2 == null || ltp3 == null) return null
      return round2(ltp1 - (ltp2 * r) - (ltp2 * r) + ltp3)
    case 'butterfly_nfo':
      if (ltp2 == null || ltp3 == null) return null
      return round2(ltp1 - (ltp2 * m * r) - (ltp2 * m * r) + ltp3)
    default:
      return null
  }
}

function round2(v) { return Math.round(v * 100) / 100 }

function fmtVal(v) {
  if (v == null) return '—'
  return (v > 0 ? '+' : '') + v.toFixed(2)
}
function valColor(v) {
  if (v == null) return 'text-ink'
  return v > 0 ? 'text-emerald' : v < 0 ? 'text-crimson' : 'text-ink'
}
function statusBadge(current, d3High, d3Low, prevClose) {
  const badges = []
  if (current != null && d3High != null && d3Low != null) {
    if (current >= d3High - 1) badges.push({ label: 'Near 3D High', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' })
    if (current >= d3High + 5) badges.push({ label: 'Above 3D High', color: 'bg-crimson/20 text-crimson border-crimson/30' })
    if (current <= d3Low + 1)  badges.push({ label: 'Near 3D Low',  color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' })
    if (current <= d3Low - 5)  badges.push({ label: 'Below 3D Low', color: 'bg-crimson/20 text-crimson border-crimson/30' })
  }
  if (current != null && prevClose != null) {
    if (current >= prevClose + 10) badges.push({ label: `PC +${(current - prevClose).toFixed(1)}`, color: 'bg-blue/20 text-blue border-blue/30' })
    if (current <= prevClose - 10) badges.push({ label: `PC -${(prevClose - current).toFixed(1)}`, color: 'bg-purple-400/20 text-purple-400 border-purple-400/30' })
  }
  return badges
}

// ── Strike generator ──────────────────────────────────────────────────────────
function generateStrikes(strategy, atm, addon, interval) {
  if (strategy === 'index_p1' || strategy === 'index_p2') {
    // ATM + 3 OTM for CE, ATM - 3 OTM for PE (returned as one list, split in table)
    return {
      ce: [atm, atm + addon, atm + 2*addon, atm + 3*addon],
      pe: [atm, atm - addon, atm - 2*addon, atm - 3*addon],
    }
  }
  // All other spreads: ATM + 5 strikes
  return {
    ce: [atm, atm + addon, atm + 2*addon, atm + 3*addon, atm + 4*addon, atm + 5*addon],
    pe: [atm, atm - addon, atm - 2*addon, atm - 3*addon, atm - 4*addon, atm - 5*addon],
  }
}

// ── Section component ─────────────────────────────────────────────────────────
const MonitorSection = forwardRef(function MonitorSection({ section, authHeader, onUpdate, onRemove }, ref) {
  const [expList,      setExpList]      = useState([])
  const [ceStrikes,    setCeStrikes]    = useState([])
  const [peStrikes,    setPeStrikes]    = useState([])
  const [atm,          setAtm]          = useState(null)
  const [ceData,       setCeData]       = useState([])
  const [peData,       setPeData]       = useState([])
  const [lastUpdated,  setLastUpdated]  = useState(null)
  const [refreshCount, setRefreshCount] = useState(0)
  const [loadingAtm,   setLoadingAtm]   = useState(false)
  const [loadingLive,  setLoadingLive]  = useState(false)
  const [loadingRange, setLoadingRange] = useState(false)
  const [d3Ranges,     setD3Ranges]     = useState(section.d3_ranges || {})
  const [d5Ranges,     setD5Ranges]     = useState({})
  const [prevClose,    setPrevClose]    = useState({})
  const intervalRef = useRef(null)

  const strategy   = section.strategy   || 'index_p1'
  const exchange   = EXCHANGE_MAP[section.index] || 'NSE'
  const ratio      = section.ratio      ?? 1
  const multiplier = section.multiplier ?? 3.3
  const interval   = section.interval   ?? 100

  const isButterfly = strategy === 'butterfly_index' || strategy === 'butterfly_nfo'
  const isIndexP2   = strategy === 'index_p2'
  const isNfoBfo    = strategy === 'nfo_bfo'

  useEffect(() => { loadExpiries() }, [section.index])

  const loadExpiries = async () => {
    try {
      const list = await getExpiries(section.index, authHeader)
      setExpList(list || [])
    } catch (e) { console.error(e) }
  }

  // Fetch ATM and compute strikes
  const fetchAtmAndStrikes = useCallback(async () => {
    setLoadingAtm(true)
    try {
      const res = await axios.get(`${BASE_URL}/monitor/atm/${section.index}`, {
        params: { addon: section.addon, strategy, interval },
        headers: { Authorization: authHeader }
      })
      const atmVal = res.data.atm
      setAtm(atmVal)
      const { ce, pe } = generateStrikes(strategy, atmVal, section.addon, interval)
      setCeStrikes(ce)
      setPeStrikes(pe)
      return { atm: atmVal, ce, pe }
    } catch (e) { console.error(e); return null }
    finally { setLoadingAtm(false) }
  }, [section.index, section.addon, strategy, interval, authHeader])

  // Fetch live spreads
  const fetchLive = useCallback(async (ceS, peS) => {
    const ce = ceS || ceStrikes
    const pe = peS || peStrikes
    if ((!ce.length && !pe.length) || !section.exp1 || !section.exp2) return
    setLoadingLive(true)
    try {
      const res = await axios.post(`${BASE_URL}/monitor/live`, {
        exchange, index: section.index,
        exp1: section.exp1, exp2: section.exp2,
        exp3: section.exp3 || '',
        addon: section.addon,
        ce_strikes: ce, pe_strikes: pe,
        strategy, ratio, multiplier, interval,
      }, { headers: { Authorization: authHeader } })

      const mergeData = (rows, type) => rows.map(row => ({
        ...row,
        prev_close: prevClose[`${row.strike}_${type}`] ?? null,
        change: row.current != null && prevClose[`${row.strike}_${type}`] != null
          ? round2(row.current - prevClose[`${row.strike}_${type}`]) : null,
        d3_high: d3Ranges[`${row.strike}_${type}`]?.high ?? null,
        d3_low:  d3Ranges[`${row.strike}_${type}`]?.low  ?? null,
        d5_high: d5Ranges[`${row.strike}_${type}`]?.high ?? null,
        d5_low:  d5Ranges[`${row.strike}_${type}`]?.low  ?? null,
      }))

      setCeData(mergeData(res.data.ce || [], 'CE'))
      setPeData(mergeData(res.data.pe || [], 'PE'))
      setLastUpdated(new Date().toLocaleTimeString())
      setRefreshCount(c => c + 1)
    } catch (e) { console.error(e) }
    finally { setLoadingLive(false) }
  }, [ceStrikes, peStrikes, section, exchange, authHeader, prevClose, d3Ranges, d5Ranges, strategy, ratio, multiplier, interval])

  // Fetch prev close
  const fetchPrevClose = useCallback(async (ceS, peS) => {
    const ce = ceS || ceStrikes
    const pe = peS || peStrikes
    if ((!ce.length && !pe.length) || !section.exp1 || !section.exp2) return
    try {
      const res = await axios.post(`${BASE_URL}/monitor/prev-close`, {
        exchange, index: section.index,
        exp1: section.exp1, exp2: section.exp2,
        exp3: section.exp3 || '',
        addon: section.addon,
        ce_strikes: ce, pe_strikes: pe,
        strategy, ratio, multiplier,
      }, { headers: { Authorization: authHeader } })
      setPrevClose(res.data.prev_close || {})
    } catch (e) { console.error(e) }
  }, [ceStrikes, peStrikes, section, exchange, authHeader, strategy, ratio, multiplier])

  // Fetch 3D/5D ranges
  const fetchRange = useCallback(async (ceS, peS) => {
    const ce = ceS || ceStrikes
    const pe = peS || peStrikes
    if ((!ce.length && !pe.length) || !section.exp1 || !section.exp2) return
    setLoadingRange(true)
    try {
      const [r3, r5] = await Promise.all([
        axios.post(`${BASE_URL}/monitor/range`, {
          exchange, index: section.index,
          exp1: section.exp1, exp2: section.exp2,
          exp3: section.exp3 || '',
          ce_strikes: ce, pe_strikes: pe,
          strategy, ratio, multiplier, days: 3,
        }, { headers: { Authorization: authHeader } }),
        axios.post(`${BASE_URL}/monitor/range`, {
          exchange, index: section.index,
          exp1: section.exp1, exp2: section.exp2,
          exp3: section.exp3 || '',
          ce_strikes: ce, pe_strikes: pe,
          strategy, ratio, multiplier, days: 5,
        }, { headers: { Authorization: authHeader } }),
      ])
      const d3 = r3.data.ranges || {}
      const d5 = r5.data.ranges || {}
      setD3Ranges(d3)
      setD5Ranges(d5)
      onUpdate({ ...section, d3_ranges: d3 })
    } catch (e) { console.error(e) }
    finally { setLoadingRange(false) }
  }, [ceStrikes, peStrikes, section, exchange, authHeader, strategy, ratio, multiplier, onUpdate])

  // Start monitoring
  const handleStart = useCallback(async () => {
    if (!section.exp1 || !section.exp2) { alert('Please select both expiries'); return }
    if (isButterfly && !section.exp3) { alert('Please select Exp3 for butterfly'); return }
    const result = await fetchAtmAndStrikes()
    if (!result) return
    const { ce, pe } = result
    await fetchPrevClose(ce, pe)
    await fetchLive(ce, pe)
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = setInterval(() => fetchLive(ce, pe), 30000)
  }, [section, isButterfly, fetchAtmAndStrikes, fetchPrevClose, fetchLive])

  useImperativeHandle(ref, () => ({
    handleStart,
    fetchRange: () => fetchRange(),
  }), [handleStart, fetchRange])

  useEffect(() => {
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [])

  const SpreadTable = ({ data, title, color }) => (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-2 h-2 rounded-full ${color}`} />
        <span className="text-xs font-mono font-semibold text-bright uppercase tracking-wider">{title}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-edge bg-panelLight/40">
              {['Strike','Prev Close','Current','Change','3D High','3D Low','5D High','5D Low','Status'].map(h => (
                <th key={h} className="text-[10px] font-mono text-ink uppercase tracking-wider py-2 px-3 text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-4 text-ink font-mono text-xs">Click Start Monitor</td></tr>
            ) : data.map((row, i) => {
              const badges = statusBadge(row.current, row.d3_high, row.d3_low, row.prev_close)
              const isAtmRow = row.strike === atm
              return (
                <tr key={i} className={`border-b border-edge/30 hover:bg-panelLight/30 transition-colors ${isAtmRow ? 'bg-cyan/5' : ''}`}>
                  <td className="py-2 px-3 font-mono font-bold text-bright">
                    {row.strike}
                    {isAtmRow && <span className="ml-1 text-[9px] text-cyan font-normal">ATM</span>}
                  </td>
                  <td className="py-2 px-3 font-mono text-ink">{fmtVal(row.prev_close)}</td>
                  <td className={`py-2 px-3 font-mono font-semibold ${valColor(row.current)}`}>{fmtVal(row.current)}</td>
                  <td className={`py-2 px-3 font-mono ${valColor(row.change)}`}>{fmtVal(row.change)}</td>
                  <td className="py-2 px-3 font-mono text-emerald/80">
                    {fmtVal(row.d3_high)}
                    {row.d3_days != null && row.d3_days < 3 && <sup className="text-amber-400 text-[8px] ml-0.5">{row.d3_days}d</sup>}
                  </td>
                  <td className="py-2 px-3 font-mono text-crimson/80">
                    {fmtVal(row.d3_low)}
                    {row.d3_days != null && row.d3_days < 3 && <sup className="text-amber-400 text-[8px] ml-0.5">{row.d3_days}d</sup>}
                  </td>
                  <td className="py-2 px-3 font-mono text-emerald/50">
                    {fmtVal(row.d5_high)}
                    {row.d5_days != null && row.d5_days < 5 && <sup className="text-amber-400 text-[8px] ml-0.5">{row.d5_days}d</sup>}
                  </td>
                  <td className="py-2 px-3 font-mono text-crimson/50">
                    {fmtVal(row.d5_low)}
                    {row.d5_days != null && row.d5_days < 5 && <sup className="text-amber-400 text-[8px] ml-0.5">{row.d5_days}d</sup>}
                  </td>
                  <td className="py-2 px-3">
                    <div className="flex flex-wrap gap-1">
                      {badges.map((b, bi) => (
                        <span key={bi} className={`px-2 py-0.5 rounded-full text-[9px] font-mono font-semibold border ${b.color}`}>
                          {b.label}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )

  return (
    <div className="bg-panel border border-edge rounded-2xl p-5 mb-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-cyan animate-pulse" />
          <span className="text-sm font-bold text-bright font-mono">
            {STRATEGIES.find(s => s.value === strategy)?.label} · {section.index}
          </span>
          {atm && <span className="text-[10px] font-mono text-cyan bg-cyan/10 px-2 py-0.5 rounded-full">ATM: {atm}</span>}
        </div>
        <button onClick={() => onRemove(section.id)}
          className="text-crimson/60 hover:text-crimson transition-colors text-xs font-mono">
          ✕ Remove
        </button>
      </div>

      {/* Controls Row 1: Strategy + Index + Expiries */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <div>
          <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Strategy</label>
          <select value={strategy}
            onChange={e => onUpdate({ ...section, strategy: e.target.value, exp3: '' })}
            className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan">
            {STRATEGIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Index</label>
          <select value={section.index}
            onChange={e => onUpdate({ ...section, index: e.target.value, exp1: '', exp2: '', exp3: '', exp1_label: '', exp2_label: '', exp3_label: '' })}
            className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan">
            {INDEXES.map(i => <option key={i}>{i}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Leg 1 Expiry</label>
          <select value={section.exp1}
            onChange={e => {
              const exp = expList.find(x => x.code === e.target.value)
              onUpdate({ ...section, exp1: e.target.value, exp1_label: exp?.label || e.target.value })
            }}
            className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan">
            <option value="">Select...</option>
            {expList.map(e => <option key={e.code} value={e.code}>{e.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Leg 2 Expiry</label>
          <select value={section.exp2}
            onChange={e => {
              const exp = expList.find(x => x.code === e.target.value)
              onUpdate({ ...section, exp2: e.target.value, exp2_label: exp?.label || e.target.value })
            }}
            className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan">
            <option value="">Select...</option>
            {expList.map(e => <option key={e.code} value={e.code}>{e.label}</option>)}
          </select>
        </div>
      </div>

      {/* Controls Row 2: Exp3 (butterfly) + Interval (p2) + Addon + Ratio + Multiplier + Actions */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        {isButterfly && (
          <div>
            <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Leg 3 Expiry</label>
            <select value={section.exp3 || ''}
              onChange={e => {
                const exp = expList.find(x => x.code === e.target.value)
                onUpdate({ ...section, exp3: e.target.value, exp3_label: exp?.label || e.target.value })
              }}
              className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan">
              <option value="">Select...</option>
              {expList.map(e => <option key={e.code} value={e.code}>{e.label}</option>)}
            </select>
          </div>
        )}
        {isIndexP2 && (
          <div>
            <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Interval</label>
            <input type="number" value={section.interval ?? 100}
              onChange={e => onUpdate({ ...section, interval: Number(e.target.value) })}
              step={50}
              className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan" />
          </div>
        )}
        <div>
          <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Add-on</label>
          <input type="number" value={section.addon}
            onChange={e => onUpdate({ ...section, addon: Number(e.target.value) })}
            step={50}
            className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan" />
        </div>
        <div>
          <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Ratio</label>
          <input type="number" value={section.ratio ?? 1}
            onChange={e => onUpdate({ ...section, ratio: Number(e.target.value) })}
            step={0.1} min={0.1}
            className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan" />
        </div>
        {isNfoBfo && (
          <div>
            <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Multiplier</label>
            <input type="number" value={section.multiplier ?? 3.3}
              onChange={e => onUpdate({ ...section, multiplier: Number(e.target.value) })}
              step={0.1}
              className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan" />
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Actions</label>
          <div className="flex gap-1">
            <button onClick={handleStart} disabled={loadingLive || loadingAtm}
              className="flex-1 py-2 rounded-lg bg-cyan text-void font-bold text-xs hover:bg-cyan/90 transition-all disabled:opacity-50">
              {loadingAtm || loadingLive ? '...' : '▶ Start'}
            </button>
            <button onClick={() => fetchRange()} disabled={loadingRange || (!ceStrikes.length && !peStrikes.length)}
              className="flex-1 py-2 rounded-lg bg-panelLight border border-cyan/30 text-cyan font-bold text-xs hover:bg-cyan/10 transition-all disabled:opacity-50">
              {loadingRange ? '...' : '📊 Range'}
            </button>
          </div>
        </div>
      </div>

      {/* Status bar */}
      {(ceStrikes.length > 0 || peStrikes.length > 0) && (
        <div className="flex items-center gap-3 mb-4 text-[10px] font-mono text-ink/60 flex-wrap">
          <span>CE: {ceStrikes.join(', ')}</span>
          <span>•</span>
          <span>PE: {peStrikes.join(', ')}</span>
          <span>•</span>
          <span className="flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${loadingLive ? 'bg-amber-400' : 'bg-emerald'} animate-pulse`} />
            {loadingLive ? 'Updating...' : 'Auto-refresh: 30s'}
          </span>
          {lastUpdated && (
            <>
              <span>•</span>
              <span className="text-emerald">Last updated: {lastUpdated}</span>
              <span>•</span>
              <span>Refreshes: {refreshCount}</span>
            </>
          )}
        </div>
      )}

      <SpreadTable data={ceData} title="Call Spreads (CE)" color="bg-blue" />
      <SpreadTable data={peData} title="Put Spreads (PE)"  color="bg-amber-400" />
    </div>
  )
})

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function LiveMonitorPage() {
  const { getAuthHeader } = useAuthStore()
  const authHeader = getAuthHeader()

  const [sections,    setSections]    = useState([])
  const [saving,      setSaving]      = useState(false)
  const [saveMsg,     setSaveMsg]     = useState('')
  const [startingAll, setStartingAll] = useState(false)
  const [rangingAll,  setRangingAll]  = useState(false)

  const sectionRefs = useRef({})

  useEffect(() => { loadConfig() }, [])

  const loadConfig = async () => {
    try {
      const res = await axios.get(`${BASE_URL}/monitor/config/load`, {
        headers: { Authorization: authHeader }
      })
      const saved = res.data.sections || []
      if (saved.length) setSections(saved)
    } catch (e) { console.error(e) }
  }

  const addSection = () => {
    const newSection = {
      id:          `section_${Date.now()}`,
      exchange:    'NSE',
      index:       'NIFTY',
      strategy:    'index_p1',
      exp1:        '', exp1_label: '',
      exp2:        '', exp2_label: '',
      exp3:        '', exp3_label: '',
      addon:       100,
      ratio:       1,
      multiplier:  3.3,
      interval:    100,
      d3_ranges:   {},
    }
    setSections(prev => [newSection, ...prev])
    // Scroll to top so user sees the new section immediately
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const updateSection = useCallback((updated) => {
    setSections(prev => prev.map(s => s.id === updated.id ? updated : s))
  }, [])

  const removeSection = useCallback((id) => {
    setSections(prev => prev.filter(s => s.id !== id))
    delete sectionRefs.current[id]
  }, [])

  const saveConfig = async () => {
    setSaving(true)
    try {
      await axios.post(`${BASE_URL}/monitor/config/save`, {
        sections, user_id: 'default'
      }, { headers: { Authorization: authHeader } })
      setSaveMsg('Saved! ✓')
      setTimeout(() => setSaveMsg(''), 3000)
    } catch (e) {
      setSaveMsg('Save failed!')
      setTimeout(() => setSaveMsg(''), 3000)
    } finally { setSaving(false) }
  }

  const handleStartAll = async () => {
    setStartingAll(true)
    for (const section of sections) {
      const ref = sectionRefs.current[section.id]
      if (ref?.handleStart) {
        try { await ref.handleStart() } catch (e) { console.error(e) }
      }
    }
    setStartingAll(false)
  }

  const handleRangeAll = async () => {
    setRangingAll(true)
    for (const section of sections) {
      const ref = sectionRefs.current[section.id]
      if (ref?.fetchRange) {
        try { await ref.fetchRange() } catch (e) { console.error(e) }
      }
    }
    setRangingAll(false)
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-bright tracking-tight">Live Spread Monitor</h1>
          <p className="text-sm text-ink mt-1">
            Multi-strategy spread monitor · Auto-refresh 30s · Telegram alerts running 24/7
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap justify-end">
          {saveMsg && (
            <span className={`text-xs font-mono ${saveMsg.includes('failed') ? 'text-crimson' : 'text-emerald'}`}>
              {saveMsg}
            </span>
          )}
          {sections.length > 0 && (
            <>
              <button onClick={handleStartAll} disabled={startingAll}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan text-void font-bold text-sm hover:bg-cyan/90 transition-all disabled:opacity-60">
                {startingAll ? '⏳ Starting...' : '▶▶ Start All'}
              </button>
              <button onClick={handleRangeAll} disabled={rangingAll}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-panelLight border border-cyan/40 text-cyan font-bold text-sm hover:bg-cyan/10 transition-all disabled:opacity-60">
                {rangingAll ? '⏳ Ranging...' : '📊 Range All'}
              </button>
            </>
          )}
          <button onClick={saveConfig} disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-panelLight border border-edge text-sm font-semibold text-ink hover:text-bright hover:border-cyan/50 transition-all disabled:opacity-50">
            {saving ? '...' : '💾 Save Config'}
          </button>
          <button onClick={addSection}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan text-void font-bold text-sm hover:bg-cyan/90 transition-all">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add Section
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-emerald/5 border border-emerald/20 mb-6">
        <div className="w-2 h-2 rounded-full bg-emerald animate-pulse flex-shrink-0" />
        <p className="text-xs font-mono text-emerald/80">
          Backend scheduler running · Telegram alerts active even when browser is closed ·
          Click <b>Start All</b> to begin monitoring · Click <b>Range All</b> to fetch 3D/5D High/Low for all sections
        </p>
      </div>

      {sections.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 bg-panel border border-edge rounded-2xl">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#8b92a8" strokeWidth="1.5" className="mb-4">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
          </svg>
          <p className="text-ink font-mono text-sm mb-4">No sections yet</p>
          <button onClick={addSection}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-cyan text-void font-bold text-sm hover:bg-cyan/90 transition-all">
            + Add First Section
          </button>
        </div>
      ) : (
        sections.map(section => (
          <MonitorSection
            key={section.id}
            ref={el => { sectionRefs.current[section.id] = el }}
            section={section}
            authHeader={authHeader}
            onUpdate={updateSection}
            onRemove={removeSection}
          />
        ))
      )}
    </div>
  )
}
