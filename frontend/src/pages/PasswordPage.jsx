import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../hooks/useAuthStore'
import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL || '/api'

export default function PasswordPage() {
  const [password,  setPassword]  = useState('')
  const [showPass,  setShowPass]  = useState(false)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState('')
  const { logout }                = useAuthStore()
  const navigate                  = useNavigate()

  const handleLogin = async () => {
    if (!password.trim()) { setError('Please enter your password'); return }
    setLoading(true)
    setError('')
    try {
      const resp = await axios.post(`${BASE_URL}/auth/verify-password`,
        { password: password.trim() }
      )
      const { role } = resp.data

      // Store role in sessionStorage (cleared when browser closes)
      sessionStorage.setItem('osa_role', role)
      sessionStorage.setItem('osa_password_verified', 'true')

      if (role === 'admin') {
        navigate('/dashboard', { replace: true })
      } else if (role === 'guest') {
        navigate('/broken', { replace: true })
      } else {
        setError('Invalid password. Please try again.')
      }
    } catch (err) {
      setError('Invalid password. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleBack = () => {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden bg-void">

      {/* Background */}
      <div className="absolute inset-0 z-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(27,117,255,0.08),transparent_50%)]" />
        <div className="absolute inset-0 bg-grid-pattern bg-grid" />
      </div>

      <div className="flex-1 flex items-center justify-center px-4 relative z-20">
        <main className="w-full max-w-[400px] animate-fade-in">

          {/* Brand */}
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-panelLight border border-edge shadow-xl mb-6">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                <path d="M4 16L10 8L16 14L20 6" stroke="#00cbd6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M4 16L10 8L16 14L20 6" stroke="#1b75ff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" transform="translate(1,-1)" opacity=".4" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white mb-2">Secure Login</h1>
            <p className="text-ink text-sm">Enter your password to continue</p>
          </div>

          {/* Card */}
          <div className="card space-y-4">

            {/* Password input */}
            <div className="relative group">
              <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8b92a8" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
              </div>
              <input
                type={showPass ? 'text' : 'password'}
                value={password}
                onChange={e => { setPassword(e.target.value); setError('') }}
                placeholder="Enter your password"
                className="input-field pl-11 pr-12"
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPass(!showPass)}
                className="absolute inset-y-0 right-4 flex items-center text-ink hover:text-bright transition-colors"
              >
                {showPass ? (
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

            {/* Login button */}
            <button
              onClick={handleLogin}
              disabled={loading}
              className="btn-blue"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  Verifying...
                </span>
              ) : 'Login'}
            </button>

            {/* Back */}
            <button
              onClick={handleBack}
              className="w-full text-center text-sm text-ink hover:text-bright transition-colors flex items-center justify-center gap-2 py-2"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M5 12l7-7M5 12l7 7"/>
              </svg>
              Back to Login
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
      <footer className="relative z-20 px-8 py-6 flex items-center justify-between text-[11px] font-mono text-ink/50 border-t border-edge/20">
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
