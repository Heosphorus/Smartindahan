import type { Request, Response } from 'express'
import mongoose from 'mongoose'
import { randomUUID } from 'node:crypto'

import type { AuthenticatedRequest } from '../middleware/authMiddleware.js'
import { InventoryTransactionModel } from '../models/InventoryTransaction.js'
import { ProductModel } from '../models/Product.js'
import { SaleModel } from '../models/Sale.js'
import { recordAuditLog } from '../services/auditService.js'
import { changeStock, isDuplicateKeyError, OperationError } from '../services/inventoryService.js'
import { barcodeVariants, MAX_STOCK_CHANGE, STOCK_OUT_REASONS } from '../utils/inventory.js'
import { parseObjectId } from '../utils/objectId.js'
import { cleanText, isIdempotencyKey, isMoney, roundMoney } from '../utils/validation.js'

function currentStore(req: AuthenticatedRequest): mongoose.Types.ObjectId | null {
  return parseObjectId(req.user?.storeId)
}

function failSession(res: Response): void { res.status(401).json({ message: 'Invalid session.' }) }

export async function lookupProduct(req: AuthenticatedRequest, res: Response): Promise<void> {
  const storeId = currentStore(req)
  if (!storeId) { failSession(res); return }
  const rawValue = typeof req.body?.rawValue === 'string' ? req.body.rawValue.trim() : ''
  if (!rawValue || rawValue.length > 64) { res.status(400).json({ message: 'Barcode is required (64 characters or fewer).' }); return }
  // The barcode is matched within this store's catalog only. Nothing is fetched from outside; an unknown code is simply unknown.
  const variants = barcodeVariants(rawValue)
  const matches = await ProductModel.find({ storeId, $or: [{ barcode: { $in: variants } }, { sku: rawValue }] }).lean()
  const active = matches.find((candidate) => candidate.status === 'active' && variants.includes(candidate.barcode ?? '')) ?? matches.find((candidate) => candidate.status === 'active')
  if (!active) {
    const archived = matches[0]
    res.status(404).json({ found: false, barcode: rawValue, ...(archived ? { archived: { id: archived._id, name: archived.name } } : {}), message: archived ? `"${archived.name}" uses this barcode but was archived.` : 'Barcode not registered.' })
    return
  }
  const product = active
  // `sellPrice` is the documented contract name; `sellingPrice` matches the product records the POS screen uses.
  res.json({ found: true, product: { id: product._id, _id: product._id, name: product.name, barcode: product.barcode, sku: product.sku, brand: product.brand, category: product.category, unit: product.unit, purchaseUnit: product.purchaseUnit, unitsPerPurchaseUnit: product.unitsPerPurchaseUnit, minStock: product.minStock, currentStock: product.currentStock, sellPrice: product.sellingPrice, sellingPrice: product.sellingPrice, costPrice: product.costPrice } })
}

type CheckoutResult = { code: string; total: number; profit: number }

async function findSaleByIdempotencyKey(storeId: mongoose.Types.ObjectId, key: string): Promise<CheckoutResult | null> {
  const existing = await SaleModel.findOne({ storeId, idempotencyKey: key }).lean()
  return existing ? { code: existing.transactionCode, total: existing.total, profit: existing.estimatedProfit } : null
}

