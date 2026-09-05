import type { Request, Response } from 'express'
import mongoose from 'mongoose'

import type { AuthenticatedRequest } from '../middleware/authMiddleware.js'
import { InventoryTransactionModel } from '../models/InventoryTransaction.js'
import { ProductModel } from '../models/Product.js'
import { SaleModel } from '../models/Sale.js'

function currentStore(req: AuthenticatedRequest): mongoose.Types.ObjectId | null {
  return req.user?.id && mongoose.isValidObjectId(req.user.id) ? new mongoose.Types.ObjectId(req.user.id) : null
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

  const session = await mongoose.startSession()
  try {
    let result: { code: string; total: number; profit: number } | null = null
    await session.withTransaction(async () => {
      const ids = payload.items!.map((item) => item.productId).filter((id): id is string => Boolean(id) && mongoose.isValidObjectId(id))
      if (ids.length !== payload.items!.length) throw new Error('Cart contains an invalid product.')
      const products = await ProductModel.find({ _id: { $in: ids }, storeId, status: 'active' }).session(session)
      const byId = new Map(products.map((product) => [product.id, product]))
      const saleItems: Array<{ productId: mongoose.Types.ObjectId; productName: string; quantity: number; unitPrice: number; costPrice: number; lineTotal: number }> = []
      let total = 0
      let profit = 0

      for (const item of payload.items!) {
        const quantity = Number(item.quantity)
        const product = item.productId ? byId.get(item.productId) : undefined
        if (!product || !Number.isInteger(quantity) || quantity < 1) throw new Error('Cart contains an invalid quantity or product.')
        if (product.currentStock < quantity) throw new Error(`${product.name} has insufficient stock.`)
        const lineTotal = quantity * product.sellingPrice
        total += lineTotal
        profit += quantity * (product.sellingPrice - product.costPrice)
        const previousStock = product.currentStock
        product.currentStock -= quantity
        await product.save({ session })
        await InventoryTransactionModel.create([{ storeId, userId: storeId, productId: product._id, type: 'sale', quantity: -quantity, previousStock, newStock: product.currentStock }], { session })
        saleItems.push({ productId: product._id, productName: product.name, quantity, unitPrice: product.sellingPrice, costPrice: product.costPrice, lineTotal })
      }

      const code = `TXN${Date.now().toString().slice(-8)}`
      const sale: Record<string, unknown> = { storeId, cashierId: storeId, transactionCode: code, items: saleItems, subtotal: total, total, estimatedProfit: profit, paymentMethod: payload.paymentMethod ?? 'Cash' }
      if (payload.customerName) sale.customerName = payload.customerName
      await SaleModel.create([sale], { session })
      result = { code, total, profit }
    })
    res.status(201).json({ message: 'Checkout completed.', sale: result })
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : 'Checkout could not be completed.' })
  } finally {
    await session.endSession()
  }
}

export async function stockOut(req: AuthenticatedRequest, res: Response): Promise<void> {
  const storeId = currentStore(req)
  if (!storeId) { failSession(res); return }
  const payload = req.body as { productId?: string; quantity?: number; reason?: string; note?: string }
  if (!payload.productId || !mongoose.isValidObjectId(payload.productId) || !Number.isInteger(payload.quantity) || payload.quantity! < 1) { res.status(400).json({ message: 'Product and positive quantity are required.' }); return }
  const product = await ProductModel.findOne({ _id: payload.productId, storeId, status: 'active' })
  if (!product) { res.status(404).json({ message: 'Product not found.' }); return }
  if (product.currentStock < payload.quantity!) { res.status(400).json({ message: 'Insufficient stock.' }); return }
  const previousStock = product.currentStock
  product.currentStock -= payload.quantity!
  await product.save()
  const transaction: Record<string, unknown> = { storeId, userId: storeId, productId: product._id, type: 'stock_out', quantity: -payload.quantity!, previousStock, newStock: product.currentStock }
  if (payload.reason) transaction.reason = payload.reason
  if (payload.note) transaction.note = payload.note
  await InventoryTransactionModel.create(transaction)
  res.status(201).json({ message: 'Stock-out recorded.', product: { id: product.id, currentStock: product.currentStock } })
}

export async function stockIn(req: AuthenticatedRequest, res: Response): Promise<void> {
  const storeId = currentStore(req)
  if (!storeId) { failSession(res); return }
  const payload = req.body as { items?: Array<{ productId?: string; quantity?: number; unitCost?: number }>; note?: string }
  if (!payload.items?.length) { res.status(400).json({ message: 'At least one stock-in item is required.' }); return }
  for (const item of payload.items) {
    const quantity = item.quantity
    if (!item.productId || !mongoose.isValidObjectId(item.productId) || typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) { res.status(400).json({ message: 'Invalid stock-in item.' }); return }
    const product = await ProductModel.findOne({ _id: item.productId, storeId, status: 'active' })
    if (!product) { res.status(404).json({ message: 'Product not found.' }); return }
    const previousStock = product.currentStock
    product.currentStock += quantity
    if (item.unitCost !== undefined) product.costPrice = item.unitCost
    await product.save()
    const transaction: Record<string, unknown> = { storeId, userId: storeId, productId: product._id, type: 'stock_in', quantity, previousStock, newStock: product.currentStock }
    if (payload.note) transaction.note = payload.note
    await InventoryTransactionModel.create(transaction)
  }
  res.status(201).json({ message: 'Stock-in recorded.' })
}

export async function inventoryCount(req: AuthenticatedRequest, res: Response): Promise<void> {
  const storeId = currentStore(req)
  if (!storeId) { failSession(res); return }
  const payload = req.body as { counts?: Array<{ productId?: string; scannedQuantity?: number }>; note?: string }
  if (!payload.counts?.length) { res.status(400).json({ message: 'At least one counted product is required.' }); return }

  for (const count of payload.counts) {
    if (!count.productId || !mongoose.isValidObjectId(count.productId) || typeof count.scannedQuantity !== 'number' || !Number.isInteger(count.scannedQuantity) || count.scannedQuantity < 0) {
      res.status(400).json({ message: 'Invalid inventory count.' })
      return
    }
    const product = await ProductModel.findOne({ _id: count.productId, storeId, status: 'active' })
    if (!product) { res.status(404).json({ message: 'Product not found.' }); return }
    const previousStock = product.currentStock
    product.currentStock = count.scannedQuantity
    await product.save()
    const transaction: Record<string, unknown> = { storeId, userId: storeId, productId: product._id, type: 'inventory_count', quantity: count.scannedQuantity - previousStock, previousStock, newStock: product.currentStock }
    if (payload.note) transaction.note = payload.note
    await InventoryTransactionModel.create(transaction)
  }
  res.status(201).json({ message: 'Inventory count recorded.' })
}
