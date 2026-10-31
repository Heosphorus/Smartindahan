import { describe, expect, it } from 'vitest'

import { applyAdjustment, parseAdjustmentInput } from './priceAdjust'

describe('price adjustment input', () => {
  it('turns each mode into the signed adjustment the server expects', () => {
    expect(parseAdjustmentInput('none', '')).toEqual({ kind: 'none' })
    expect(parseAdjustmentInput('set', '25.5')).toEqual({ kind: 'ok', adjustment: { type: 'set', value: 25.5 } })
    expect(parseAdjustmentInput('increase-percent', '10')).toEqual({ kind: 'ok', adjustment: { type: 'percent', value: 10 } })
    expect(parseAdjustmentInput('decrease-percent', '10')).toEqual({ kind: 'ok', adjustment: { type: 'percent', value: -10 } })
    expect(parseAdjustmentInput('increase-amount', '2')).toEqual({ kind: 'ok', adjustment: { type: 'amount', value: 2 } })
    expect(parseAdjustmentInput('decrease-amount', '2')).toEqual({ kind: 'ok', adjustment: { type: 'amount', value: -2 } })
  })

  it('explains blank, negative, non-numeric and out-of-range input', () => {
    for (const [mode, text] of [['set', ''], ['set', '  '], ['set', '-1'], ['set', 'abc'], ['decrease-percent', '101'], ['increase-percent', '1001'], ['set', '200000000'], ['increase-amount', '200000000']] as const) {
      expect(parseAdjustmentInput(mode, text).kind, `${mode} ${text}`).toBe('invalid')
    }
    expect(parseAdjustmentInput('decrease-percent', '100').kind).toBe('ok')
  })
})

describe('applying an adjustment', () => {
  it('matches the server: centavo rounding, and null when the result is not a valid price', () => {
    expect(applyAdjustment(20, { type: 'set', value: 25.5 })).toBe(25.5)
    expect(applyAdjustment(20, { type: 'percent', value: 10 })).toBe(22)
    expect(applyAdjustment(19.99, { type: 'percent', value: 10 })).toBe(21.99)
    expect(applyAdjustment(20, { type: 'percent', value: -100 })).toBe(0)
    expect(applyAdjustment(20, { type: 'amount', value: -5.25 })).toBe(14.75)
    expect(applyAdjustment(3, { type: 'amount', value: -5 })).toBeNull()
    expect(applyAdjustment(99_999_999, { type: 'amount', value: 100 })).toBeNull()
  })
})
