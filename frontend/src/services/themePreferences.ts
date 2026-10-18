export type ThemeMode = 'light' | 'dark'
export type AccentColor = 'teal' | 'blue' | 'green' | 'rose' | 'amber' | 'graphite'
export type FontFamily = 'system' | 'humanist' | 'georgia' | 'mono'
export type FontSize = 'small' | 'standard' | 'large' | 'extra-large'

export type ThemePreferences = {
  mode: ThemeMode
  accent: AccentColor
  fontFamily: FontFamily
  fontSize: FontSize
}

export const fontOptions: Array<{ id: FontFamily; name: string; stack: string }> = [
  { id: 'system', name: 'System Sans', stack: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  { id: 'humanist', name: 'Friendly Sans', stack: '"Trebuchet MS", "Segoe UI", sans-serif' },
  { id: 'georgia', name: 'Georgia', stack: 'Georgia, "Times New Roman", serif' },
  { id: 'mono', name: 'Clear Mono', stack: 'ui-monospace, "Cascadia Code", "Segoe UI Mono", monospace' },
]

export const fontSizeOptions: Array<{ id: FontSize; name: string; scale: string }> = [
  { id: 'small', name: 'Small', scale: '90%' },
  { id: 'standard', name: 'Standard', scale: '100%' },
  { id: 'large', name: 'Large', scale: '110%' },
  { id: 'extra-large', name: 'Extra large', scale: '120%' },
]

export const accentOptions: Array<{ id: AccentColor; name: string; color: string; hover: string; darkText: string }> = [
  { id: 'teal', name: 'Teal', color: '#13877f', hover: '#0f706a', darkText: '#75d5c7' },
  { id: 'blue', name: 'Blue', color: '#2563a6', hover: '#1d4e82', darkText: '#91c4ff' },
  { id: 'green', name: 'Green', color: '#337a45', hover: '#286238', darkText: '#9be3a9' },
  { id: 'rose', name: 'Rose', color: '#b34e66', hover: '#923c52', darkText: '#ffadbd' },
  { id: 'amber', name: 'Amber', color: '#a96515', hover: '#86500f', darkText: '#ffd28a' },
  { id: 'graphite', name: 'Graphite', color: '#4c5964', hover: '#35414b', darkText: '#c5d1d7' },
]

const storageKey = 'sarismart_theme_preferences'
const defaults: ThemePreferences = { mode: 'light', accent: 'teal', fontFamily: 'system', fontSize: 'standard' }

export function getThemePreferences(): ThemePreferences {
  try {
    const stored = localStorage.getItem(storageKey)
    if (!stored) return defaults
    const parsed = JSON.parse(stored) as Partial<ThemePreferences>
    return {
      mode: parsed.mode === 'dark' ? 'dark' : 'light',
      accent: accentOptions.some((option) => option.id === parsed.accent) ? parsed.accent as AccentColor : 'teal',
      fontFamily: fontOptions.some((option) => option.id === parsed.fontFamily) ? parsed.fontFamily as FontFamily : defaults.fontFamily,
      fontSize: fontSizeOptions.some((option) => option.id === parsed.fontSize) ? parsed.fontSize as FontSize : defaults.fontSize,
    }
  } catch {
    return defaults
  }
}

export function applyThemePreferences(preferences: ThemePreferences): void {
  const root = document.documentElement
  const accent = accentOptions.find((option) => option.id === preferences.accent) ?? accentOptions[0]
  root.dataset.theme = preferences.mode
  root.dataset.accent = preferences.accent
  root.style.setProperty('--app-accent', accent.color)
  root.style.setProperty('--app-accent-hover', accent.hover)
  root.style.setProperty('--app-accent-readable', preferences.mode === 'dark' ? accent.darkText : accent.color)
  root.style.setProperty('--app-font-family', fontOptions.find((option) => option.id === preferences.fontFamily)?.stack ?? fontOptions[0].stack)
  root.style.setProperty('--app-font-scale', fontSizeOptions.find((option) => option.id === preferences.fontSize)?.scale ?? '1')
}

export function saveThemePreferences(preferences: ThemePreferences): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(preferences))
  } catch {
    // The current page still receives the selected theme if storage is unavailable.
  }
  applyThemePreferences(preferences)
}
