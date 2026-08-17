import { useState, useEffect, useRef } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../hooks/useAuthStore'
import { useNotificationStore } from '../../hooks/useNotificationStore'
import { fetchAllSpots } from '../../utils/api'

function NavItem({ to, icon, label }) {
  return (
    <NavLink to={to} className={({ isActive }) =>
      `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer
       ${isActive ? 'text-cyan bg-cyan/10 border border-cyan/20' : 'text-ink hover:text-bright hover:bg-panelLight/60'}`
    }>
      {icon}
      {label}
    </NavLink>
  )
}

function IndexCard({ label, value, change, positive }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-panelLight border border-edge">
      <div>
        <p className="text-[10px] font-mono text-ink/60 uppercase tracking-wider">{label}</p>
        <p className="text-sm font-bold font-mono text-bright">
          {value ? value.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '—'}
        </p>
      </div>
      {change != null && (
        <span className={`text-[11px] font-mono font-semibold ${positive ? 'text-emerald' : 'text-crimson'}`}>
          {positive ? '+' : ''}{change.toFixed(2)}%
        </span>
      )}
    </div>
  )
}

// ── Icons ──────────────────────────────────────────────────────────────────
const ChartIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/>
    <line x1="6" y1="20" x2="6" y2="14"/>
  </svg>
)
const BoltIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
  </svg>
)
const WingIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
  </svg>
)
const StraddleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
  </svg>
)
const SpreadIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
    <polyline points="17 6 23 6 23 12"/>
  </svg>
)

