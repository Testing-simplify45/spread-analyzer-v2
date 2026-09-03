import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './hooks/useAuthStore'
import LoginPage from './pages/LoginPage'
import GenerateCodePage from './pages/GenerateCodePage'
import PasswordPage from './pages/PasswordPage'
import BrokenPage from './pages/BrokenPage'
import AdminPage from './pages/AdminPage'
import DashboardLayout from './components/layout/DashboardLayout'
import NfoBfoPage from './pages/NfoBfoPage'
import SpreadAnalysisPage from './pages/SpreadAnalysisPage'
import ButterflyIndexPage from './pages/ButterflyIndexPage'
import ButterflyNfoBfoPage from './pages/ButterflyNfoBfoPage'
import StraddlePage from './pages/StraddlePage'
import StraddleSpreadPage from './pages/StraddleSpreadPage'
import LiveMonitorPage from './pages/LiveMonitorPage'

function ProtectedRoute({ children }) {
  const { isAuthenticated } = useAuthStore()
  const verified = sessionStorage.getItem('osa_password_verified')
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (!verified) return <Navigate to="/auth/password" replace />
  return children
}

export default function App() {
  const { isAuthenticated } = useAuthStore()

  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={
        isAuthenticated ? <Navigate to="/auth/password" replace /> : <LoginPage />
      } />
      <Route path="/auth/generate"  element={<GenerateCodePage />} />
      <Route path="/auth/callback"  element={<LoginPage />} />
      <Route path="/auth/password"  element={
        isAuthenticated ? <PasswordPage /> : <Navigate to="/login" replace />
      } />

      {/* Broken page for guest profile */}
      <Route path="/broken" element={<BrokenPage />} />

      {/* Hidden admin panel */}
      <Route path="/admin" element={<AdminPage />} />

      {/* Protected dashboard */}
      <Route path="/dashboard" element={
        <ProtectedRoute>
          <DashboardLayout />
        </ProtectedRoute>
      }>
        <Route index                    element={<Navigate to="nfo-bfo" replace />} />
        <Route path="nfo-bfo"           element={<NfoBfoPage />} />
        <Route path="spread-analysis"   element={<SpreadAnalysisPage />} />
        <Route path="butterfly-index"   element={<ButterflyIndexPage />} />
        <Route path="butterfly-nfo-bfo" element={<ButterflyNfoBfoPage />} />
        <Route path="straddle"          element={<StraddlePage />} />
        <Route path="straddle-spread-nfobfo" element={<StraddleSpreadPage />} />
        <Route path="live-monitor"           element={<LiveMonitorPage />} />
      </Route>

      {/* Default */}
      <Route path="*" element={
        <Navigate to={isAuthenticated ? '/auth/password' : '/login'} replace />
      } />
    </Routes>
  )
}
