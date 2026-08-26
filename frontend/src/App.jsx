import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './hooks/useAuthStore'
import LoginPage from './pages/LoginPage'
import GenerateCodePage from './pages/GenerateCodePage'
import DashboardLayout from './components/layout/DashboardLayout'
import NfoBfoPage from './pages/NfoBfoPage'
import SpreadAnalysisPage from './pages/SpreadAnalysisPage'
import ButterflyIndexPage from './pages/ButterflyIndexPage'
import ButterflyNfoBfoPage from './pages/ButterflyNfoBfoPage'
import StraddlePage from './pages/StraddlePage'
import StraddleSpreadPage from './pages/StraddleSpreadPage'

export default function App() {
  const { isAuthenticated } = useAuthStore()

  return (
    <Routes>
      <Route path="/login" element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <LoginPage />} />
      <Route path="/auth/generate" element={<GenerateCodePage />} />
      <Route path="/auth/callback" element={<LoginPage />} />
      <Route path="/dashboard" element={isAuthenticated ? <DashboardLayout /> : <Navigate to="/login" replace />}>
        <Route index element={<Navigate to="nfo-bfo" replace />} />
        <Route path="nfo-bfo"                element={<NfoBfoPage />} />
        <Route path="spread-analysis"        element={<SpreadAnalysisPage />} />
        <Route path="butterfly-index"        element={<ButterflyIndexPage />} />
        <Route path="butterfly-nfo-bfo"      element={<ButterflyNfoBfoPage />} />
        <Route path="straddle"               element={<StraddlePage />} />
        <Route path="straddle-spread-nfobfo" element={<StraddleSpreadPage />} />
      </Route>
      <Route path="*" element={<Navigate to={isAuthenticated ? '/dashboard' : '/login'} replace />} />
    </Routes>
  )
}
