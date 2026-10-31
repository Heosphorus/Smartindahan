import type { ProductRecord } from '../../services/storeApi'
import { hasPack, parseMoney, productId, unitsPerReceived, wholeUnits } from './inventoryMath'

/** One product in a restocking session. Quantity and cost stay as text while the person is typing. */
export type RestockDraftLine = {
  product: ProductRecord
  quantity: string
  /** Received in the selling unit, or in the pack unit the product is bought in. */
  unit: 'base' | 'purchase'
  /** Price paid for one received unit (one pack, when receiving packs). */
  unitCost: string
}

const cents = (value: number) => String(Math.round((value + Number.EPSILON) * 100) / 100)

/** A new line for a product: packs by default when it has a pack size, and its current cost as the starting price. */
export function newLine(product: ProductRecord, quantity = 1): RestockDraftLine {
  const unit = hasPack(product) ? 'purchase' : 'base'
  return { product, quantity: String(quantity), unit, unitCost: cents(product.costPrice * unitsPerReceived(product, unit)) }
}

/** Adds a product, or raises the quantity when it is already in the session. */
export function addToLines(lines: RestockDraftLine[], product: ProductRecord, quantity = 1): RestockDraftLine[] {
  const id = productId(product)
  const existing = lines.find((line) => productId(line.product) === id)
  if (!existing) return [...lines, newLine(product, quantity)]
  return lines.map((line) => line === existing ? { ...line, quantity: String((Number(line.quantity) || 0) + quantity) } : line)
}

/** What a line would do, or why it cannot be sent yet. */
export type LineCheck = { ok: true; added: number; paid: number; costPerUnit: number; newStock: number; unitCost: number; quantity: number } | { ok: false; problem: string }

export function checkLine(line: RestockDraftLine): LineCheck {
  const quantity = Number(line.quantity)
  const unitCost = parseMoney(line.unitCost)
  const selling = line.product.unit || 'piece'
  if (!line.quantity.trim() || !Number.isFinite(quantity) || quantity <= 0) return { ok: false, problem: 'Enter a quantity greater than zero.' }
  const unitsPer = unitsPerReceived(line.product, line.unit)
  const added = wholeUnits(quantity, unitsPer)
  if (added === null) return { ok: false, problem: `This must make a whole number of ${selling} (up to 1,000,000).` }
  if (unitCost === null) return { ok: false, problem: 'Enter the price you paid, such as 360 or 12.50.' }
  return { ok: true, added, paid: Math.round((quantity * unitCost + Number.EPSILON) * 100) / 100, costPerUnit: Math.round((unitCost / unitsPer + Number.EPSILON) * 10000) / 10000, newStock: line.product.currentStock + added, unitCost, quantity }
}
