import type { Request, Response } from 'express'
import mongoose from 'mongoose'
import { randomUUID } from 'node:crypto'

import type { AuthenticatedRequest } from '../middleware/authMiddleware.js'
import { InventoryTransactionModel } from '../models/InventoryTransaction.js'
import { ProductModel } from '../models/Product.js'
import { SaleModel } from '../models/Sale.js'
import { recordAuditLog } from '../services/auditService.js'
import { parseObjectId } from '../utils/objectId.js'

class OperationError extends Error {
  constructor(message: string, readonly statusCode = 400) {
    super(message)
  }
}

function currentStore(req: AuthenticatedRequest): mongoose.Types.ObjectId | null {
  return parseObjectId(req.user?.storeId)
}

function failSession(res: Response): void { res.status(401).json({ message: 'Invalid session.' }) }

export async function lookupProduct(req: AuthenticatedRequest, res: Response): Promise<void> {
  const storeId = currentStore(req)
  if (!storeId) { failSession(res); return }
  const rawValue = String(req.body?.rawValue ?? '').trim()
  if (!rawValue) { res.status(400).json({ message: 'Barcode is required.' }); return }
  const product = await ProductModel.findOne({ storeId, $or: [{ barcode: rawValue }, { sku: rawValue }] }).lean()
  if (!product) { res.status(404).json({ found: false, message: 'Barcode not registered.' }); return }
  res.json({ found: true, product: { id: product._id, name: product.name, barcode: product.barcode, currentStock: product.currentStock, sellPrice: product.sellingPrice, costPrice: product.costPrice } })
}

export async function checkout(req: AuthenticatedRequest, res: Response): Promise<void> {
  const storeId = currentStore(req)
  if (!storeId) { failSession(res); return }
  const payload = req.body as { items?: Array<{ productId?: string; quantity?: number }>; paymentMethod?: string; customerName?: string }
  if (!payload.items?.length) { res.status(400).json({ message: 'Cart cannot be empty.' }); return }
  if (payload.paymentMethod !== undefined && !['Cash', 'Maya', 'GCash', 'Utang'].includes(payload.paymentMethod)) { res.status(400).json({ message: 'Unsupported payment method.' }); return }
  if (payload.customerName !== undefined && (typeof payload.customerName !== 'string' || payload.customerName.length > 160)) { res.status(400).json({ message: 'Customer name is invalid.' }); return }

  const session = await mongoose.startSession()
  try {
    let result: { code: string; total: number; profit: number } | null = null
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
        const lineTotal = validQuantity * product.sellingPrice
        total += lineTotal
        profit += validQuantity * (product.sellingPrice - product.costPrice)
        const previousStock = product.currentStock
        product.currentStock -= validQuantity
        await product.save({ session })
        await InventoryTransactionModel.create([{ storeId, userId: new mongoose.Types.ObjectId(req.user!.id), productId: product._id, type: 'sale', quantity: -validQuantity, previousStock, newStock: product.currentStock }], { session })
        saleItems.push({ productId: product._id, productName: product.name, quantity: validQuantity, unitPrice: product.sellingPrice, costPrice: product.costPrice, lineTotal })
      }

      const code = `TXN-${randomUUID()}`
      const sale: Record<string, unknown> = { storeId, cashierId: new mongoose.Types.ObjectId(req.user!.id), transactionCode: code, items: saleItems, subtotal: total, total, estimatedProfit: profit, paymentMethod: payload.paymentMethod ?? 'Cash' }
      if (payload.customerName) sale.customerName = payload.customerName
      const [createdSale] = await SaleModel.create([sale], { session })
      if (!createdSale) throw new OperationError('Checkout could not be completed.', 500)
      await recordAuditLog({ storeId, userId: new mongoose.Types.ObjectId(req.user!.id), event: 'SALE_CREATED', resourceType: 'Sale', resourceId: createdSale._id, metadata: { transactionCode: code, total } }, session)
      result = { code, total, profit }
    })
    res.status(201).json({ message: 'Checkout completed.', sale: result })
  } catch (error) {
    const expected = error instanceof OperationError
    res.status(expected ? error.statusCode : 500).json({ message: expected ? error.message : 'Checkout could not be completed.' })
  } finally {
    await session.endSession()
  }
}

export async function stockOut(req: AuthenticatedRequest, res: Response): Promise<void> {
  const storeId = currentStore(req)
  if (!storeId) { failSession(res); return }
  const payload = req.body as { productId?: string; quantity?: number; reason?: string; note?: string }
  const productId = parseObjectId(payload.productId)
  if (!productId || !Number.isInteger(payload.quantity) || payload.quantity! < 1) { res.status(400).json({ message: 'Product and positive quantity are required.' }); return }
  const session = await mongoose.startSession()
  let newStock = 0
  try {
    await session.withTransaction(async () => {
      const product = await ProductModel.findOne({ _id: productId, storeId, status: 'active' }).session(session)
      if (!product) throw new OperationError('Product not found.', 404)
      if (product.currentStock < payload.quantity!) throw new OperationError('Insufficient stock.', 409)
      const previousStock = product.currentStock
      product.currentStock -= payload.quantity!
      await product.save({ session })
      const transaction = { storeId, userId: new mongoose.Types.ObjectId(req.user!.id), productId: product._id, type: 'stock_out' as const, quantity: -payload.quantity!, previousStock, newStock: product.currentStock, ...(payload.reason ? { reason: payload.reason } : {}), ...(payload.note ? { note: payload.note } : {}) }
      await InventoryTransactionModel.create([transaction], { session })
      await recordAuditLog({ storeId, userId: new mongoose.Types.ObjectId(req.user!.id), event: 'INVENTORY_STOCK_OUT', resourceType: 'Product', resourceId: product._id, metadata: { quantity: payload.quantity!, previousStock, newStock: product.currentStock } }, session)
      newStock = product.currentStock
    })
  } catch (error) {
    res.status(error instanceof OperationError ? error.statusCode : 500).json({ message: error instanceof OperationError ? error.message : 'Stock-out could not be completed.' })
    return
  } finally {
    await session.endSession()
  }
  res.status(201).json({ message: 'Stock-out recorded.', product: { id: productId.toString(), currentStock: newStock } })
}

