export type ThemeMode = 'light' | 'dark'
export type AccentColor = 'teal' | 'blue' | 'green' | 'rose' | 'amber' | 'graphite'

export type ThemePreferences = {
  mode: ThemeMode
  accent: AccentColor
}

export const accentOptions: Array<{ id: AccentColor; name: string; color: string; hover: string; darkText: string }> = [
  { id: 'teal', name: 'Teal', color: '#16837a', hover: '#136b66', darkText: '#75d5c7' },
  { id: 'blue', name: 'Blue', color: '#2563a6', hover: '#1d4e82', darkText: '#91c4ff' },
  { id: 'green', name: 'Green', color: '#337a45', hover: '#286238', darkText: '#9be3a9' },
  { id: 'rose', name: 'Rose', color: '#b34e66', hover: '#923c52', darkText: '#ffadbd' },
  { id: 'amber', name: 'Amber', color: '#a96515', hover: '#86500f', darkText: '#ffd28a' },
  { id: 'graphite', name: 'Graphite', color: '#4c5964', hover: '#35414b', darkText: '#c5d1d7' },
]

const storageKey = 'sarismart_theme_preferences'
const defaults: ThemePreferences = { mode: 'light', accent: 'teal' }

export function getThemePreferences(): ThemePreferences {
  try {
    const stored = localStorage.getItem(storageKey)
    if (!stored) return defaults
    const parsed = JSON.parse(stored) as Partial<ThemePreferences>
    return {
      mode: parsed.mode === 'dark' ? 'dark' : 'light',
      accent: accentOptions.some((option) => option.id === parsed.accent) ? parsed.accent as AccentColor : 'teal',
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
}

export function saveThemePreferences(preferences: ThemePreferences): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(preferences))
  } catch {
    // The current page still receives the selected theme if storage is unavailable.
  }
  applyThemePreferences(preferences)
}
