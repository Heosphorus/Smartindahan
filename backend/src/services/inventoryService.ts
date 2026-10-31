import mongoose, { type ClientSession } from 'mongoose'

import { InventoryTransactionModel } from '../models/InventoryTransaction.js'
import { ProductModel } from '../models/Product.js'

/** An expected failure that should reach the client as a plain message with this status. */
export class OperationError extends Error {
  constructor(message: string, readonly statusCode = 400) {
    super(message)
  }
}

export function isDuplicateKeyError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 11000)
}

export type StockChange = {
  storeId: mongoose.Types.ObjectId
  userId: mongoose.Types.ObjectId
  productId: mongoose.Types.ObjectId
  /** Signed change in selling units. */
  delta: number
  type: 'stock_in' | 'stock_out' | 'inventory_count' | 'adjustment'
  reason?: string | undefined
  note?: string | undefined
  unitCost?: number | undefined
  supplierId?: mongoose.Types.ObjectId | undefined
  purchaseId?: mongoose.Types.ObjectId | undefined
  countId?: mongoose.Types.ObjectId | undefined
  idempotencyKey?: string | undefined
  /** Fields to set on the product in the same update (for example a new cost). */
  set?: Record<string, unknown> | undefined
}

export type StockChangeResult = { name: string; unit: string; previousStock: number; newStock: number }

/**
 * Changes a product's stock with one atomic update and writes the matching stock movement; call it inside a transaction.
 * The quantity is added to whatever is in stock at that instant, so a sale or restock that committed a moment earlier is
 * never overwritten, and a removal larger than the stock on hand is refused instead of going negative.
 */
export async function changeStock(session: ClientSession, change: StockChange): Promise<StockChangeResult> {
  const { storeId, productId, delta } = change
  const filter = { _id: productId, storeId, status: 'active' as const, ...(delta < 0 ? { currentStock: { $gte: -delta } } : {}) }
  const update = { $inc: { currentStock: delta }, ...(change.set ? { $set: change.set } : {}) }
  const product = await ProductModel.findOneAndUpdate(filter, update, { returnDocument: 'after', session })
  if (!product) {
    const existing = await ProductModel.findOne({ _id: productId, storeId, status: 'active' }).select('name').session(session).lean()
    if (!existing) throw new OperationError('Product not found.', 404)
    throw new OperationError(`${existing.name} does not have enough stock for this change.`, 409)
  }
  const previousStock = product.currentStock - delta
  await InventoryTransactionModel.create([{
    storeId,
    userId: change.userId,
    productId,
    type: change.type,
    quantity: delta,
    previousStock,
    newStock: product.currentStock,
    ...(change.reason ? { reason: change.reason } : {}),
    ...(change.note ? { note: change.note } : {}),
    ...(change.unitCost !== undefined ? { unitCost: change.unitCost } : {}),
    ...(change.supplierId ? { supplierId: change.supplierId } : {}),
    ...(change.purchaseId ? { purchaseId: change.purchaseId } : {}),
    ...(change.countId ? { countId: change.countId } : {}),
    ...(change.idempotencyKey ? { idempotencyKey: change.idempotencyKey } : {}),
  }], { session })
  return { name: product.name, unit: product.unit, previousStock, newStock: product.currentStock }
}
