import { isMoney, roundMoney } from './validation.js'

/**
 * How one price changes in a batch edit:
 * - `set`: every product gets this exact price.
 * - `percent`: add this percentage of the current price (negative lowers it), e.g. 10 makes 20.00 into 22.00.
 * - `amount`: add this many pesos to the current price (negative lowers it).
 */
export type Adjustment = { type: 'set' | 'percent' | 'amount'; value: number }

const MAX_PERCENT = 1000

/** Reads an adjustment from request JSON. Returns null when it is malformed (so the caller can answer 400). */
export function parseAdjustment(raw: unknown): Adjustment | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { type, value } = raw as { type?: unknown; value?: unknown }
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (type === 'set') return isMoney(value) ? { type, value } : null
  if (type === 'percent') return value >= -100 && value <= MAX_PERCENT ? { type, value } : null
  if (type === 'amount') return Math.abs(value) <= 100_000_000 ? { type, value } : null
  return null
}

/** The new price in whole centavos, or null when the result would be negative or larger than a price may be. */
export function applyAdjustment(current: number, adjustment: Adjustment): number | null {
  const next = adjustment.type === 'set'
    ? adjustment.value
    : adjustment.type === 'percent'
      ? current * (1 + adjustment.value / 100)
      : current + adjustment.value
  const rounded = roundMoney(next)
  return isMoney(rounded) ? rounded : null
}
