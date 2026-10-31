import type { PriceAdjustment } from '../../services/storeApi'

/** What the user picks in the batch price editor. */
export type AdjustMode = 'none' | 'set' | 'increase-percent' | 'decrease-percent' | 'increase-amount' | 'decrease-amount'

export const ADJUST_MODES: Array<{ mode: AdjustMode; label: string }> = [
  { mode: 'none', label: 'No change' },
  { mode: 'set', label: 'Set to a price' },
  { mode: 'increase-percent', label: 'Increase by %' },
  { mode: 'decrease-percent', label: 'Decrease by %' },
  { mode: 'increase-amount', label: 'Increase by amount' },
  { mode: 'decrease-amount', label: 'Decrease by amount' },
]

const MAX_PRICE = 100_000_000
const MAX_PERCENT = 1000

export type ParsedAdjustment =
  | { kind: 'none' }
  | { kind: 'ok'; adjustment: PriceAdjustment }
  | { kind: 'invalid'; message: string }

/** Turns what was typed into an adjustment the server understands, or explains what is wrong with it. */
export function parseAdjustmentInput(mode: AdjustMode, text: string): ParsedAdjustment {
  if (mode === 'none') return { kind: 'none' }
  const value = Number(text)
  if (text.trim() === '' || !Number.isFinite(value) || value < 0) return { kind: 'invalid', message: 'Enter a number of zero or more.' }
  if (mode === 'set') return value <= MAX_PRICE ? { kind: 'ok', adjustment: { type: 'set', value } } : { kind: 'invalid', message: 'That price is too large.' }
  if (mode === 'increase-percent' || mode === 'decrease-percent') {
    if (value > (mode === 'decrease-percent' ? 100 : MAX_PERCENT)) return { kind: 'invalid', message: mode === 'decrease-percent' ? 'A price cannot drop by more than 100%.' : `Increase by at most ${MAX_PERCENT}%.` }
    return { kind: 'ok', adjustment: { type: 'percent', value: mode === 'decrease-percent' ? -value : value } }
  }
  if (value > MAX_PRICE) return { kind: 'invalid', message: 'That amount is too large.' }
  return { kind: 'ok', adjustment: { type: 'amount', value: mode === 'decrease-amount' ? -value : value } }
}

const roundCentavos = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

/** The new price in whole centavos, or null when it would be negative or too large. Matches the server's calculation. */
export function applyAdjustment(current: number, adjustment: PriceAdjustment): number | null {
  const next = adjustment.type === 'set'
    ? adjustment.value
    : adjustment.type === 'percent'
      ? current * (1 + adjustment.value / 100)
      : current + adjustment.value
  const rounded = roundCentavos(next)
  return Number.isFinite(rounded) && rounded >= 0 && rounded <= MAX_PRICE ? rounded : null
}
