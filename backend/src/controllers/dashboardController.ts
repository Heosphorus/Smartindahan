import type { Response } from 'express'
import mongoose from 'mongoose'

import type { AuthenticatedRequest } from '../middleware/authMiddleware.js'
import { InventoryTransactionModel } from '../models/InventoryTransaction.js'
import { CustomerModel } from '../models/Customer.js'
import { ProductModel } from '../models/Product.js'
import { SaleModel } from '../models/Sale.js'
import { UserModel } from '../models/User.js'

function storeIdFromRequest(req: AuthenticatedRequest): mongoose.Types.ObjectId | null {
  return req.user?.id && mongoose.isValidObjectId(req.user.id) ? new mongoose.Types.ObjectId(req.user.id) : null
}

export async function getDashboardSummary(req: AuthenticatedRequest, res: Response): Promise<void> {
  const storeId = storeIdFromRequest(req)
  if (!storeId) {
    res.status(401).json({ message: 'Invalid session.' })
    return
  }

  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfSevenDays = new Date(startOfToday)
  startOfSevenDays.setDate(startOfSevenDays.getDate() - 6)

  const [today, sevenDaySales, topSelling, lowStock, recentTransactions, inventoryValue, customerTotals, user] = await Promise.all([
    SaleModel.aggregate([
      { $match: { storeId, createdAt: { $gte: startOfToday } } },
      { $group: { _id: null, sales: { $sum: '$total' }, profit: { $sum: '$estimatedProfit' }, transactions: { $sum: 1 } } },
    ]),
    SaleModel.aggregate([
      { $match: { storeId, createdAt: { $gte: startOfSevenDays } } },
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
    CustomerModel.aggregate([{ $match: { storeId } }, { $group: { _id: null, outstanding: { $sum: '$outstandingBalance' } } }]),
    UserModel.findById(storeId).select('storeName').lean(),
  ])

  const dayMap = new Map<string, number>(sevenDaySales.map((entry) => [entry._id as string, entry.sales as number]))
  const salesOverview = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(startOfSevenDays)
    date.setDate(startOfSevenDays.getDate() + index)
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
    salesOverview,
    topSelling: topSelling.map((entry, index) => ({ rank: index + 1, name: entry.name, sold: entry.sold })),
    lowStock: lowStock.map((product) => ({ id: product._id.toString(), name: product.name, currentStock: product.currentStock, minStock: product.minStock })),
    recentTransactions: recentTransactions.map((sale) => ({ id: sale.transactionCode, amount: sale.total, paymentMethod: sale.paymentMethod, createdAt: sale.createdAt })),
  })
}

export async function getProducts(req: AuthenticatedRequest, res: Response): Promise<void> {
  const storeId = storeIdFromRequest(req)
  if (!storeId) { res.status(401).json({ message: 'Invalid session.' }); return }
  const products = await ProductModel.find({ storeId, status: 'active' }).sort({ name: 1 }).lean()
  res.json({ products })
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
  const product = await ProductModel.create(productData)
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
  const product = await ProductModel.findOneAndUpdate({ _id: req.params.id, storeId }, { $set: req.body }, { new: true, runValidators: true }).lean()
  if (!product) { res.status(404).json({ message: 'Product not found.' }); return }
  res.json({ product })
}

export async function deleteProduct(req: AuthenticatedRequest, res: Response): Promise<void> {
  const storeId = storeIdFromRequest(req)
  if (!storeId) { res.status(401).json({ message: 'Invalid session.' }); return }
  const result = await ProductModel.deleteOne({ _id: req.params.id, storeId })
  if (!result.deletedCount) { res.status(404).json({ message: 'Product not found.' }); return }
  res.json({ message: 'Product removed from price list.' })
}
