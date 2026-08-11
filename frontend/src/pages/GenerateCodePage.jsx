import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { extractAuthCode } from '../utils/api'

export default function GenerateCodePage() {
  const [url, setUrl]         = useState('')
  const [code, setCode]       = useState('')
  const [copied, setCopied]   = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const navigate              = useNavigate()

  const handleGenerate = async () => {
    if (!url.trim()) {
      setError('Please paste your redirect URL')
      return
    }
    try {
      setLoading(true)
      setError('')
      // Try to extract from URL directly first
      const urlObj   = new URL(url.trim())
      const authCode = urlObj.searchParams.get('auth_code')
      if (authCode) {
        setCode(authCode)
      } else {
        const data = await extractAuthCode(url.trim())
        setCode(data.auth_code)
      }
    } catch {
      // If URL parse fails, maybe they pasted just the code
      if (url.trim().startsWith('ey') && url.trim().length > 20) {
        setCode(url.trim())
      } else {
        setError('Could not extract auth code. Please paste the full redirect URL.')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden bg-void">

      {/* Background */}
      <div className="absolute inset-0 z-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(27,117,255,0.08),transparent_50%)]" />
        <div className="absolute inset-0 bg-grid-pattern bg-grid" />
      </div>

      <div className="flex-1 flex items-center justify-center px-4 relative z-20">
        <main className="w-full max-w-[500px] animate-fade-in">

          {/* Back */}
          <button
            onClick={() => navigate('/login')}
            className="flex items-center gap-2 text-ink hover:text-bright transition-all text-[10px] font-mono tracking-widest uppercase mb-8 group"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              className="group-hover:-translate-x-1 transition-transform">
              <path d="M19 12H5M5 12l7-7M5 12l7 7"/>
            </svg>
            Back to Secure Login
          </button>

          <div className="card space-y-8">

            {/* Header */}
            <header>
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 rounded-lg bg-cyan/10 flex items-center justify-center">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00cbd6" strokeWidth="2">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                    <polyline points="9 12 11 14 15 10"/>
                  </svg>
                </div>
                <h1 className="text-xl font-bold tracking-tight text-white">Generate Session Code</h1>
              </div>
            </header>

            <div className="space-y-6">

              {/* Input */}
              <div className="space-y-3">
                <label className="text-[10px] font-mono font-semibold text-ink uppercase tracking-widest ml-1">
                  Redirect / Validation Link
                </label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b92a8" strokeWidth="2">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                    </svg>
                  </div>
                  <input
                    type="text"
                    value={url}
                    onChange={e => { setUrl(e.target.value); setError('') }}
                    placeholder="https://api.fyers.in/..."
                    className="input-field pl-11"
                    onKeyDown={e => e.key === 'Enter' && handleGenerate()}
                  />
                </div>

                {error && <p className="text-crimson text-xs font-mono px-1">{error}</p>}

                <button
                  onClick={handleGenerate}
                  disabled={loading}
                  className="btn-primary"
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                      </svg>
                      Extracting...
                    </span>
                  ) : (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/>
                        <path d="M9 18h6M10 22h4"/>
                      </svg>
                      Generate Authentication Code
                    </>
                  )}
                </button>
              </div>

              {/* Divider */}
              <div className="relative py-2">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-edge/50" />
                </div>
                <div className="relative flex justify-center text-[9px] uppercase tracking-[0.3em]">
                  <span className="bg-panel px-4 text-ink/40 font-mono">Extraction Result</span>
                </div>
              </div>

              {/* Output */}
              <div className="space-y-3">
                <div className="flex items-center justify-between ml-1">
                  <label className="text-[10px] font-mono font-semibold text-ink uppercase tracking-widest">
                    Extracted Token
                  </label>
                  {code && (
                    <span className="text-[9px] font-mono text-emerald/80 flex items-center gap-1">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                        <polyline points="22 4 12 14.01 9 11.01"/>
                      </svg>
                      READY
                    </span>
                  )}
                </div>

                <div className="relative group">
                  <div className="rounded-2xl p-5 min-h-[110px] bg-void/50 border border-edge/50 group-hover:border-cyan/30 transition-all flex flex-col justify-between">
                    <p className="text-sm font-mono text-cyan/90 break-all leading-relaxed">
                      {code || (
                        <span className="text-ink/30">
                          eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
                        </span>
                      )}
                    </p>
                    {code && (
                      <div className="mt-4 flex justify-end">
                        <button
                          onClick={handleCopy}
                          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-panelLight border border-edge text-xs font-semibold text-ink hover:text-white hover:border-cyan/50 hover:bg-cyan/5 transition-all"
                        >
                          {copied ? (
                            <>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#00c676" strokeWidth="2">
                                <polyline points="20 6 9 17 4 12"/>
                              </svg>
                              <span className="text-emerald">Copied!</span>
                            </>
                          ) : (
                            <>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                              </svg>
                              Copy to Clipboard
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                  {code && (
                    <div className="absolute -inset-0.5 bg-gradient-to-r from-cyan/20 to-blue/20 rounded-2xl blur opacity-0 group-hover:opacity-100 transition duration-500 -z-10" />
                  )}
                </div>

                <div className="flex items-start gap-2 px-2">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#8b92a8" strokeWidth="2" className="mt-0.5 flex-shrink-0">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  <p className="text-[10px] text-ink/60 leading-relaxed font-mono">
                    Copy this code and paste it into the password field on the login page to complete your secure session initialization.
                  </p>
                </div>

              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Footer */}
      <footer className="relative z-20 px-8 py-6 flex items-center justify-between text-[11px] font-mono text-ink/50 border-t border-edge/20">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald" />
          <span>ENCRYPTION ENGINE ACTIVE</span>
        </div>
        <span>© 2025 OPTION SPREAD ANALYZER • V2.0.0</span>
      </footer>
    </div>
  )
}
