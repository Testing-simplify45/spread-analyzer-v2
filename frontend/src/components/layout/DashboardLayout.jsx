import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../hooks/useAuthStore'

export default function DashboardLayout() {
  const { logout } = useAuthStore()
  const navigate   = useNavigate()
  const [nifty]    = useState({ value: '23,300.00', change: '+0.84%', positive: true })
  const [sensex]   = useState({ value: '77,000.20', change: '+0.61%', positive: true })

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex h-screen overflow-hidden bg-void">

      {/* ── Sidebar ────────────────────────────────────────────────────── */}
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

          <NavLink
            to="/dashboard/nfo-bfo"
            className={({ isActive }) =>
              `sidebar-item ${isActive ? 'active' : ''}`
            }
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
            NFO-BFO Spreads
          </NavLink>

          <p className="text-[10px] font-mono text-ink/50 uppercase tracking-widest px-2 mt-4 mb-2">History</p>

          <button className="sidebar-item w-full text-left">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
            Historical Logs
          </button>

        </nav>

        {/* Index prices */}
        <div className="px-3 py-3 border-t border-edge space-y-2">
          <IndexCard label="NIFTY 50"  value={nifty.value}  change={nifty.change}  positive={nifty.positive} />
          <IndexCard label="SENSEX"    value={sensex.value} change={sensex.change} positive={sensex.positive} />
        </div>

        {/* Refresh + Logout */}
        <div className="px-3 py-3 border-t border-edge space-y-2">
          <button className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-cyan/10 border border-cyan/20 text-cyan text-xs font-semibold hover:bg-cyan/20 transition-all">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="1 4 1 10 7 10"/>
              <path d="M3.51 15a9 9 0 1 0 .49-3.99"/>
            </svg>
            Refresh All Data
          </button>
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-crimson/10 border border-crimson/20 text-crimson text-xs font-semibold hover:bg-crimson/20 transition-all"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Logout
          </button>
        </div>

      </aside>

      {/* ── Main area ──────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Top navbar */}
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
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14"/>
              </svg>
            </button>
            <button className="w-8 h-8 rounded-lg bg-panelLight border border-edge flex items-center justify-center text-ink hover:text-bright transition-colors">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
            </button>
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan to-blue flex items-center justify-center text-void text-xs font-bold">
              U
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>

        {/* Status bar */}
        <footer className="flex items-center justify-between px-6 py-2 bg-panel border-t border-edge text-[10px] font-mono text-ink/60 flex-shrink-0">
          <span>Market Status: <span className="text-emerald font-semibold">OPEN</span></span>
          <span>Latency: <span className="text-bright">2.4ms</span></span>
        </footer>

      </div>
    </div>
  )
}

function IndexCard({ label, value, change, positive }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-panelLight border border-edge">
      <div>
        <p className="text-[10px] font-mono text-ink/60 uppercase tracking-wider">{label}</p>
        <p className="text-sm font-bold font-mono text-bright">{value}</p>
      </div>
      <span className={`text-[11px] font-mono font-semibold ${positive ? 'text-emerald' : 'text-crimson'}`}>
        {change}
      </span>
    </div>
  )
}
