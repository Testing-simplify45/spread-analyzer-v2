import { useState, useEffect, useCallback, useRef, useImperativeHandle, forwardRef } from 'react'
import { useAuthStore } from '../hooks/useAuthStore'
import { getExpiries } from '../utils/api'
import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL || '/api'

const INDEXES = ['NIFTY', 'BANKNIFTY', 'SENSEX', 'BANKEX', 'FINNIFTY', 'MIDCPNIFTY']
const EXCHANGE_MAP = { NIFTY: 'NSE', BANKNIFTY: 'NSE', FINNIFTY: 'NSE', MIDCPNIFTY: 'NSE', SENSEX: 'BSE', BANKEX: 'BSE' }

const STRATEGIES = [
  { value: 'index_p1',        label: 'Index Pair Part 1 (Calendar)' },
  { value: 'index_p2',        label: 'Index Pair Part 2 (Interval)' },
  { value: 'nfo_bfo',         label: 'NFO/BFO Spread' },
  { value: 'butterfly_index', label: 'Butterfly Index' },
  { value: 'butterfly_nfo',   label: 'Butterfly NFO/BFO' },
]

// strategies where multiple indexes apply
const MULTI_INDEX_STRATEGIES = ['nfo_bfo', 'butterfly_nfo']
// strategies where prev close threshold is configurable
const CONFIGURABLE_PC_STRATEGIES = ['nfo_bfo', 'butterfly_index', 'butterfly_nfo']

function round2(v) { return Math.round(v * 100) / 100 }

// ── Formula ───────────────────────────────────────────────────────────────────
// NFO/BFO:        L1 - (L2 × ratio)          — L2 strike = round(L1/multiplier, 50)
// Butterfly NFO:  [L1 - (L2×ratio)] + [L3 - (L2×ratio)]  = L1 + L3 - 2×(L2×ratio)
function computeSpread(strategy, ltp1, ltp2, ltp3, ratio) {
  const r = ratio || 1
  if (ltp1 == null) return null
  switch (strategy) {
    case 'index_p1':
    case 'index_p2':
      if (ltp2 == null) return null
      return round2(ltp1 - (ltp2 * r))
    case 'nfo_bfo':
      if (ltp2 == null) return null
      return round2(ltp1 - (ltp2 * r))
    case 'butterfly_index':
      if (ltp2 == null || ltp3 == null) return null
      return round2(ltp1 - (ltp2 * r) - (ltp2 * r) + ltp3)
    case 'butterfly_nfo':
      if (ltp2 == null || ltp3 == null) return null
      return round2((ltp1 - (ltp2 * r)) + (ltp3 - (ltp2 * r)))
    default:
      return null
  }
}

// Derive L2 strike from L1 strike using multiplier, rounded to nearest 50
function deriveL2Strike(l1Strike, multiplier) {
  const raw = l1Strike / multiplier
  return Math.round(raw / 50) * 50
}

