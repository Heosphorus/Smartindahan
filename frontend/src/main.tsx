import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './theme.css'
import './darkReadability.css'
import './darkContrast.css'
import './userPreferences.css'
import './accountSettings.css'
import './appDesignSystem.css'
import { applyThemePreferences, getThemePreferences } from './services/themePreferences'
import InputLengthLimit from './components/InputLengthLimit'
import App from './App.tsx'

applyThemePreferences(getThemePreferences())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <InputLengthLimit />
    <App />
  </StrictMode>,
)
