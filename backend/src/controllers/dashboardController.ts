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
import { cleanText, isCount, isMoney } from '../utils/validation.js'
import { STORE_TIMEZONE, startOfStoreDay, startOfStoreMonth, storeDateRange } from '../utils/storeTime.js'

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
  const startOfToday = startOfStoreDay(now)
  // Weekly is the rolling last seven store days (including today); monthly is the current store month to date.
  const startOfSalesOverview = salesOverviewPeriod === 'monthly'
    ? startOfStoreMonth(now)
    : new Date(startOfToday.getTime() - 6 * 86400000)

  const [today, overviewSales, topSelling, lowStock, recentTransactions, inventoryValue, customerTotals, user] = await Promise.all([
    SaleModel.aggregate([
      { $match: { storeId, createdAt: { $gte: startOfToday } } },
      { $group: { _id: null, sales: { $sum: '$total' }, profit: { $sum: '$estimatedProfit' }, transactions: { $sum: 1 } } },
    ]),
    SaleModel.aggregate([
      { $match: { storeId, createdAt: { $gte: startOfSalesOverview } } },
      { $unwind: '$items' },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: STORE_TIMEZONE } }, sales: { $sum: '$items.lineTotal' } } },
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
  const salesOverview = storeDateRange(startOfSalesOverview, now).map((date) => ({ date, sales: dayMap.get(date) ?? 0 }))

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
  const payload = (req.body ?? {}) as { name?: unknown; barcode?: unknown; sku?: unknown; category?: unknown; brand?: unknown; supplier?: unknown; costPrice?: unknown; sellingPrice?: unknown; initialStock?: unknown; minStock?: unknown; unit?: unknown }
  const name = cleanText(payload.name)
  const category = cleanText(payload.category)
  if (!name || !category) { res.status(400).json({ message: 'Product name and category are required.' }); return }
  if (!isMoney(payload.costPrice) || !isMoney(payload.sellingPrice)) { res.status(400).json({ message: 'Cost price and selling price must be valid amounts of zero or more.' }); return }
  if ((payload.initialStock !== undefined && !isCount(payload.initialStock)) || (payload.minStock !== undefined && !isCount(payload.minStock))) { res.status(400).json({ message: 'Stock quantities must be whole numbers of zero or more.' }); return }
  for (const optional of [payload.barcode, payload.sku, payload.brand, payload.supplier, payload.unit]) {
    if (optional !== undefined && optional !== '' && cleanText(optional) === null) { res.status(400).json({ message: 'Barcode, SKU, brand, supplier and unit must be text of 64 characters or fewer.' }); return }
  }
  const productData: Record<string, unknown> = {
    storeId,
    name,
    category,
    costPrice: payload.costPrice,
    sellingPrice: payload.sellingPrice,
    currentStock: payload.initialStock ?? 0,
    minStock: payload.minStock ?? 0,
    unit: cleanText(payload.unit) ?? 'piece',
  }
  for (const field of ['barcode', 'sku', 'brand', 'supplier'] as const) {
    const value = cleanText(payload[field])
    if (value) productData[field] = value
  }
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
  const payload = (req.body ?? {}) as { names?: unknown; category?: unknown; unit?: unknown }
  const names = Array.isArray(payload.names) ? Array.from(new Set(payload.names.map((name) => cleanText(name)).filter((name): name is string => name !== null))) : []
  const category = cleanText(payload.category)
  if (!names.length || !category) { res.status(400).json({ message: 'Product names and category are required.' }); return }
  if (names.length > 200) { res.status(400).json({ message: 'Add at most 200 products at a time.' }); return }
  const unit = cleanText(payload.unit) ?? 'piece'
  const products = await ProductModel.insertMany(names.map((name) => ({ storeId, name, category, costPrice: 0, sellingPrice: 0, currentStock: 0, minStock: 0, unit })))
  res.status(201).json({ message: `${products.length} products added.`, products })
}

export async function updateProduct(req: AuthenticatedRequest, res: Response): Promise<void> {
  const storeId = storeIdFromRequest(req)
  if (!storeId) { res.status(401).json({ message: 'Invalid session.' }); return }
  const productId = parseObjectId(req.params.id)
  if (!productId) { res.status(404).json({ message: 'Product not found.' }); return }
  const updates = pickRequestFields(['name', 'barcode', 'sku', 'category', 'brand', 'supplier', 'costPrice', 'sellingPrice', 'minStock', 'unit'], req.body)
  if (!Object.keys(updates).length) { res.status(400).json({ message: 'No editable product fields were provided.' }); return }
  if (('costPrice' in updates && !isMoney(updates.costPrice)) || ('sellingPrice' in updates && !isMoney(updates.sellingPrice))) { res.status(400).json({ message: 'Prices must be valid amounts of zero or more.' }); return }
  if ('minStock' in updates && !isCount(updates.minStock)) { res.status(400).json({ message: 'Minimum stock must be a whole number of zero or more.' }); return }
  for (const field of ['name', 'category', 'barcode', 'sku', 'brand', 'supplier', 'unit']) {
    if (field in updates && cleanText(updates[field]) === null && !(field !== 'name' && field !== 'category' && updates[field] === '')) { res.status(400).json({ message: 'Text fields must be 64 characters or fewer, and name and category cannot be blank.' }); return }
  }
  // A cleared optional field is removed rather than stored as '', so the unique barcode index never sees blanks.
  const changes: Record<string, unknown> = {}
  const removals: Record<string, ''> = {}
  for (const [field, value] of Object.entries(updates)) {
    if (value === '' && !['name', 'category'].includes(field)) removals[field] = ''
    else changes[field] = typeof value === 'string' ? value.trim() : value
  }
  const product = await ProductModel.findOneAndUpdate({ _id: productId, storeId, status: 'active' }, { ...(Object.keys(changes).length ? { $set: changes } : {}), ...(Object.keys(removals).length ? { $unset: removals } : {}) }, { returnDocument: 'after', runValidators: true }).lean()
  if (!product) { res.status(404).json({ message: 'Product not found.' }); return }
  await recordAuditLog({ storeId, userId: new mongoose.Types.ObjectId(req.user!.id), event: 'PRODUCT_UPDATED', resourceType: 'Product', resourceId: product._id })
  res.json({ product })
}

export async function deleteProduct(req: AuthenticatedRequest, res: Response): Promise<void> {
  const storeId = storeIdFromRequest(req)
  if (!storeId) { res.status(401).json({ message: 'Invalid session.' }); return }
  const productId = parseObjectId(req.params.id)
  if (!productId) { res.status(404).json({ message: 'Product not found.' }); return }
  const product = await ProductModel.findOneAndUpdate({ _id: productId, storeId, status: 'active' }, { $set: { status: 'archived' } }, { returnDocument: 'after', runValidators: true }).lean()
  if (!product) { res.status(404).json({ message: 'Product not found.' }); return }
  await recordAuditLog({ storeId, userId: new mongoose.Types.ObjectId(req.user!.id), event: 'PRODUCT_ARCHIVED', resourceType: 'Product', resourceId: product._id })
  res.json({ message: 'Product archived from price list.' })
}
