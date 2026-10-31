import type { StockStatus } from '../../services/inventoryApi'
import type { ProductRecord } from '../../services/storeApi'

export const STOCK_OUT_REASONS = ['Damaged', 'Expired', 'Spoiled', 'Lost', 'Personal use', 'Other'] as const
export const COUNT_REASONS = ['Miscount', 'Damaged', 'Expired', 'Lost', 'Found', 'Other'] as const
export const UNIT_SUGGESTIONS = ['piece', 'pack', 'bottle', 'can', 'sachet', 'box', 'dozen', 'kilogram', 'gram', 'liter', 'milliliter']

const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })
export const formatPeso = (value: number) => peso.format(value)

export const productId = (product: ProductRecord) => product._id ?? product.id ?? ''

/** Out of stock at zero; low at or below the product's own alert level (when it has one); otherwise fine. Matches the server. */
export function stockStatusOf(product: Pick<ProductRecord, 'currentStock' | 'minStock'>): StockStatus {
  if (product.currentStock <= 0) return 'out'
  return product.minStock > 0 && product.currentStock <= product.minStock ? 'low' : 'ok'
}

export const STATUS_LABEL: Record<StockStatus, string> = { out: 'Out of stock', low: 'Low stock', ok: 'In stock' }

/** The selling units in one received unit: the pack size when receiving packs, otherwise 1. */
export const unitsPerReceived = (product: ProductRecord, unit: 'base' | 'purchase') => unit === 'purchase' && product.unitsPerPurchaseUnit ? product.unitsPerPurchaseUnit : 1

export const hasPack = (product: ProductRecord) => Boolean(product.purchaseUnit && product.unitsPerPurchaseUnit && product.unitsPerPurchaseUnit >= 2)

/** Whole selling units from a received quantity, or null when it would not be a whole number from 1 to 1,000,000. Matches the server. */
export function wholeUnits(quantity: number, unitsPer: number): number | null {
  if (!Number.isFinite(quantity) || quantity <= 0) return null
  const total = quantity * unitsPer
  const rounded = Math.round(total)
  return Math.abs(total - rounded) > 1e-6 || rounded < 1 || rounded > 1_000_000 ? null : rounded
}

/** Reads a whole number of zero or more from text, or null. */
export function parseWhole(text: string): number | null {
  const trimmed = text.trim()
  if (!/^\d{1,7}$/.test(trimmed)) return null
  return Number(trimmed)
}

/** Reads a money amount of zero or more from text, or null. */
export function parseMoney(text: string): number | null {
  const trimmed = text.trim()
  if (!trimmed || !/^\d*\.?\d*$/.test(trimmed) || trimmed === '.') return null
  const value = Number(trimmed)
  return Number.isFinite(value) && value >= 0 && value <= 100_000_000 ? value : null
}

/** Text that looks like a scanned code: no spaces, six or more characters, at least one digit. A USB scanner types these and presses Enter. */
export function looksLikeBarcode(text: string): boolean {
  return /^[0-9A-Za-z._-]{6,64}$/.test(text) && /\d/.test(text)
}

export const unitWord = (unit: string | undefined, count: number) => {
  const name = unit?.trim() || 'piece'
  return count === 1 || /[^a-z]/i.test(name.slice(-1)) || name.toLowerCase().endsWith('s') ? name : `${name}s`
}

export const plural = (count: number, singular: string, pluralForm = `${singular}s`) => `${count.toLocaleString('en-PH')} ${count === 1 ? singular : pluralForm}`

/** The product to show for a scan result row: prefer the barcode (so the list matches exactly), else the name. */
export const searchTextFor = (product: ProductRecord) => product.barcode ?? product.name

export const MOVEMENT_LABEL: Record<string, string> = { sale: 'Sold', stock_in: 'Stock added', stock_out: 'Stock removed', inventory_count: 'Count adjustment', adjustment: 'Adjustment' }
