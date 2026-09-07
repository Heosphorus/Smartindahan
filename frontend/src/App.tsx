import './App.css'
import { useState, useEffect } from 'react'

import { AuthPage } from './features/auth/AuthPage'
import { StoreOperationsDemo } from './features/store/StoreOperationsDemo'
import { AdminPanel } from './features/admin/AdminPanel'

function App() {
  const [token, setToken] = useState(() => localStorage.getItem('sarismart_token'))
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    // Check if we're on the admin route
    const path = window.location.pathname
    setIsAdmin(path === '/admin')
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
