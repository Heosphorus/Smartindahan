import { describe, expect, it } from 'vitest'

import { hasPack, looksLikeBarcode, parseMoney, parseWhole, stockStatusOf, unitsPerReceived, unitWord, wholeUnits } from './inventoryMath'
import { addToLines, checkLine, newLine } from './restockLines'
import { item } from './inventoryTestData'

const softdrink = item('Softdrink', { unit: 'piece', purchaseUnit: 'pack', unitsPerPurchaseUnit: 24, costPrice: 15, currentStock: 6 })

describe('stock status', () => {
  it('is out at zero, low at or below the alert level, and never low without an alert level', () => {
    expect(stockStatusOf({ currentStock: 0, minStock: 5 })).toBe('out')
    expect(stockStatusOf({ currentStock: 5, minStock: 5 })).toBe('low')
    expect(stockStatusOf({ currentStock: 6, minStock: 5 })).toBe('ok')
    expect(stockStatusOf({ currentStock: 2, minStock: 0 })).toBe('ok')
  })
})

describe('pack conversion', () => {
  it('turns received packs into whole selling units, like the server', () => {
    expect(wholeUnits(1, 24)).toBe(24)
    expect(wholeUnits(0.5, 24)).toBe(12)
    expect(wholeUnits(0.1, 30)).toBe(3)
    for (const [quantity, per] of [[0, 24], [-1, 24], [1.5, 1], [0.01, 24], [Number.NaN, 1], [2_000_000, 1]] as const) expect(wholeUnits(quantity, per), `${quantity} x ${per}`).toBeNull()
  })

  it('knows whether a product has a pack and how many units a received unit holds', () => {
    expect(hasPack(softdrink)).toBe(true)
    expect(hasPack(item('Plain'))).toBe(false)
    expect(hasPack(item('Odd', { purchaseUnit: 'box', unitsPerPurchaseUnit: 1 }))).toBe(false)
    expect(unitsPerReceived(softdrink, 'purchase')).toBe(24)
    expect(unitsPerReceived(softdrink, 'base')).toBe(1)
    expect(unitsPerReceived(item('Plain'), 'purchase')).toBe(1)
  })
})

describe('reading typed numbers', () => {
  it('accepts whole numbers and amounts, and rejects everything else', () => {
    expect(parseWhole('12')).toBe(12)
    expect(parseWhole(' 0 ')).toBe(0)
    for (const bad of ['', '1.5', '-2', 'abc', '1e3', '12345678']) expect(parseWhole(bad), bad).toBeNull()
    expect(parseMoney('12.50')).toBe(12.5)
    expect(parseMoney('.5')).toBe(0.5)
    expect(parseMoney('0')).toBe(0)
    for (const bad of ['', '.', '-1', '1.2.3', 'x', '1e3', '999999999']) expect(parseMoney(bad), bad).toBeNull()
  })

  it('recognises scanned codes but not ordinary words', () => {
    for (const code of ['4801234567890', '012345678905', 'A12345', 'LM-001']) expect(looksLikeBarcode(code), code).toBe(true)
    for (const text of ['coke', 'lucky me', '12345', 'a b 123456', '']) expect(looksLikeBarcode(text), text).toBe(false)
  })

  it('pluralises unit names sensibly', () => {
    expect(unitWord('piece', 2)).toBe('pieces')
    expect(unitWord('piece', 1)).toBe('piece')
    expect(unitWord('pieces', 3)).toBe('pieces')
    expect(unitWord(undefined, 2)).toBe('pieces')
  })
})

describe('restock lines', () => {
  it('start in packs at the current cost for a product with a pack size, otherwise in pieces', () => {
    expect(newLine(softdrink)).toMatchObject({ unit: 'purchase', quantity: '1', unitCost: '360' })
    expect(newLine(item('Plain', { costPrice: 8.5 }))).toMatchObject({ unit: 'base', unitCost: '8.5' })
  })

  it('raise the quantity when the same product is added again', () => {
    const lines = addToLines(addToLines([], softdrink), softdrink, 2)
    expect(lines).toHaveLength(1)
    expect(lines[0]!.quantity).toBe('3')
  })

  it('say what a line will do, or what is wrong with it', () => {
    expect(checkLine(newLine(softdrink))).toMatchObject({ ok: true, added: 24, newStock: 30, paid: 360, costPerUnit: 15 })
    expect(checkLine({ ...newLine(softdrink), quantity: '2', unitCost: '100' })).toMatchObject({ ok: true, added: 48, paid: 200, costPerUnit: 4.1667 })
    expect(checkLine({ ...newLine(softdrink), quantity: '0' })).toMatchObject({ ok: false })
    expect(checkLine({ ...newLine(softdrink), quantity: '' })).toMatchObject({ ok: false })
    expect(checkLine({ ...newLine(item('Plain')), quantity: '1.5' })).toMatchObject({ ok: false, problem: expect.stringContaining('whole number') })
    expect(checkLine({ ...newLine(softdrink), unitCost: 'free' })).toMatchObject({ ok: false, problem: expect.stringContaining('price') })
  })
})