export async function checkout(req: AuthenticatedRequest, res: Response): Promise<void> {
  const storeId = currentStore(req)
  if (!storeId) { failSession(res); return }
  const payload = (req.body ?? {}) as { items?: Array<{ productId?: string; quantity?: number }>; paymentMethod?: string; customerName?: string; idempotencyKey?: unknown }
  if (!Array.isArray(payload.items) || !payload.items.length || payload.items.length > 200) { res.status(400).json({ message: 'Cart cannot be empty.' }); return }
  if (payload.paymentMethod === 'Utang') { res.status(400).json({ message: 'Credit (utang) sales are not supported yet.' }); return }
  if (payload.paymentMethod !== undefined && !['Cash', 'Maya', 'GCash'].includes(payload.paymentMethod)) { res.status(400).json({ message: 'Unsupported payment method.' }); return }
  if (payload.customerName !== undefined && (typeof payload.customerName !== 'string' || payload.customerName.length > 160)) { res.status(400).json({ message: 'Customer name is invalid.' }); return }
  if (payload.idempotencyKey !== undefined && !isIdempotencyKey(payload.idempotencyKey)) { res.status(400).json({ message: 'Idempotency key is invalid.' }); return }
  const idempotencyKey = payload.idempotencyKey

  if (idempotencyKey) {
    const replay = await findSaleByIdempotencyKey(storeId, idempotencyKey)
    if (replay) { res.status(200).json({ message: 'Checkout already completed.', sale: replay }); return }
  }

  const session = await mongoose.startSession()
  try {
    let result: CheckoutResult | null = null
    await session.withTransaction(async () => {
      const parsedIds = payload.items!.map((item) => parseObjectId(item.productId))
      if (parsedIds.some((id) => !id)) throw new OperationError('Cart contains an invalid product.')
      const ids = parsedIds.filter((id): id is mongoose.Types.ObjectId => id !== null)
      const products = await ProductModel.find({ _id: { $in: ids }, storeId, status: 'active' }).session(session)
      const byId = new Map(products.map((product) => [product._id.toString(), product]))
      const saleItems: Array<{ productId: mongoose.Types.ObjectId; productName: string; quantity: number; unitPrice: number; costPrice: number; lineTotal: number }> = []
      let total = 0
      let profit = 0

      for (const item of payload.items!) {
        const quantity = item.quantity
        const productId = parseObjectId(item.productId)
        const product = productId ? byId.get(productId.toString()) : undefined
        if (!product || !Number.isSafeInteger(quantity) || quantity! < 1) throw new OperationError('Cart contains an invalid quantity or product.')
        const validQuantity = quantity!
        if (product.currentStock < validQuantity) throw new OperationError(`${product.name} has insufficient stock.`, 409)
        const lineTotal = roundMoney(validQuantity * product.sellingPrice)
        total = roundMoney(total + lineTotal)
        // Profit uses the cost recorded on the product at the moment of sale and is frozen on the sale item.
        profit = roundMoney(profit + validQuantity * (product.sellingPrice - product.costPrice))
        const previousStock = product.currentStock
        product.currentStock -= validQuantity
        await product.save({ session })
        await InventoryTransactionModel.create([{ storeId, userId: new mongoose.Types.ObjectId(req.user!.id), productId: product._id, type: 'sale', quantity: -validQuantity, previousStock, newStock: product.currentStock }], { session })
        saleItems.push({ productId: product._id, productName: product.name, quantity: validQuantity, unitPrice: product.sellingPrice, costPrice: product.costPrice, lineTotal })
      }

      const code = `TXN-${randomUUID()}`
      const sale: Record<string, unknown> = { storeId, cashierId: new mongoose.Types.ObjectId(req.user!.id), transactionCode: code, items: saleItems, subtotal: total, total, estimatedProfit: profit, paymentMethod: payload.paymentMethod ?? 'Cash' }
      if (payload.customerName) sale.customerName = payload.customerName
      if (idempotencyKey) sale.idempotencyKey = idempotencyKey
      const [createdSale] = await SaleModel.create([sale], { session })
      if (!createdSale) throw new OperationError('Checkout could not be completed.', 500)
      await recordAuditLog({ storeId, userId: new mongoose.Types.ObjectId(req.user!.id), event: 'SALE_CREATED', resourceType: 'Sale', resourceId: createdSale._id, metadata: { transactionCode: code, total } }, session)
      result = { code, total, profit }
    })
    res.status(201).json({ message: 'Checkout completed.', sale: result })
  } catch (error) {
    // A concurrent request with the same key won the race; its transaction committed, ours rolled back.
    if (idempotencyKey && isDuplicateKeyError(error)) {
      const replay = await findSaleByIdempotencyKey(storeId, idempotencyKey)
      if (replay) { res.status(200).json({ message: 'Checkout already completed.', sale: replay }); return }
    }
    const expected = error instanceof OperationError
    res.status(expected ? error.statusCode : 500).json({ message: expected ? error.message : 'Checkout could not be completed.' })
  } finally {
    await session.endSession()
  }
}

/** Maps an expected failure to its status and message; anything else is logged without detail and reported generically. */
function sendFailure(res: Response, error: unknown, fallback: string): void {
  if (error instanceof OperationError) { res.status(error.statusCode).json({ message: error.message }); return }
  console.error(`${fallback} (${error instanceof Error ? error.name : 'UnknownError'})`)
  res.status(500).json({ message: fallback })
}

function optionalKey(raw: unknown): string | undefined | null {
  if (raw === undefined) return undefined
  return isIdempotencyKey(raw) ? raw : null
}

