import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../hooks/useAuthStore'

function NavItem({ to, icon, label, active }) {
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
        <p className="text-sm font-bold font-mono text-bright">{value}</p>
      </div>
      <span className={`text-[11px] font-mono font-semibold ${positive ? 'text-emerald' : 'text-crimson'}`}>{change}</span>
    </div>
  )
}

const ChartIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
  </svg>
)
const BoltIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
  </svg>
)
const WingIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>
    <path d="M8 12h8M12 8v8"/>
  </svg>
)

export default function DashboardLayout() {
  const { logout } = useAuthStore()
  const navigate   = useNavigate()
  const [butterflyOpen, setButterflyOpen] = useState(false)

  const handleLogout = () => { logout(); navigate('/login', { replace: true }) }

  return (
    <div className="flex h-screen overflow-hidden bg-void">

      {/* Sidebar */}
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

          {/* Monitors */}
          <p className="text-[10px] font-mono text-ink/50 uppercase tracking-widest px-2 mb-2">Monitors</p>

          <NavItem to="/dashboard/spread-analysis" icon={<ChartIcon />} label="Spread Analysis" />
          <NavItem to="/dashboard/nfo-bfo" icon={<BoltIcon />} label="NFO-BFO Spreads" />

          {/* Butterfly */}
          <div className="mt-2">
            <button
              onClick={() => setButterflyOpen(!butterflyOpen)}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium text-ink hover:text-bright hover:bg-panelLight/60 transition-all"
            >
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
                <NavItem to="/dashboard/butterfly-index" icon={
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                  </svg>
                } label="Index" />
                <NavItem to="/dashboard/butterfly-nfo-bfo" icon={
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                  </svg>
                } label="NFO-BFO" />
              </div>
            )}
          </div>

        </nav>

        {/* Index prices */}
        <div className="px-3 py-3 border-t border-edge space-y-2">
          <IndexCard label="NIFTY 50" value="23,300.00" change="+0.84%" positive />
          <IndexCard label="SENSEX"   value="77,000.20" change="+0.61%" positive />
        </div>

        {/* Actions */}
        <div className="px-3 py-3 border-t border-edge space-y-2">
          <button className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-cyan/10 border border-cyan/20 text-cyan text-xs font-semibold hover:bg-cyan/20 transition-all">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.99"/>
            </svg>
            Refresh All Data
          </button>
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

      {/* Main */}
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
            <button className="w-8 h-8 rounded-lg bg-panelLight border border-edge flex items-center justify-center text-ink hover:text-bright transition-colors">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
            </button>
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan to-blue flex items-center justify-center text-void text-xs font-bold">U</div>
          </div>
        </header>

        {/* Content */}
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