export async function stockIn(req: AuthenticatedRequest, res: Response): Promise<void> {
  const storeId = currentStore(req)
  if (!storeId) { failSession(res); return }
  const payload = req.body as { items?: Array<{ productId?: string; quantity?: number; unitCost?: number }>; note?: string }
  if (!payload.items?.length) { res.status(400).json({ message: 'At least one stock-in item is required.' }); return }
  for (const item of payload.items) {
    if (!parseObjectId(item.productId) || typeof item.quantity !== 'number' || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || (item.unitCost !== undefined && (typeof item.unitCost !== 'number' || !Number.isFinite(item.unitCost) || item.unitCost < 0))) {
      res.status(400).json({ message: 'Invalid stock-in item.' })
      return
    }
  }
  const session = await mongoose.startSession()
  try {
    await session.withTransaction(async () => {
      for (const item of payload.items!) {
        const productId = parseObjectId(item.productId)
        if (!productId) throw new OperationError('Invalid stock-in item.')
        const product = await ProductModel.findOne({ _id: productId, storeId, status: 'active' }).session(session)
        if (!product) throw new OperationError('Product not found.', 404)
        const previousStock = product.currentStock
        product.currentStock += item.quantity!
        if (item.unitCost !== undefined) product.costPrice = item.unitCost
        await product.save({ session })
        const transaction = { storeId, userId: new mongoose.Types.ObjectId(req.user!.id), productId: product._id, type: 'stock_in' as const, quantity: item.quantity!, previousStock, newStock: product.currentStock, ...(payload.note ? { note: payload.note } : {}) }
        await InventoryTransactionModel.create([transaction], { session })
        await recordAuditLog({ storeId, userId: new mongoose.Types.ObjectId(req.user!.id), event: 'INVENTORY_STOCK_IN', resourceType: 'Product', resourceId: product._id, metadata: { quantity: item.quantity!, previousStock, newStock: product.currentStock } }, session)
      }
    })
  } catch (error) {
    res.status(error instanceof OperationError ? error.statusCode : 500).json({ message: error instanceof OperationError ? error.message : 'Stock-in could not be completed.' })
    return
  } finally {
    await session.endSession()
  }
  res.status(201).json({ message: 'Stock-in recorded.' })
}

export async function inventoryCount(req: AuthenticatedRequest, res: Response): Promise<void> {
  const storeId = currentStore(req)
  if (!storeId) { failSession(res); return }
  const payload = req.body as { counts?: Array<{ productId?: string; scannedQuantity?: number }>; note?: string }
  if (!payload.counts?.length) { res.status(400).json({ message: 'At least one counted product is required.' }); return }

  for (const count of payload.counts) {
    if (!parseObjectId(count.productId) || typeof count.scannedQuantity !== 'number' || !Number.isInteger(count.scannedQuantity) || count.scannedQuantity < 0) {
      res.status(400).json({ message: 'Invalid inventory count.' })
      return
    }
  }
  const session = await mongoose.startSession()
  try {
    await session.withTransaction(async () => {
      for (const count of payload.counts!) {
        const productId = parseObjectId(count.productId)
        if (!productId) throw new OperationError('Invalid inventory count.')
        const product = await ProductModel.findOne({ _id: productId, storeId, status: 'active' }).session(session)
        if (!product) throw new OperationError('Product not found.', 404)
        const previousStock = product.currentStock
        product.currentStock = count.scannedQuantity!
        await product.save({ session })
        const transaction = { storeId, userId: new mongoose.Types.ObjectId(req.user!.id), productId: product._id, type: 'inventory_count' as const, quantity: count.scannedQuantity! - previousStock, previousStock, newStock: product.currentStock, ...(payload.note ? { note: payload.note } : {}) }
        await InventoryTransactionModel.create([transaction], { session })
        await recordAuditLog({ storeId, userId: new mongoose.Types.ObjectId(req.user!.id), event: 'INVENTORY_COUNT', resourceType: 'Product', resourceId: product._id, metadata: { countedStock: count.scannedQuantity!, previousStock } }, session)
      }
    })
  } catch (error) {
    res.status(error instanceof OperationError ? error.statusCode : 500).json({ message: error instanceof OperationError ? error.message : 'Inventory count could not be completed.' })
    return
  } finally {
    await session.endSession()
  }
  res.status(201).json({ message: 'Inventory count recorded.' })
}
