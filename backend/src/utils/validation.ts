const MAX_MONEY = 100_000_000
const MAX_COUNT = 1_000_000

/** Rounds to whole centavos so repeated additions never accumulate floating-point drift. */
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function isMoney(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_MONEY
}

export function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_COUNT
}

/**
 * Checks for one "@" with text before it and a dotted domain after it, and no whitespace. It avoids a regular expression
 * on purpose: patterns like /^[^\s@]+@[^\s@]+\.[^\s@]+$/ backtrack polynomially on long inputs such as "a@" + "." x 10000.
 */
export function isEmail(value: string): boolean {
  if (value.length > 254 || /\s/.test(value)) return false
  const at = value.indexOf('@')
  if (at < 1 || at !== value.lastIndexOf('@')) return false
  const domain = value.slice(at + 1)
  const lastDot = domain.lastIndexOf('.')
  return lastDot > 0 && lastDot < domain.length - 1
}

/** A trimmed, non-empty string no longer than `maxLength`, or null when the value is unusable. */
export function cleanText(value: unknown, maxLength = 64): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed && trimmed.length <= maxLength ? trimmed : null
}

export function isIdempotencyKey(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(value)
}
