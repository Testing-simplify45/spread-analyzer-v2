import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../hooks/useAuthStore'
import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL || '/api'

export default function AdminPage() {
  const { getAuthHeader, isAuthenticated } = useAuthStore()
  const navigate = useNavigate()
  const authHeader = getAuthHeader()

  const [profiles,    setProfiles]    = useState([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState('')
  const [success,     setSuccess]     = useState('')
  const [showForm,    setShowForm]    = useState(false)
  const [adminVerified, setAdminVerified] = useState(false)
  const [adminPass,   setAdminPass]   = useState('')
  const [adminError,  setAdminError]  = useState('')

  // New profile form
  const [newName,     setNewName]     = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole,     setNewRole]     = useState('guest')

  // Verify admin access first
  const handleAdminVerify = async () => {
    try {
      const resp = await axios.post(`${BASE_URL}/auth/verify-password`, { password: adminPass })
      if (resp.data.role === 'admin') {
        setAdminVerified(true)
        loadProfiles()
      } else {
        setAdminError('Access denied. Admin password required.')
      }
    } catch {
      setAdminError('Invalid password.')
    }
  }

  const loadProfiles = async () => {
    setLoading(true)
    try {
      const resp = await axios.get(`${BASE_URL}/auth/profiles`, {
        headers: { Authorization: authHeader }
      })
      setProfiles(resp.data.profiles || [])
    } catch (err) {
      setError('Failed to load profiles')
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async () => {
    if (!newName || !newPassword) { setError('Name and password required'); return }
    try {
      await axios.post(`${BASE_URL}/auth/profiles`, {
        name: newName, password: newPassword, role: newRole
      }, { headers: { Authorization: authHeader } })
      setSuccess('Profile created!')
      setNewName(''); setNewPassword(''); setNewRole('guest')
      setShowForm(false)
      loadProfiles()
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to create profile')
    }
  }

  const handleToggle = async (id, isActive) => {
    try {
      await axios.patch(`${BASE_URL}/auth/profiles/${id}`,
        { is_active: !isActive },
        { headers: { Authorization: authHeader } }
      )
      loadProfiles()
    } catch {
      setError('Failed to update profile')
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this profile?')) return
    try {
      await axios.delete(`${BASE_URL}/auth/profiles/${id}`, {
        headers: { Authorization: authHeader }
      })
      loadProfiles()
    } catch {
      setError('Failed to delete profile')
    }
  }

  // Admin verification gate
  if (!adminVerified) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-void relative overflow-hidden">
        <div className="absolute inset-0 bg-grid-pattern bg-grid opacity-50" />
        <div className="relative z-10 w-full max-w-sm px-4">
          <div className="card space-y-4">
            <div className="text-center mb-2">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-panelLight border border-edge mb-4">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00cbd6" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
              </div>
              <h2 className="text-lg font-bold text-bright">Admin Access</h2>
              <p className="text-ink text-sm mt-1">Enter admin password to continue</p>
            </div>
            <input
              type="password"
              value={adminPass}
              onChange={e => setAdminPass(e.target.value)}
              placeholder="Admin password"
              className="input-field"
              onKeyDown={e => e.key === 'Enter' && handleAdminVerify()}
              autoFocus
            />
            {adminError && <p className="text-crimson text-xs font-mono">{adminError}</p>}
            <button onClick={handleAdminVerify} className="btn-primary">Verify</button>
            <button onClick={() => navigate('/dashboard')}
              className="w-full text-center text-sm text-ink hover:text-bright transition-colors py-2">
              ← Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-void p-6">
      <div className="max-w-4xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-bright tracking-tight">Admin Panel</h1>
            <p className="text-ink text-sm mt-1">Manage user profiles and access</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setShowForm(!showForm)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan text-void font-bold text-sm hover:bg-cyan/90 transition-all">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              New Profile
            </button>
            <button onClick={() => navigate('/dashboard')}
              className="px-4 py-2 rounded-xl bg-panel border border-edge text-sm text-ink hover:text-bright transition-all">
              ← Dashboard
            </button>
          </div>
        </div>

        {/* Alerts */}
        {error   && <div className="mb-4 p-3 rounded-xl bg-crimson/10 border border-crimson/20 text-crimson text-sm font-mono">{error}</div>}
        {success && <div className="mb-4 p-3 rounded-xl bg-emerald/10 border border-emerald/20 text-emerald text-sm font-mono">{success}</div>}

        {/* Create form */}
        {showForm && (
          <div className="bg-panel border border-edge rounded-2xl p-5 mb-6">
            <h3 className="text-sm font-semibold text-bright mb-4">Create New Profile</h3>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div>
                <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Name</label>
                <input type="text" value={newName} onChange={e => setNewName(e.target.value)}
                  placeholder="Profile name"
                  className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan" />
              </div>
              <div>
                <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Password</label>
                <input type="text" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                  placeholder="Password"
                  className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan" />
              </div>
              <div>
                <label className="text-[10px] font-mono text-ink uppercase tracking-wider mb-1 block">Role</label>
                <select value={newRole} onChange={e => setNewRole(e.target.value)}
                  className="w-full bg-panelLight border border-edge rounded-lg px-3 py-2 text-sm text-bright font-mono outline-none focus:border-cyan">
                  <option value="admin">Admin</option>
                  <option value="guest">Guest (Broken)</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={handleCreate}
                className="px-4 py-2 rounded-xl bg-cyan text-void font-bold text-sm hover:bg-cyan/90 transition-all">
                Create Profile
              </button>
              <button onClick={() => setShowForm(false)}
                className="px-4 py-2 rounded-xl bg-panel border border-edge text-sm text-ink hover:text-bright transition-all">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Profiles table */}
        <div className="bg-panel border border-edge rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b border-edge">
            <span className="text-xs font-mono font-semibold text-ink uppercase tracking-wider">Profiles</span>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-edge bg-panelLight/40">
                {['Name','Password','Role','Status','Created','Actions'].map(h => (
                  <th key={h} className="table-header text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center py-8 text-ink font-mono text-sm">Loading...</td></tr>
              ) : profiles.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-ink font-mono text-sm">No profiles found</td></tr>
              ) : profiles.map(p => (
                <tr key={p.id} className="border-b border-edge/40 hover:bg-panelLight/40 transition-colors">
                  <td className="table-cell font-semibold text-bright">{p.name}</td>
                  <td className="table-cell font-mono text-cyan">{p.password}</td>
                  <td className="table-cell">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold
                      ${p.role === 'admin' ? 'bg-cyan/10 text-cyan' : 'bg-ink/10 text-ink'}`}>
                      {p.role}
                    </span>
                  </td>
                  <td className="table-cell">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold
                      ${p.is_active ? 'bg-emerald/10 text-emerald' : 'bg-crimson/10 text-crimson'}`}>
                      {p.is_active ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                  <td className="table-cell text-ink font-mono text-xs">
                    {new Date(p.created_at).toLocaleDateString()}
                  </td>
                  <td className="table-cell">
                    <div className="flex items-center gap-2">
                      <button onClick={() => handleToggle(p.id, p.is_active)}
                        className="px-2 py-1 rounded-lg text-[10px] font-mono bg-panelLight border border-edge text-ink hover:text-bright transition-all">
                        {p.is_active ? 'Disable' : 'Enable'}
                      </button>
                      <button onClick={() => handleDelete(p.id)}
                        className="px-2 py-1 rounded-lg text-[10px] font-mono bg-crimson/10 border border-crimson/20 text-crimson hover:bg-crimson/20 transition-all">
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  )
}
