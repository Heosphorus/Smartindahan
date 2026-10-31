export const MAX_STOCK_CHANGE = 1_000_000
export const STOCK_OUT_REASONS = ['Damaged', 'Expired', 'Spoiled', 'Lost', 'Personal use', 'Other'] as const

export type StockStatus = 'out' | 'low' | 'ok'

/** Out of stock at zero; low at or below the product's own alert level (when it has one); otherwise fine. */
export function stockStatus(currentStock: number, minStock: number): StockStatus {
  if (currentStock <= 0) return 'out'
  return minStock > 0 && currentStock <= minStock ? 'low' : 'ok'
}

/** Escapes text so a search term is always matched literally, never as a pattern. */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The same product can be scanned as UPC-A (12 digits) or EAN-13 with a leading zero (13 digits).
 * Returns every spelling that identifies the same code, the scanned value first.
 */
export function barcodeVariants(raw: string): string[] {
  const value = raw.trim()
  const variants = [value]
  if (/^\d{12}$/.test(value)) variants.push(`0${value}`)
  else if (/^0\d{12}$/.test(value)) variants.push(value.slice(1))
  return variants
}

/**
 * Selling units added by receiving `quantity` of a unit that holds `unitsPer` selling units.
 * Returns null unless the result is a whole number from 1 to the stock-change limit, so a pack size and a quantity can never
 * produce a fraction of a unit. Tolerates floating-point noise such as 0.1 x 30.
 */
export function baseQuantity(quantity: unknown, unitsPer: number): number | null {
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) return null
  const product = quantity * unitsPer
  const rounded = Math.round(product)
  if (Math.abs(product - rounded) > 1e-6 || rounded < 1 || rounded > MAX_STOCK_CHANGE) return null
  return rounded
}

/** Costs are kept to four decimals so a pack price divided across its pieces is not rounded away to the centavo. */
export function roundCost(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000
}
