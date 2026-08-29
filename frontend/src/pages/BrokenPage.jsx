export default function BrokenPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-void relative overflow-hidden">
      <div className="absolute inset-0 bg-grid-pattern bg-grid opacity-50" />

      <div className="relative z-10 text-center max-w-lg px-6">

        {/* Error icon */}
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-crimson/10 border border-crimson/20 mb-8">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ff5252" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>

        {/* Error code */}
        <p className="text-[11px] font-mono text-crimson/60 uppercase tracking-[0.3em] mb-3">
          Error 503 · Service Unavailable
        </p>

        <h1 className="text-3xl font-bold text-bright mb-4 tracking-tight">
          Service Temporarily Unavailable
        </h1>

        <p className="text-ink text-sm leading-relaxed mb-8">
          The server is currently unable to handle your request due to temporary maintenance or capacity issues. Please try again later.
        </p>

        {/* Fake technical details */}
        <div className="bg-panel border border-edge rounded-xl p-4 text-left mb-8">
          <p className="text-[10px] font-mono text-ink/50 uppercase tracking-wider mb-3">Technical Details</p>
          <div className="space-y-1.5 font-mono text-xs">
            <div className="flex justify-between">
              <span className="text-ink/60">Request ID:</span>
              <span className="text-ink">7f3a2b1c-9e4d-4f8a</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink/60">Timestamp:</span>
              <span className="text-ink">{new Date().toISOString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink/60">Region:</span>
              <span className="text-ink">ap-south-1</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink/60">Status:</span>
              <span className="text-crimson">DEGRADED</span>
            </div>
          </div>
        </div>

        <button
          onClick={() => window.location.reload()}
          className="flex items-center gap-2 px-6 py-3 rounded-xl bg-panel border border-edge text-sm font-semibold text-ink hover:text-bright hover:border-cyan/50 transition-all mx-auto"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="1 4 1 10 7 10"/>
            <path d="M3.51 15a9 9 0 1 0 .49-3.99"/>
          </svg>
          Retry Connection
        </button>

        <p className="mt-8 text-[10px] font-mono text-ink/30">
          © 2025 OPTION SPREAD ANALYZER • V2.4.0
        </p>
      </div>
    </div>
  )
}