function fmtVal(v) {
  if (v == null) return '—'
  return (v > 0 ? '+' : '') + v.toFixed(2)
}
function valColor(v) {
  if (v == null) return 'text-ink'
  return v > 0 ? 'text-emerald' : v < 0 ? 'text-crimson' : 'text-ink'
}
function statusBadge(current, d3High, d3Low, prevClose, pcThreshold) {
  const badges = []
  const threshold = pcThreshold || 10
  if (current != null && d3High != null && d3Low != null) {
    if (current >= d3High - 1) badges.push({ label: 'Near 3D High', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' })
    if (current >= d3High + 5) badges.push({ label: 'Above 3D High', color: 'bg-crimson/20 text-crimson border-crimson/30' })
    if (current <= d3Low + 1)  badges.push({ label: 'Near 3D Low',   color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' })
    if (current <= d3Low - 5)  badges.push({ label: 'Below 3D Low',  color: 'bg-crimson/20 text-crimson border-crimson/30' })
  }
  if (current != null && prevClose != null) {
    const diff = current - prevClose
    if (diff >= threshold)  badges.push({ label: `PC +${diff.toFixed(1)}`, color: 'bg-blue/20 text-blue border-blue/30' })
    if (diff <= -threshold) badges.push({ label: `PC ${diff.toFixed(1)}`,  color: 'bg-purple-400/20 text-purple-400 border-purple-400/30' })
  }
  return badges
}

// ── Strike generator ──────────────────────────────────────────────────────────
function generateStrikes(strategy, atm, addon) {
  if (strategy === 'index_p1' || strategy === 'index_p2') {
    return {
      ce: [atm, atm + addon, atm + 2*addon, atm + 3*addon],
      pe: [atm, atm - addon, atm - 2*addon, atm - 3*addon],
    }
  }
  return {
    ce: [atm, atm + addon, atm + 2*addon, atm + 3*addon, atm + 4*addon, atm + 5*addon],
    pe: [atm, atm - addon, atm - 2*addon, atm - 3*addon, atm - 4*addon, atm - 5*addon],
  }
}

// ── Expiry selector sub-component ─────────────────────────────────────────────
function ExpirySelect({ label, value, onChange, expList }) {
  return (
    <div>
      <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan">
        <option value="">Select...</option>
        {expList.map(e => <option key={e.code} value={e.code}>{e.label}</option>)}
      </select>
    </div>
  )
}

// ── Section component ─────────────────────────────────────────────────────────
const MonitorSection = forwardRef(function MonitorSection({ section, authHeader, onUpdate, onRemove }, ref) {
  // expiry lists per index
  const [expList1,     setExpList1]     = useState([])  // L1 index expiries
  const [expList2,     setExpList2]     = useState([])  // L2 index expiries (multi-index only)
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

  const strategy    = section.strategy    || 'index_p1'
  const ratio       = section.ratio       ?? 1
  const multiplier  = section.multiplier  ?? 3.3
  const interval    = section.interval    ?? 100
  const pcMode      = section.pc_mode     || 'default'   // 'default' | 'custom'
  const pcThreshold = section.pc_threshold ?? 10

  const isButterfly    = strategy === 'butterfly_index' || strategy === 'butterfly_nfo'
  const isIndexP2      = strategy === 'index_p2'
  const isNfoBfo       = strategy === 'nfo_bfo'
  const isMultiIndex   = MULTI_INDEX_STRATEGIES.includes(strategy)
  const isConfigurablePC = CONFIGURABLE_PC_STRATEGIES.includes(strategy)

  // index1 = main index (L1/L3), index2 = secondary (L2) for multi-index
  const index1 = section.index  || 'NIFTY'
  const index2 = section.index2 || 'NIFTY'
  const exchange1 = EXCHANGE_MAP[index1] || 'NSE'
  const exchange2 = EXCHANGE_MAP[index2] || 'NSE'

  useEffect(() => { loadExpiries1() }, [index1])
  useEffect(() => { if (isMultiIndex) loadExpiries2() }, [index2, isMultiIndex])

  const loadExpiries1 = async () => {
    try { setExpList1(await getExpiries(index1, authHeader) || []) } catch (e) { console.error(e) }
  }
  const loadExpiries2 = async () => {
    try { setExpList2(await getExpiries(index2, authHeader) || []) } catch (e) { console.error(e) }
  }

  // Fetch ATM for L1 index and compute strikes
  const fetchAtmAndStrikes = useCallback(async () => {
    setLoadingAtm(true)
    try {
      const res = await axios.get(`${BASE_URL}/monitor/atm/${index1}`, {
        params: { addon: section.addon },
        headers: { Authorization: authHeader }
      })
      const atmVal = res.data.atm
      setAtm(atmVal)
      const { ce, pe } = generateStrikes(strategy, atmVal, section.addon)
      setCeStrikes(ce)
      setPeStrikes(pe)
      return { atm: atmVal, ce, pe }
    } catch (e) { console.error(e); return null }
    finally { setLoadingAtm(false) }
  }, [index1, section.addon, strategy, authHeader])

  // Build the payload for live/prevclose/range requests
  const buildPayload = (ceS, peS, extra = {}) => ({
    exchange1, index1,
    exchange2: isMultiIndex ? exchange2 : exchange1,
    index2:    isMultiIndex ? index2    : index1,
    exp1: section.exp1 || '', exp2: section.exp2 || '',
    exp3: section.exp3 || '',
    // L2 expiries for multi-index NFO/BFO
    exp_l2a: section.exp_l2a || '', exp_l2b: section.exp_l2b || '',
    addon: section.addon,
    ce_strikes: ceS, pe_strikes: peS,
    strategy, ratio, multiplier, interval,
    ...extra,
  })

  const fetchLive = useCallback(async (ceS, peS) => {
    const ce = ceS || ceStrikes
    const pe = peS || peStrikes
    if ((!ce.length && !pe.length)) return
    if (!section.exp1 || !section.exp2) return
    setLoadingLive(true)
    try {
      const res = await axios.post(`${BASE_URL}/monitor/live`, buildPayload(ce, pe),
        { headers: { Authorization: authHeader } })

      const mergeData = (rows, type) => rows.map(row => ({
        ...row,
        prev_close: prevClose[`${row.strike}_${type}`] ?? null,
        change: row.current != null && prevClose[`${row.strike}_${type}`] != null
          ? round2(row.current - prevClose[`${row.strike}_${type}`]) : null,
        d3_high:  d3Ranges[`${row.strike}_${type}`]?.high     ?? null,
        d3_low:   d3Ranges[`${row.strike}_${type}`]?.low      ?? null,
        d3_days:  d3Ranges[`${row.strike}_${type}`]?.days_used ?? null,
        d5_high:  d5Ranges[`${row.strike}_${type}`]?.high     ?? null,
        d5_low:   d5Ranges[`${row.strike}_${type}`]?.low      ?? null,
        d5_days:  d5Ranges[`${row.strike}_${type}`]?.days_used ?? null,
      }))

      setCeData(mergeData(res.data.ce || [], 'CE'))
      setPeData(mergeData(res.data.pe || [], 'PE'))
      setLastUpdated(new Date().toLocaleTimeString())
      setRefreshCount(c => c + 1)
    } catch (e) { console.error(e) }
    finally { setLoadingLive(false) }
  }, [ceStrikes, peStrikes, section, authHeader, prevClose, d3Ranges, d5Ranges, strategy, ratio, multiplier])

  const fetchPrevClose = useCallback(async (ceS, peS) => {
    const ce = ceS || ceStrikes
    const pe = peS || peStrikes
    if ((!ce.length && !pe.length) || !section.exp1 || !section.exp2) return
    try {
      const res = await axios.post(`${BASE_URL}/monitor/prev-close`, buildPayload(ce, pe),
        { headers: { Authorization: authHeader } })
      setPrevClose(res.data.prev_close || {})
    } catch (e) { console.error(e) }
  }, [ceStrikes, peStrikes, section, authHeader, strategy, ratio, multiplier])

  const fetchRange = useCallback(async (ceS, peS) => {
    const ce = ceS || ceStrikes
    const pe = peS || peStrikes
    if ((!ce.length && !pe.length) || !section.exp1 || !section.exp2) return
    setLoadingRange(true)
    try {
      const [r3, r5] = await Promise.all([
        axios.post(`${BASE_URL}/monitor/range`, buildPayload(ce, pe, { days: 3 }), { headers: { Authorization: authHeader } }),
        axios.post(`${BASE_URL}/monitor/range`, buildPayload(ce, pe, { days: 5 }), { headers: { Authorization: authHeader } }),
      ])
      const d3 = r3.data.ranges || {}
      const d5 = r5.data.ranges || {}
      setD3Ranges(d3)
      setD5Ranges(d5)
      onUpdate({ ...section, d3_ranges: d3 })
    } catch (e) { console.error(e) }
    finally { setLoadingRange(false) }
  }, [ceStrikes, peStrikes, section, authHeader, strategy, ratio, multiplier, onUpdate])

  const handleStart = useCallback(async () => {
    if (!section.exp1 || !section.exp2) { alert('Please select Exp1 and Exp2'); return }
    if (isButterfly && !section.exp3)   { alert('Please select Exp3 for butterfly'); return }
    if (isMultiIndex && !section.exp_l2a) { alert('Please select L2 expiry'); return }
    const result = await fetchAtmAndStrikes()
    if (!result) return
    const { ce, pe } = result
    await fetchPrevClose(ce, pe)
    await fetchLive(ce, pe)
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = setInterval(() => fetchLive(ce, pe), 30000)
  }, [section, isButterfly, isMultiIndex, fetchAtmAndStrikes, fetchPrevClose, fetchLive])

  useImperativeHandle(ref, () => ({ handleStart, fetchRange: () => fetchRange() }), [handleStart, fetchRange])
  useEffect(() => { return () => { if (intervalRef.current) clearInterval(intervalRef.current) } }, [])

  // ── Table ─────────────────────────────────────────────────────────────────
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
              {[
                isMultiIndex ? 'L1 Strike' : 'Strike',
                isMultiIndex ? 'L2 Strike' : null,
                'Prev Close','Current','Change','3D High','3D Low','5D High','5D Low','Status'
              ].filter(Boolean).map(h => (
                <th key={h} className="text-[10px] font-mono text-ink uppercase tracking-wider py-2 px-3 text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr><td colSpan={isMultiIndex ? 10 : 9} className="text-center py-4 text-ink font-mono text-xs">Click Start Monitor</td></tr>
            ) : data.map((row, i) => {
              const l2Strike = isMultiIndex ? deriveL2Strike(row.strike, multiplier) : null
              const badges = statusBadge(row.current, row.d3_high, row.d3_low, row.prev_close,
                isConfigurablePC ? (pcMode === 'custom' ? pcThreshold : 10) : 10)
              const isAtmRow = row.strike === atm
              return (
                <tr key={i} className={`border-b border-edge/30 hover:bg-panelLight/30 transition-colors ${isAtmRow ? 'bg-cyan/5' : ''}`}>
                  <td className="py-2 px-3 font-mono font-bold text-bright">
                    {row.strike}
                    {isAtmRow && <span className="ml-1 text-[9px] text-cyan font-normal">ATM</span>}
                  </td>
                  {isMultiIndex && (
                    <td className="py-2 px-3 font-mono text-ink/70">{l2Strike}</td>
                  )}
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

  // ── Controls ──────────────────────────────────────────────────────────────
  return (
    <div className="bg-panel border border-edge rounded-2xl p-5 mb-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-cyan animate-pulse" />
          <span className="text-sm font-bold text-bright font-mono">
            {STRATEGIES.find(s => s.value === strategy)?.label} · {index1}
            {isMultiIndex && ` / ${index2}`}
          </span>
          {atm && <span className="text-[10px] font-mono text-cyan bg-cyan/10 px-2 py-0.5 rounded-full">ATM: {atm}</span>}
        </div>
        <button onClick={() => onRemove(section.id)}
          className="text-crimson/60 hover:text-crimson transition-colors text-xs font-mono">
          ✕ Remove
        </button>
      </div>

      {/* Row 1: Strategy + Index1 + (Index2 if multi) + Exp1 + Exp2 */}
      <div className={`grid gap-3 mb-3 ${isMultiIndex ? 'grid-cols-2 md:grid-cols-5' : 'grid-cols-2 md:grid-cols-4'}`}>
        <div>
          <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Strategy</label>
          <select value={strategy}
            onChange={e => onUpdate({ ...section, strategy: e.target.value, exp3: '', exp_l2a: '', exp_l2b: '' })}
            className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan">
            {STRATEGIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>

        {/* L1 Index */}
        <div>
          <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">
            {isMultiIndex ? 'L1 Index (L1/L3)' : 'Index'}
          </label>
          <select value={index1}
            onChange={e => onUpdate({ ...section, index: e.target.value, exp1: '', exp2: '', exp3: '', exp1_label: '', exp2_label: '', exp3_label: '' })}
            className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan">
            {INDEXES.map(i => <option key={i}>{i}</option>)}
          </select>
        </div>

        {/* L2 Index — only for multi-index strategies */}
        {isMultiIndex && (
          <div>
            <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">L2 Index</label>
            <select value={index2}
              onChange={e => onUpdate({ ...section, index2: e.target.value, exp_l2a: '', exp_l2b: '' })}
              className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan">
              {INDEXES.map(i => <option key={i}>{i}</option>)}
            </select>
          </div>
        )}

        {/* L1 Expiry */}
        <ExpirySelect
          label={isMultiIndex ? 'L1 Expiry' : 'Leg 1 Expiry'}
          value={section.exp1 || ''}
          expList={expList1}
          onChange={v => { const e = expList1.find(x => x.code === v); onUpdate({ ...section, exp1: v, exp1_label: e?.label || v }) }}
        />

        {/* L3 Expiry for butterfly (same index as L1) */}
        {isButterfly ? (
          <ExpirySelect
            label="L3 Expiry (same as L1)"
            value={section.exp3 || ''}
            expList={expList1}
            onChange={v => { const e = expList1.find(x => x.code === v); onUpdate({ ...section, exp3: v, exp3_label: e?.label || v }) }}
          />
        ) : (
          /* L2 Expiry for non-butterfly (same index as L1 for single-index) */
          !isMultiIndex && (
            <ExpirySelect
              label="Leg 2 Expiry"
              value={section.exp2 || ''}
              expList={expList1}
              onChange={v => { const e = expList1.find(x => x.code === v); onUpdate({ ...section, exp2: v, exp2_label: e?.label || v }) }}
            />
          )
        )}
      </div>

      {/* Row 2: L2 expiries for multi-index, or Exp2 for butterfly */}
      {(isMultiIndex || (isButterfly && !isMultiIndex)) && (
        <div className={`grid gap-3 mb-3 ${isMultiIndex && isButterfly ? 'grid-cols-2 md:grid-cols-3' : 'grid-cols-2'}`}>
          {isMultiIndex && (
            <>
              <ExpirySelect
                label={isButterfly ? 'L2A Expiry (near)' : 'L2 Expiry'}
                value={section.exp_l2a || ''}
                expList={expList2}
                onChange={v => { const e = expList2.find(x => x.code === v); onUpdate({ ...section, exp_l2a: v, exp2: v, exp2_label: e?.label || v }) }}
              />
              {isButterfly && (
                <ExpirySelect
                  label="L2B Expiry (far)"
                  value={section.exp_l2b || ''}
                  expList={expList2}
                  onChange={v => { const e = expList2.find(x => x.code === v); onUpdate({ ...section, exp_l2b: v }) }}
                />
              )}
            </>
          )}
          {!isMultiIndex && isButterfly && (
            <ExpirySelect
              label="L2 Expiry (middle)"
              value={section.exp2 || ''}
              expList={expList1}
              onChange={v => { const e = expList1.find(x => x.code === v); onUpdate({ ...section, exp2: v, exp2_label: e?.label || v }) }}
            />
          )}
        </div>
      )}

      {/* Row 3: Addon + Ratio + Multiplier + PC Threshold + Interval + Actions */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-4">
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
        {(isNfoBfo || strategy === 'butterfly_nfo') && (
          <div>
            <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Multiplier</label>
            <input type="number" value={section.multiplier ?? 3.3}
              onChange={e => onUpdate({ ...section, multiplier: Number(e.target.value) })}
              step={0.1}
              className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan" />
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
        {/* PC Threshold — configurable for non-index strategies */}
        {isConfigurablePC && (
          <div>
            <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">PC Alert ±</label>
            <div className="flex gap-1">
              <select value={pcMode}
                onChange={e => onUpdate({ ...section, pc_mode: e.target.value, pc_threshold: e.target.value === 'default' ? 10 : section.pc_threshold ?? 10 })}
                className="bg-panelLight border border-edge rounded-lg px-2 py-2 text-sm text-bright font-mono outline-none focus:border-cyan">
                <option value="default">±10</option>
                <option value="custom">Custom</option>
              </select>
              {pcMode === 'custom' && (
                <input type="number" value={pcThreshold}
                  onChange={e => onUpdate({ ...section, pc_threshold: Number(e.target.value) })}
                  min={1} step={1} placeholder="Value"
                  className="w-20 bg-panelLight border border-cyan/50 rounded-lg px-2 py-2 text-sm text-bright font-mono outline-none focus:border-cyan" />
              )}
            </div>
          </div>
        )}
        {/* Actions */}
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
          {lastUpdated && (<><span>•</span><span className="text-emerald">Last updated: {lastUpdated}</span><span>•</span><span>Refreshes: {refreshCount}</span></>)}
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
      const res = await axios.get(`${BASE_URL}/monitor/config/load`, { headers: { Authorization: authHeader } })
      const saved = res.data.sections || []
      if (saved.length) setSections(saved)
    } catch (e) { console.error(e) }
  }

  const addSection = () => {
    const newSection = {
      id: `section_${Date.now()}`,
      exchange: 'NSE', index: 'NIFTY', index2: 'NIFTY',
      strategy: 'index_p1',
      exp1: '', exp1_label: '', exp2: '', exp2_label: '',
      exp3: '', exp3_label: '', exp_l2a: '', exp_l2b: '',
      addon: 100, ratio: 1, multiplier: 3.3, interval: 100,
      pc_mode: 'default', pc_threshold: 10,
      d3_ranges: {},
    }
    setSections(prev => [newSection, ...prev])
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const updateSection  = useCallback((updated) => { setSections(prev => prev.map(s => s.id === updated.id ? updated : s)) }, [])
  const removeSection  = useCallback((id) => { setSections(prev => prev.filter(s => s.id !== id)); delete sectionRefs.current[id] }, [])

  const saveConfig = async () => {
    setSaving(true)
    try {
      await axios.post(`${BASE_URL}/monitor/config/save`, { sections, user_id: 'default' }, { headers: { Authorization: authHeader } })
      setSaveMsg('Saved! ✓'); setTimeout(() => setSaveMsg(''), 3000)
    } catch (e) { setSaveMsg('Save failed!'); setTimeout(() => setSaveMsg(''), 3000) }
    finally { setSaving(false) }
  }

  const handleStartAll = async () => {
    setStartingAll(true)
    for (const s of sections) { try { await sectionRefs.current[s.id]?.handleStart() } catch (e) { console.error(e) } }
    setStartingAll(false)
  }
  const handleRangeAll = async () => {
    setRangingAll(true)
    for (const s of sections) { try { await sectionRefs.current[s.id]?.fetchRange() } catch (e) { console.error(e) } }
    setRangingAll(false)
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-bright tracking-tight">Live Spread Monitor</h1>
          <p className="text-sm text-ink mt-1">Multi-strategy spread monitor · Auto-refresh 30s · Telegram alerts 24/7</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap justify-end">
          {saveMsg && <span className={`text-xs font-mono ${saveMsg.includes('failed') ? 'text-crimson' : 'text-emerald'}`}>{saveMsg}</span>}
          {sections.length > 0 && (<>
            <button onClick={handleStartAll} disabled={startingAll}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan text-void font-bold text-sm hover:bg-cyan/90 transition-all disabled:opacity-60">
              {startingAll ? '⏳ Starting...' : '▶▶ Start All'}
            </button>
            <button onClick={handleRangeAll} disabled={rangingAll}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-panelLight border border-cyan/40 text-cyan font-bold text-sm hover:bg-cyan/10 transition-all disabled:opacity-60">
              {rangingAll ? '⏳ Ranging...' : '📊 Range All'}
            </button>
          </>)}
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
      ) : sections.map(section => (
        <MonitorSection
          key={section.id}
          ref={el => { sectionRefs.current[section.id] = el }}
          section={section}
          authHeader={authHeader}
          onUpdate={updateSection}
          onRemove={removeSection}
        />
      ))}
    </div>
  )
}
