import type { Response } from 'express'
import mongoose from 'mongoose'

import type { AuthenticatedRequest } from '../middleware/authMiddleware.js'
import { InventoryTransactionModel } from '../models/InventoryTransaction.js'
import { CustomerModel } from '../models/Customer.js'
import { ProductModel } from '../models/Product.js'
import { SaleModel } from '../models/Sale.js'
import { UserModel } from '../models/User.js'
import { recordAuditLog } from '../services/auditService.js'
import { parsePagination } from '../utils/pagination.js'
import { parseObjectId } from '../utils/objectId.js'
import { pickRequestFields } from '../utils/requestFields.js'

function storeIdFromRequest(req: AuthenticatedRequest): mongoose.Types.ObjectId | null {
  return parseObjectId(req.user?.storeId)
}

export async function getDashboardSummary(req: AuthenticatedRequest, res: Response): Promise<void> {
  const storeId = storeIdFromRequest(req)
  if (!storeId) {
    res.status(401).json({ message: 'Invalid session.' })
    return
  }

  const requestedPeriod = req.query.period
  if (requestedPeriod !== undefined && requestedPeriod !== 'weekly' && requestedPeriod !== 'monthly') {
    res.status(400).json({ message: 'Sales overview period must be weekly or monthly.' })
    return
  }
  const salesOverviewPeriod = requestedPeriod === 'monthly' ? 'monthly' : 'weekly'
  const now = new Date()
  const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const startOfSalesOverview = salesOverviewPeriod === 'monthly'
    ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    : new Date(startOfToday)
  if (salesOverviewPeriod === 'weekly') {
    const daysSinceMonday = (startOfSalesOverview.getUTCDay() + 6) % 7
    startOfSalesOverview.setUTCDate(startOfSalesOverview.getUTCDate() - daysSinceMonday)
  }
  const salesOverviewDays = salesOverviewPeriod === 'weekly'
    ? 5
    : Math.floor((startOfToday.getTime() - startOfSalesOverview.getTime()) / 86400000) + 1

  const [today, overviewSales, topSelling, lowStock, recentTransactions, inventoryValue, customerTotals, user] = await Promise.all([
    SaleModel.aggregate([
      { $match: { storeId, createdAt: { $gte: startOfToday } } },
      { $group: { _id: null, sales: { $sum: '$total' }, profit: { $sum: '$estimatedProfit' }, transactions: { $sum: 1 } } },
    ]),
    SaleModel.aggregate([
      { $match: { storeId, createdAt: { $gte: startOfSalesOverview } } },
      { $unwind: '$items' },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, sales: { $sum: '$items.lineTotal' } } },
      { $sort: { _id: 1 } },
    ]),
    SaleModel.aggregate([
      { $match: { storeId } },
      { $unwind: '$items' },
      { $group: { _id: '$items.productId', name: { $first: '$items.productName' }, sold: { $sum: '$items.quantity' } } },
      { $sort: { sold: -1 } },
      { $limit: 5 },
    ]),
    ProductModel.find({ storeId, status: 'active', $expr: { $lte: ['$currentStock', '$minStock'] } }).sort({ currentStock: 1 }).limit(10).lean(),
    SaleModel.find({ storeId }).sort({ createdAt: -1 }).limit(5).lean(),
    ProductModel.aggregate([{ $match: { storeId, status: 'active' } }, { $group: { _id: null, value: { $sum: { $multiply: ['$currentStock', '$costPrice'] } } } }]),
    CustomerModel.aggregate([{ $match: { storeId, isDeleted: { $ne: true } } }, { $group: { _id: null, outstanding: { $sum: '$outstandingBalance' } } }]),
    UserModel.findById(storeId).select('storeName').lean(),
  ])

  const dayMap = new Map<string, number>(overviewSales.map((entry) => [entry._id as string, entry.sales as number]))
  const salesOverview = Array.from({ length: salesOverviewDays }, (_, index) => {
    const date = new Date(startOfSalesOverview)
    date.setUTCDate(startOfSalesOverview.getUTCDate() + index)
    const key = date.toISOString().slice(0, 10)
    return { date: key, sales: dayMap.get(key) ?? 0 }
  })

  res.json({
    store: { id: storeId.toString(), name: user?.storeName ?? 'Your Store' },
    kpis: {
      todaysSales: today[0]?.sales ?? 0,
      estimatedProfit: today[0]?.profit ?? 0,
      transactions: today[0]?.transactions ?? 0,
      outstandingUtang: customerTotals[0]?.outstanding ?? 0,
      inventoryValue: inventoryValue[0]?.value ?? 0,
    },
    salesOverviewPeriod,
    salesOverview,
    topSelling: topSelling.map((entry, index) => ({ rank: index + 1, name: entry.name, sold: entry.sold })),
    lowStock: lowStock.map((product) => ({ id: product._id.toString(), name: product.name, currentStock: product.currentStock, minStock: product.minStock })),
    recentTransactions: recentTransactions.map((sale) => ({ id: sale.transactionCode, amount: sale.total, paymentMethod: sale.paymentMethod, createdAt: sale.createdAt })),
  })
}

export async function getProducts(req: AuthenticatedRequest, res: Response): Promise<void> {
  const storeId = storeIdFromRequest(req)
  if (!storeId) { res.status(401).json({ message: 'Invalid session.' }); return }
  const pagination = parsePagination(req.query as Record<string, unknown>)
  if (!pagination) { res.status(400).json({ message: 'Invalid page or limit.' }); return }
  const filter = { storeId, status: 'active' as const }
  const [products, total] = await Promise.all([
    ProductModel.find(filter).sort({ name: 1, _id: 1 }).skip(pagination.skip).limit(pagination.limit).lean(),
    ProductModel.countDocuments(filter),
  ])
  res.json({ products, pagination: { page: pagination.page, limit: pagination.limit, total } })
}

