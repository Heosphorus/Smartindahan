import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './theme.css'
import './darkReadability.css'
import './darkContrast.css'
import { applyThemePreferences, getThemePreferences } from './services/themePreferences'
import App from './App.tsx'

applyThemePreferences(getThemePreferences())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
