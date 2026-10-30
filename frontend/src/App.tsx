import './App.css'
import { useState, useEffect } from 'react'

import { AuthPage } from './features/auth/AuthPage'
import { StoreOperationsDemo } from './features/store/StoreOperationsDemo'
import { AdminPanel } from './features/admin/AdminPanel'
import { installButtonTooltips } from './services/buttonTooltips'

const trimTrailingSlashes = (value: string) => value.replace(/\/+$/, '')

// The app may be hosted under a sub-path (GitHub Pages), so compare against the Vite base URL.
function isAdminPath(pathname: string): boolean {
  return trimTrailingSlashes(pathname) === `${trimTrailingSlashes(import.meta.env.BASE_URL)}/admin`
}

function App() {
  const [token, setToken] = useState(() => localStorage.getItem('sarismart_token'))
  const isAdmin = isAdminPath(window.location.pathname)

  useEffect(() => {
    const expireSession = () => setToken(null)
    window.addEventListener('sarismart:session-expired', expireSession)
    const removeButtonTooltips = installButtonTooltips(document.body)
    return () => {
      window.removeEventListener('sarismart:session-expired', expireSession)
      removeButtonTooltips()
    }
  }, [])

  if (!token) {
    return <AuthPage onAuthenticated={setToken} />
  }

  if (isAdmin) {
    return <AdminPanel />
  }

  return <StoreOperationsDemo />
}

export default App
