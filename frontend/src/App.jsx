import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './hooks/useAuthStore'
import LoginPage from './pages/LoginPage'
import GenerateCodePage from './pages/GenerateCodePage'
import DashboardLayout from './components/layout/DashboardLayout'
import NfoBfoPage from './pages/NfoBfoPage'

export default function App() {
  const { isAuthenticated } = useAuthStore()

  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={
        isAuthenticated ? <Navigate to="/dashboard" replace /> : <LoginPage />
      } />
      <Route path="/auth/generate" element={<GenerateCodePage />} />
      <Route path="/auth/callback" element={<LoginPage />} />

      {/* Protected routes */}
      <Route path="/dashboard" element={
        isAuthenticated ? <DashboardLayout /> : <Navigate to="/login" replace />
      }>
        <Route index element={<Navigate to="nfo-bfo" replace />} />
        <Route path="nfo-bfo" element={<NfoBfoPage />} />
      </Route>

      {/* Default */}
      <Route path="*" element={
        <Navigate to={isAuthenticated ? '/dashboard' : '/login'} replace />
      } />
    </Routes>
  )
}