/** Removes stock for a reason (damaged, expired, ...). A repeated request with the same key is recognised and not applied twice. */
export async function stockOut(req: AuthenticatedRequest, res: Response): Promise<void> {
  const storeId = currentStore(req)
  if (!storeId) { failSession(res); return }
  const payload = (req.body ?? {}) as { productId?: unknown; quantity?: unknown; reason?: unknown; note?: unknown; idempotencyKey?: unknown }
  const productId = parseObjectId(payload.productId)
  const quantity = payload.quantity
  if (!productId || typeof quantity !== 'number' || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_STOCK_CHANGE) { res.status(400).json({ message: 'Product and positive quantity are required.' }); return }
  if (payload.reason !== undefined && (typeof payload.reason !== 'string' || !(STOCK_OUT_REASONS as readonly string[]).includes(payload.reason))) { res.status(400).json({ message: `Reason must be one of: ${STOCK_OUT_REASONS.join(', ')}.` }); return }
  if (payload.note !== undefined && payload.note !== '' && cleanText(payload.note, 200) === null) { res.status(400).json({ message: 'Note must be 200 characters or fewer.' }); return }
  const idempotencyKey = optionalKey(payload.idempotencyKey)
  if (idempotencyKey === null) { res.status(400).json({ message: 'Idempotency key is invalid.' }); return }
  const userId = new mongoose.Types.ObjectId(req.user!.id)
  const note = cleanText(payload.note, 200) ?? undefined

  if (idempotencyKey) {
    const earlier = await InventoryTransactionModel.findOne({ storeId, idempotencyKey, productId }).lean()
    if (earlier) { res.status(200).json({ message: 'Stock-out was already recorded.', product: { id: productId.toString(), currentStock: earlier.newStock } }); return }
  }
  const session = await mongoose.startSession()
  let newStock = 0
  try {
    await session.withTransaction(async () => {
      const result = await changeStock(session, { storeId, userId, productId, delta: -quantity, type: 'stock_out', reason: payload.reason as string | undefined, note, idempotencyKey })
      await recordAuditLog({ storeId, userId, event: 'INVENTORY_STOCK_OUT', resourceType: 'Product', resourceId: productId, metadata: { quantity, previousStock: result.previousStock, newStock: result.newStock, ...(typeof payload.reason === 'string' ? { reason: payload.reason } : {}) } }, session)
      newStock = result.newStock
    })
  } catch (error) {
    if (idempotencyKey && isDuplicateKeyError(error)) {
      const earlier = await InventoryTransactionModel.findOne({ storeId, idempotencyKey, productId }).lean()
      if (earlier) { res.status(200).json({ message: 'Stock-out was already recorded.', product: { id: productId.toString(), currentStock: earlier.newStock } }); return }
    }
    sendFailure(res, error, 'Stock-out could not be completed.')
    return
  } finally {
    await session.endSession()
  }
  res.status(201).json({ message: 'Stock-out recorded.', product: { id: productId.toString(), currentStock: newStock } })
}

/** Adds stock without a purchase record (a quick top-up). Receiving a supplier delivery goes through restock instead. */
export async function stockIn(req: AuthenticatedRequest, res: Response): Promise<void> {
  const storeId = currentStore(req)
  if (!storeId) { failSession(res); return }
  const payload = (req.body ?? {}) as { items?: Array<{ productId?: unknown; quantity?: unknown; unitCost?: unknown }>; note?: unknown; idempotencyKey?: unknown }
  if (!Array.isArray(payload.items) || !payload.items.length || payload.items.length > 100) { res.status(400).json({ message: 'At least one stock-in item is required.' }); return }
  const items: Array<{ productId: mongoose.Types.ObjectId; quantity: number; unitCost?: number }> = []
  for (const item of payload.items) {
    const productId = parseObjectId(item?.productId)
    const quantity = item?.quantity
    if (!productId || typeof quantity !== 'number' || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_STOCK_CHANGE || (item.unitCost !== undefined && !isMoney(item.unitCost))) {
      res.status(400).json({ message: 'Invalid stock-in item.' })
      return
    }
    items.push({ productId, quantity, ...(item.unitCost !== undefined ? { unitCost: item.unitCost as number } : {}) })
  }
  if (new Set(items.map((item) => item.productId.toHexString())).size !== items.length) { res.status(400).json({ message: 'List each product once.' }); return }
  if (payload.note !== undefined && payload.note !== '' && cleanText(payload.note, 200) === null) { res.status(400).json({ message: 'Note must be 200 characters or fewer.' }); return }
  const idempotencyKey = optionalKey(payload.idempotencyKey)
  if (idempotencyKey === null) { res.status(400).json({ message: 'Idempotency key is invalid.' }); return }
  const userId = new mongoose.Types.ObjectId(req.user!.id)
  const note = cleanText(payload.note, 200) ?? undefined

  if (idempotencyKey && await InventoryTransactionModel.exists({ storeId, idempotencyKey })) { res.status(200).json({ message: 'Stock-in was already recorded.' }); return }
  const session = await mongoose.startSession()
  try {
    await session.withTransaction(async () => {
      for (const item of items) {
        const result = await changeStock(session, { storeId, userId, productId: item.productId, delta: item.quantity, type: 'stock_in', note, unitCost: item.unitCost, idempotencyKey, set: item.unitCost !== undefined ? { costPrice: item.unitCost } : undefined })
        await recordAuditLog({ storeId, userId, event: 'INVENTORY_STOCK_IN', resourceType: 'Product', resourceId: item.productId, metadata: { quantity: item.quantity, previousStock: result.previousStock, newStock: result.newStock } }, session)
      }
    })
  } catch (error) {
    if (idempotencyKey && isDuplicateKeyError(error) && await InventoryTransactionModel.exists({ storeId, idempotencyKey })) { res.status(200).json({ message: 'Stock-in was already recorded.' }); return }
    sendFailure(res, error, 'Stock-in could not be completed.')
    return
  } finally {
    await session.endSession()
  }
  res.status(201).json({ message: 'Stock-in recorded.' })
}

