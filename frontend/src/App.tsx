import './App.css'
import { useState } from 'react'

import { AuthPage } from './features/auth/AuthPage'
import { StoreOperationsDemo } from './features/store/StoreOperationsDemo'

function App() {
  const [token, setToken] = useState(() => localStorage.getItem('sarismart_token'))

  if (!token) {
    return <AuthPage onAuthenticated={setToken} />
  }

  return <StoreOperationsDemo />
}

export default App
