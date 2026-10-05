import './App.css'
import { useState, useEffect } from 'react'

import { AuthPage } from './features/auth/AuthPage'
import { StoreOperationsDemo } from './features/store/StoreOperationsDemo'
import { AdminPanel } from './features/admin/AdminPanel'
import { installButtonTooltips } from './services/buttonTooltips'

function App() {
  const [token, setToken] = useState(() => localStorage.getItem('sarismart_token'))
  const isAdmin = window.location.pathname === '/admin'

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