// ── Notification Panel ─────────────────────────────────────────────────────
function NotificationPanel({ onClose }) {
  const { notifications, markAllRead, clearAll } = useNotificationStore()

  useEffect(() => { markAllRead() }, [])

  return (
    <div className="absolute right-0 top-10 w-80 bg-panel border border-edge rounded-2xl shadow-2xl z-50 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-edge">
        <span className="text-sm font-semibold text-bright">Notifications</span>
        <button onClick={clearAll}
          className="text-[10px] font-mono text-ink hover:text-crimson transition-colors">
          Clear All
        </button>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="px-4 py-8 text-center text-ink font-mono text-sm">No notifications</div>
        ) : notifications.map(n => (
          <div key={n.id}
            className={`px-4 py-3 border-b border-edge/40 hover:bg-panelLight/40 transition-colors
              ${!n.read ? 'border-l-2 border-l-amber-400' : ''}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-bright">{n.title}</p>
                <p className="text-[11px] text-ink mt-0.5 leading-relaxed">{n.message}</p>
              </div>
              <span className="text-[10px] font-mono text-ink/50 flex-shrink-0">{n.timestamp}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function DashboardLayout() {
  const { logout, getAuthHeader }  = useAuthStore()
  const { unreadCount }            = useNotificationStore()
  const navigate                   = useNavigate()
  const authHeader                 = getAuthHeader()
  const [butterflyOpen, setButterflyOpen] = useState(false)
  const [showNotifs,    setShowNotifs]    = useState(false)
  const notifRef = useRef(null)

  // Live spot prices
  const [spots, setSpots] = useState({ NIFTY: null, BANKNIFTY: null, SENSEX: null })

  useEffect(() => {
    const loadSpots = async () => {
      try {
        const data = await fetchAllSpots(authHeader)
        setSpots(data)
      } catch (e) { console.error(e) }
    }
    loadSpots()
    const interval = setInterval(loadSpots, 30000) // refresh every 30s
    return () => clearInterval(interval)
  }, [authHeader])

  // Close notif panel on outside click
  useEffect(() => {
    const handler = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target)) {
        setShowNotifs(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleLogout = () => { logout(); navigate('/login', { replace: true }) }

  return (
    <div className="flex h-screen overflow-hidden bg-void">

      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <aside className="w-[220px] flex-shrink-0 flex flex-col bg-panel border-r border-edge">

        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-edge">
          <div className="w-8 h-8 rounded-lg bg-panelLight border border-edge flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M4 16L10 8L16 14L20 6" stroke="#00cbd6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M4 16L10 8L16 14L20 6" stroke="#1b75ff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" transform="translate(1,-1)" opacity=".4"/>
            </svg>
          </div>
          <span className="font-bold text-sm text-bright tracking-tight">Option Spread</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">

          <p className="text-[10px] font-mono text-ink/50 uppercase tracking-widest px-2 mb-2">Monitors</p>

          <NavItem to="/dashboard/spread-analysis" icon={<SpreadIcon />}  label="Spread Analysis" />
          <NavItem to="/dashboard/nfo-bfo"          icon={<BoltIcon />}   label="NFO-BFO Spreads" />
          <NavItem to="/dashboard/straddle"         icon={<StraddleIcon />} label="Straddle Monitor" />

          {/* Butterfly */}
          <div className="mt-1">
            <button onClick={() => setButterflyOpen(!butterflyOpen)}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium text-ink hover:text-bright hover:bg-panelLight/60 transition-all">
              <div className="flex items-center gap-3">
                <WingIcon />
                Butterfly Spread
              </div>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                className={`transition-transform ${butterflyOpen ? 'rotate-180' : ''}`}>
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>
            {butterflyOpen && (
              <div className="ml-4 mt-1 space-y-1 border-l border-edge pl-3">
                <NavItem to="/dashboard/butterfly-index"   icon={<ChartIcon />} label="Index" />
                <NavItem to="/dashboard/butterfly-nfo-bfo" icon={<BoltIcon />}  label="NFO-BFO" />
              </div>
            )}
          </div>

        </nav>

        {/* Live Index Prices */}
        <div className="px-3 py-3 border-t border-edge space-y-2">
          <p className="text-[10px] font-mono text-ink/40 uppercase tracking-widest px-1">Live Spot</p>
          <IndexCard label="NIFTY 50"   value={spots.NIFTY}     change={null} positive />
          <IndexCard label="SENSEX"      value={spots.SENSEX}    change={null} positive />
          <IndexCard label="BANKNIFTY"   value={spots.BANKNIFTY} change={null} positive />
        </div>

        {/* Actions */}
        <div className="px-3 py-3 border-t border-edge space-y-2">
          <button onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-crimson/10 border border-crimson/20 text-crimson text-xs font-semibold hover:bg-crimson/20 transition-all">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Logout
          </button>
        </div>

      </aside>

      {/* ── Main ─────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Navbar */}
        <header className="flex items-center justify-between px-6 py-3 bg-panel border-b border-edge flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="font-bold text-bright text-sm">Option Spread Analyzer</span>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald/10 border border-emerald/20">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping-slow absolute inline-flex h-full w-full rounded-full bg-emerald opacity-75"/>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald"/>
              </span>
              <span className="text-[10px] font-mono text-emerald font-semibold">Live API Connected</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Bell icon with notification count */}
            <div className="relative" ref={notifRef}>
              <button
                onClick={() => setShowNotifs(!showNotifs)}
                className="relative w-8 h-8 rounded-lg bg-panelLight border border-edge flex items-center justify-center text-ink hover:text-bright transition-colors"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                  <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                </svg>
                {unreadCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-crimson text-white text-[10px] font-bold flex items-center justify-center">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>
              {showNotifs && <NotificationPanel onClose={() => setShowNotifs(false)} />}
            </div>

            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan to-blue flex items-center justify-center text-void text-xs font-bold">U</div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto"><Outlet /></main>

        {/* Status bar */}
        <footer className="flex items-center justify-between px-6 py-2 bg-panel border-t border-edge text-[10px] font-mono text-ink/60 flex-shrink-0">
          <span>Market Status: <span className="text-emerald font-semibold">OPEN</span></span>
          <span>Latency: <span className="text-bright">2.4ms</span></span>
        </footer>

      </div>
    </div>
  )
}
