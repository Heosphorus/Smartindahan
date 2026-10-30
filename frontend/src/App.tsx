import './App.css'
import { useState, useEffect } from 'react'

import { AuthPage } from './features/auth/AuthPage'
import { LegalPage } from './features/legal/LegalPage'
import { parseLegalRoute } from './features/legal/legalRoutes'
import { PolicyGate } from './features/legal/PolicyGate'
import { authApi } from './services/authApi'
import { StoreOperationsDemo } from './features/store/StoreOperationsDemo'
import { AdminPanel } from './features/admin/AdminPanel'
import { installButtonTooltips } from './services/buttonTooltips'

const trimTrailingSlashes = (value: string) => value.replace(/\/+$/, '')

// The app may be hosted under a sub-path (GitHub Pages), so compare against the Vite base URL.
function isAdminPath(pathname: string): boolean {
  return trimTrailingSlashes(pathname) === `${trimTrailingSlashes(import.meta.env.BASE_URL)}/admin`
}

async function signOut(token: string | null) {
  // Revoke the session on the server, then drop it locally even if the network call fails.
  if (token) await authApi.logout(token).catch(() => undefined)
  localStorage.removeItem('sarismart_token')
  window.location.assign(import.meta.env.BASE_URL)
}

function App() {
  const [token, setToken] = useState(() => localStorage.getItem('sarismart_token'))
  const isAdmin = isAdminPath(window.location.pathname)
  const legalRoute = parseLegalRoute(window.location.pathname)

  useEffect(() => {
    const expireSession = () => setToken(null)
    window.addEventListener('sarismart:session-expired', expireSession)
    const removeButtonTooltips = installButtonTooltips(document.body)
    return () => {
      window.removeEventListener('sarismart:session-expired', expireSession)
      removeButtonTooltips()
    }
  }, [])

  // The policies are public: readable without an account, and without leaving the registration form's tab.
  if (legalRoute) return <LegalPage type={legalRoute} />

  if (!token) {
    return <AuthPage onAuthenticated={setToken} />
  }

  if (isAdmin) {
    return <AdminPanel />
  }

  return <PolicyGate onSignOut={() => void signOut(token)}><StoreOperationsDemo /></PolicyGate>
}

export default App
