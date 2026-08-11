import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '../hooks/useAuthStore'
import { getLoginUrl, generateToken } from '../utils/api'

export default function LoginPage() {
  const [authCode, setAuthCode]   = useState('')
  const [showCode, setShowCode]   = useState(false)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')
  const { login }                 = useAuthStore()
  const navigate                  = useNavigate()
  const [searchParams]            = useSearchParams()

  // Handle callback from Fyers redirect
  useEffect(() => {
    const code = searchParams.get('auth_code')
    if (code) {
      setAuthCode(code)
      handleLogin(code)
    }
  }, [])

  const handleFyersLogin = async () => {
    try {
      setLoading(true)
      setError('')
      const url = await getLoginUrl()
      window.location.href = url
    } catch {
      setError('Failed to get login URL. Check your server configuration.')
      setLoading(false)
    }
  }

  const handleLogin = async (code) => {
    const codeToUse = code || authCode.trim()
    if (!codeToUse) {
      setError('Please paste your auth code')
      return
    }
    try {
      setLoading(true)
      setError('')
      const data = await generateToken(codeToUse)
      login(data.access_token, data.client_id)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(err.response?.data?.detail || 'Invalid auth code. Please try again.')
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
        <main className="w-full max-w-[400px] animate-fade-in">

          {/* Brand */}
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-panelLight border border-edge shadow-xl mb-6 hover:scale-105 transition-transform">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                <path d="M4 16L10 8L16 14L20 6" stroke="#00cbd6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M4 16L10 8L16 14L20 6" stroke="#1b75ff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" transform="translate(1,-1)" opacity=".4" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white mb-2">Option Spread Analyzer</h1>
            <p className="text-ink text-sm">Connect your account to start analyzing</p>
          </div>

          {/* Card */}
          <div className="card space-y-6">

            {/* Fyers Login */}
            <button
              onClick={handleFyersLogin}
              disabled={loading}
              className="btn-blue"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{opacity:0.85}}>
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              Login with Fyers
            </button>

            {/* Divider */}
            <div className="relative flex items-center py-2">
              <div className="flex-grow border-t border-edge/50" />
              <span className="flex-shrink mx-4 text-[10px] font-mono text-ink/60 uppercase tracking-[0.2em]">Or enter auth code</span>
              <div className="flex-grow border-t border-edge/50" />
            </div>

            {/* Auth code form */}
            <div className="space-y-4">
              <div className="relative group">
                <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8b92a8" strokeWidth="2">
                    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
                  </svg>
                </div>
                <input
                  type={showCode ? 'text' : 'password'}
                  value={authCode}
                  onChange={e => setAuthCode(e.target.value)}
                  placeholder="Paste your auth code here"
                  className="input-field pl-11 pr-12"
                  onKeyDown={e => e.key === 'Enter' && handleLogin()}
                />
                <button
                  type="button"
                  onClick={() => setShowCode(!showCode)}
                  className="absolute inset-y-0 right-4 flex items-center text-ink hover:text-bright transition-colors"
                >
                  {showCode ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>

              {error && (
                <p className="text-crimson text-xs font-mono px-1">{error}</p>
              )}

              <button
                onClick={() => handleLogin()}
                disabled={loading}
                className="btn-primary"
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

            {/* Generate code */}
            <button
              onClick={() => navigate('/auth/generate')}
              className="btn-outline"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                <polyline points="9 12 11 14 15 10"/>
              </svg>
              Generate Authentication Code
            </button>

          </div>

          {/* Status */}
          <div className="mt-8 flex justify-center">
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
        <span>© 2025 OPTION SPREAD ANALYZER • V2.0.0</span>
        <div className="flex items-center gap-6">
          <a href="#" className="hover:text-bright transition-colors">DOCUMENTATION</a>
          <a href="#" className="hover:text-bright transition-colors">SECURITY</a>
          <a href="#" className="hover:text-bright transition-colors">SUPPORT</a>
        </div>
      </footer>

    </div>
  )
}