/**
 * Records a counted quantity for single products (for example from the product form). The change is the difference between what
 * was counted and what the person saw (`expectedQuantity`), added to the stock at that instant, so a sale made in between is kept.
 * Without `expectedQuantity` the stock at the moment of the request is used. Every change is written to the stock history.
 * Counting many products with a review step is done through inventory counts instead.
 */
export async function inventoryCount(req: AuthenticatedRequest, res: Response): Promise<void> {
  const storeId = currentStore(req)
  if (!storeId) { failSession(res); return }
  const payload = (req.body ?? {}) as { counts?: Array<{ productId?: unknown; scannedQuantity?: unknown; expectedQuantity?: unknown }>; note?: unknown }
  if (!Array.isArray(payload.counts) || !payload.counts.length || payload.counts.length > 100) { res.status(400).json({ message: 'At least one counted product is required.' }); return }
  const counts: Array<{ productId: mongoose.Types.ObjectId; counted: number; expected?: number }> = []
  for (const count of payload.counts) {
    const productId = parseObjectId(count?.productId)
    const counted = count?.scannedQuantity
    const expected = count?.expectedQuantity
    if (!productId || typeof counted !== 'number' || !Number.isSafeInteger(counted) || counted < 0 || counted > MAX_STOCK_CHANGE || (expected !== undefined && (typeof expected !== 'number' || !Number.isSafeInteger(expected) || expected < 0 || expected > MAX_STOCK_CHANGE))) {
      res.status(400).json({ message: 'Invalid inventory count.' })
      return
    }
    counts.push({ productId, counted, ...(expected !== undefined ? { expected: expected as number } : {}) })
  }
  if (new Set(counts.map((count) => count.productId.toHexString())).size !== counts.length) { res.status(400).json({ message: 'List each product once.' }); return }
  if (payload.note !== undefined && payload.note !== '' && cleanText(payload.note, 200) === null) { res.status(400).json({ message: 'Note must be 200 characters or fewer.' }); return }
  const userId = new mongoose.Types.ObjectId(req.user!.id)
  const note = cleanText(payload.note, 200) ?? undefined

  const session = await mongoose.startSession()
  try {
    await session.withTransaction(async () => {
      for (const count of counts) {
        const product = await ProductModel.findOne({ _id: count.productId, storeId, status: 'active' }).select('currentStock').session(session).lean()
        if (!product) throw new OperationError('Product not found.', 404)
        const delta = count.counted - (count.expected ?? product.currentStock)
        if (delta === 0) continue
        const result = await changeStock(session, { storeId, userId, productId: count.productId, delta, type: 'inventory_count', note })
        await recordAuditLog({ storeId, userId, event: 'INVENTORY_COUNT', resourceType: 'Product', resourceId: count.productId, metadata: { countedStock: count.counted, previousStock: result.previousStock, newStock: result.newStock } }, session)
      }
    })
  } catch (error) {
    sendFailure(res, error, 'Inventory count could not be completed.')
    return
  } finally {
    await session.endSession()
  }
  res.status(201).json({ message: 'Inventory count recorded.' })
}
