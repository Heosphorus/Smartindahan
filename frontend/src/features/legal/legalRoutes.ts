import type { PolicyType } from '../../services/legalApi'

const trimTrailingSlashes = (value: string) => value.replace(/\/+$/, '')

/** The app may live under a sub-path (GitHub Pages), so every legal URL is built from the Vite base URL. */
export function legalPath(type: PolicyType, version?: string): string {
  const path = `${trimTrailingSlashes(import.meta.env.BASE_URL)}/${type === 'terms' ? 'terms' : 'privacy'}`
  return version ? `${path}?version=${encodeURIComponent(version)}` : path
}

export function parseLegalRoute(pathname: string): PolicyType | null {
  const base = trimTrailingSlashes(import.meta.env.BASE_URL)
  const path = trimTrailingSlashes(pathname)
  if (path === `${base}/terms`) return 'terms'
  if (path === `${base}/privacy`) return 'privacy'
  return null
}

export function formatPolicyDate(value: string): string {
  return new Date(value).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })
}

/** Fired after the user accepts or acknowledges a policy so other screens (settings) can refresh their history. */
export const CONSENT_CHANGED_EVENT = 'smartindahan:consent-changed'