export async function createProduct(req: AuthenticatedRequest, res: Response): Promise<void> {
  const storeId = storeIdFromRequest(req)
  if (!storeId) { res.status(401).json({ message: 'Invalid session.' }); return }
  const payload = req.body as { name?: string; barcode?: string; sku?: string; category?: string; brand?: string; supplier?: string; costPrice?: number; sellingPrice?: number; initialStock?: number; minStock?: number; unit?: string }
  if (!payload.name?.trim() || !payload.category?.trim() || typeof payload.costPrice !== 'number' || typeof payload.sellingPrice !== 'number') {
    res.status(400).json({ message: 'Name, category, prices, and initial stock are required.' })
    return
  }
  const productData: Record<string, unknown> = {
    storeId,
    name: payload.name.trim(),
    category: payload.category.trim(),
    costPrice: payload.costPrice,
    sellingPrice: payload.sellingPrice,
    currentStock: payload.initialStock ?? 0,
    minStock: payload.minStock ?? 0,
    unit: payload.unit ?? 'piece',
  }
  if (payload.barcode?.trim()) productData.barcode = payload.barcode.trim()
  if (payload.sku?.trim()) productData.sku = payload.sku.trim()
  if (payload.brand?.trim()) productData.brand = payload.brand.trim()
  if (payload.supplier?.trim()) productData.supplier = payload.supplier.trim()
  const session = await mongoose.startSession()
  let product: Awaited<ReturnType<typeof ProductModel.create>>[number] | undefined
  try {
    await session.withTransaction(async () => {
      const [createdProduct] = await ProductModel.create([productData], { session })
      if (!createdProduct) throw new Error('Product creation returned no document.')
      product = createdProduct
      await recordAuditLog({ storeId, userId: new mongoose.Types.ObjectId(req.user!.id), event: 'PRODUCT_CREATED', resourceType: 'Product', resourceId: createdProduct._id }, session)
      if (createdProduct.currentStock > 0) {
        const initialStock = {
          storeId,
          userId: new mongoose.Types.ObjectId(req.user!.id),
          productId: createdProduct._id,
          type: 'stock_in' as const,
          quantity: createdProduct.currentStock,
          previousStock: 0,
          newStock: createdProduct.currentStock,
          reason: 'Initial product stock',
        }
        await InventoryTransactionModel.create([initialStock], { session })
      }
    })
  } catch (error) {
    const duplicate = error && typeof error === 'object' && 'code' in error && error.code === 11000
    res.status(duplicate ? 409 : 500).json({ message: duplicate ? 'A product with this barcode already exists.' : 'Product could not be created.' })
    return
  } finally {
    await session.endSession()
  }
  if (!product) { res.status(500).json({ message: 'Product could not be created.' }); return }
  res.status(201).json({ product })
}

export async function bulkCreateProducts(req: AuthenticatedRequest, res: Response): Promise<void> {
  const storeId = storeIdFromRequest(req)
  if (!storeId) { res.status(401).json({ message: 'Invalid session.' }); return }
  const payload = req.body as { names?: string[]; category?: string; unit?: string }
  const names = Array.from(new Set((payload.names ?? []).map((name) => name.trim()).filter(Boolean)))
  if (!names.length || !payload.category?.trim()) { res.status(400).json({ message: 'Product names and category are required.' }); return }
  const products = await ProductModel.insertMany(names.map((name) => ({ storeId, name, category: payload.category!.trim(), costPrice: 0, sellingPrice: 0, currentStock: 0, minStock: 0, unit: payload.unit?.trim() || 'piece' })))
  res.status(201).json({ message: `${products.length} products added.`, products })
}

export async function updateProduct(req: AuthenticatedRequest, res: Response): Promise<void> {
  const storeId = storeIdFromRequest(req)
  if (!storeId) { res.status(401).json({ message: 'Invalid session.' }); return }
  const productId = parseObjectId(req.params.id)
  if (!productId) { res.status(404).json({ message: 'Product not found.' }); return }
  const updates = pickRequestFields(['name', 'barcode', 'sku', 'category', 'brand', 'supplier', 'costPrice', 'sellingPrice', 'minStock', 'unit'], req.body)
  if (!Object.keys(updates).length) { res.status(400).json({ message: 'No editable product fields were provided.' }); return }
  const product = await ProductModel.findOneAndUpdate({ _id: productId, storeId }, { $set: updates }, { new: true, runValidators: true }).lean()
  if (!product) { res.status(404).json({ message: 'Product not found.' }); return }
  await recordAuditLog({ storeId, userId: new mongoose.Types.ObjectId(req.user!.id), event: 'PRODUCT_UPDATED', resourceType: 'Product', resourceId: product._id })
  res.json({ product })
}

export async function deleteProduct(req: AuthenticatedRequest, res: Response): Promise<void> {
  const storeId = storeIdFromRequest(req)
  if (!storeId) { res.status(401).json({ message: 'Invalid session.' }); return }
  const productId = parseObjectId(req.params.id)
  if (!productId) { res.status(404).json({ message: 'Product not found.' }); return }
  const product = await ProductModel.findOneAndUpdate({ _id: productId, storeId, status: 'active' }, { $set: { status: 'archived' } }, { new: true, runValidators: true }).lean()
  if (!product) { res.status(404).json({ message: 'Product not found.' }); return }
  await recordAuditLog({ storeId, userId: new mongoose.Types.ObjectId(req.user!.id), event: 'PRODUCT_ARCHIVED', resourceType: 'Product', resourceId: product._id })
  res.json({ message: 'Product archived from price list.' })
}
