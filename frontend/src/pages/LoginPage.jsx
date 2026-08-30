import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '../hooks/useAuthStore'
import { getLoginUrl, generateToken } from '../utils/api'

export default function LoginPage() {
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const { login }               = useAuthStore()
  const navigate                = useNavigate()
  const [searchParams]          = useSearchParams()

  // Handle Fyers callback
  useEffect(() => {
    const code = searchParams.get('auth_code')
    if (code) {
      handleTokenExchange(code)
    }
  }, [])

  const handleLogin = async () => {
    try {
      setLoading(true)
      setError('')
      const url = await getLoginUrl()
      window.location.href = url
    } catch {
      setError('Failed to connect. Please try again.')
      setLoading(false)
    }
  }

  const handleTokenExchange = async (code) => {
    try {
      setLoading(true)
      const data = await generateToken(code)
      login(data.access_token, data.client_id)
      // After Fyers auth → go to password page
      navigate('/auth/password', { replace: true })
    } catch {
      setError('Authentication failed. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden bg-void">

      {/* Background */}
      <div className="absolute inset-0 z-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(27,117,255,0.1),transparent_50%)]" />
        <div className="absolute inset-0 bg-grid-pattern bg-grid opacity-100" />
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue/5 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-cyan/5 blur-[120px] rounded-full" />
      </div>

      {/* Main */}
      <div className="flex-1 flex items-center justify-center px-4 relative z-20">
        <main className="w-full max-w-[260px] animate-fade-in">

          {/* Brand */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-panelLight border border-edge shadow-xl mb-4 hover:scale-105 transition-transform">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M4 16L10 8L16 14L20 6" stroke="#00cbd6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M4 16L10 8L16 14L20 6" stroke="#1b75ff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" transform="translate(1,-1)" opacity=".4" />
              </svg>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-white mb-1">Option Spread Analyzer</h1>
            <p className="text-ink text-xs">Connect your account to start analyzing</p>
          </div>

          {/* Card */}
          <div className="glass border border-edge/50 rounded-2xl p-6 shadow-2xl space-y-4">

            {error && (
              <p className="text-crimson text-xs font-mono px-1 text-center">{error}</p>
            )}

            {/* Single Login button */}
            <button
              onClick={handleLogin}
              disabled={loading}
              className="w-full py-3 rounded-xl bg-blue text-white font-semibold hover:bg-blue/90 transition-all flex items-center justify-center gap-3 active:scale-[0.98] text-sm"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  Connecting...
                </span>
              ) : 'Login'}
            </button>

          </div>

          {/* Status */}
          <div className="mt-6 flex justify-center">
            <div className="px-3 py-1.5 rounded-full bg-emerald/5 border border-emerald/10 flex items-center gap-2">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping-slow absolute inline-flex h-full w-full rounded-full bg-emerald opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald" />
              </span>
              <span className="text-[10px] font-mono text-emerald/80 tracking-wider uppercase">System Operational</span>
            </div>
          </div>

        </main>
      </div>

      {/* Footer */}
      <footer className="relative z-20 px-8 py-6 flex flex-col md:flex-row items-center justify-between gap-4 text-[11px] font-mono text-ink/50 border-t border-edge/20">
        <span>© 2025 OPTION SPREAD ANALYZER • V2.4.0</span>
        <div className="flex items-center gap-6">
          <a href="#" className="hover:text-bright transition-colors">DOCUMENTATION</a>
          <a href="#" className="hover:text-bright transition-colors">SECURITY</a>
          <a href="#" className="hover:text-bright transition-colors">SUPPORT</a>
        </div>
      </footer>

    </div>
  )
}
