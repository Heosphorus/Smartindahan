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
import { applyAdjustment, parseAdjustment } from '../utils/priceAdjustment.js'
import { pickRequestFields } from '../utils/requestFields.js'
import { barcodeVariants, escapeRegex } from '../utils/inventory.js'
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
  const query = req.query as Record<string, unknown>
  const search = query.q === undefined ? '' : (typeof query.q === 'string' ? query.q.trim() : null)
  const category = query.category === undefined || query.category === '' ? null : (typeof query.category === 'string' && query.category.length <= 64 ? query.category : undefined)
  const status = query.status === undefined || query.status === 'all' ? null : (query.status === 'low' || query.status === 'out' || query.status === 'ok' ? query.status : undefined)
  const sort = query.sort === undefined || query.sort === 'name' ? 'name' : (query.sort === 'stock' ? 'stock' : undefined)
  if (search === null || search.length > 64 || category === undefined || status === undefined || sort === undefined) { res.status(400).json({ message: 'Invalid search, category, status or sort.' }); return }

  const conditions: Record<string, unknown>[] = [{ storeId, status: 'active' }]
  if (search) {
    // The text is matched literally across the fields a store owner searches by, within this store only.
    const pattern = { $regex: escapeRegex(search), $options: 'i' }
    conditions.push({ $or: [{ name: pattern }, { barcode: pattern }, { sku: pattern }, { brand: pattern }] })
  }
  if (category) conditions.push({ category })
  if (status === 'out') conditions.push({ currentStock: { $lte: 0 } })
  else if (status === 'low') conditions.push({ currentStock: { $gt: 0 } }, { minStock: { $gt: 0 } }, { $expr: { $lte: ['$currentStock', '$minStock'] } })
  else if (status === 'ok') conditions.push({ currentStock: { $gt: 0 } }, { $or: [{ minStock: 0 }, { $expr: { $gt: ['$currentStock', '$minStock'] } }] })
  const filter = { $and: conditions }
  const order: Record<string, 1 | -1> = sort === 'stock' ? { currentStock: 1, name: 1, _id: 1 } : { name: 1, _id: 1 }

  const [products, total, counts, categories] = await Promise.all([
    ProductModel.find(filter).sort(order).skip(pagination.skip).limit(pagination.limit).lean(),
    ProductModel.countDocuments(filter),
    // Counts for the whole store (not the current filter), so the filter chips can show how many products need attention.
    ProductModel.aggregate<{ _id: null; all: number; out: number; low: number }>([
      { $match: { storeId, status: 'active' } },
      { $group: { _id: null, all: { $sum: 1 }, out: { $sum: { $cond: [{ $lte: ['$currentStock', 0] }, 1, 0] } }, low: { $sum: { $cond: [{ $and: [{ $gt: ['$currentStock', 0] }, { $gt: ['$minStock', 0] }, { $lte: ['$currentStock', '$minStock'] }] }, 1, 0] } } } },
    ]),
    ProductModel.distinct('category', { storeId, status: 'active' }) as Promise<string[]>,
  ])
  res.json({
    products,
    pagination: { page: pagination.page, limit: pagination.limit, total },
    summary: { all: counts[0]?.all ?? 0, out: counts[0]?.out ?? 0, low: counts[0]?.low ?? 0 },
    categories: categories.sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' })),
  })
}

type PackFields = { purchaseUnit?: string; unitsPerPurchaseUnit?: number }

/**
 * Reads the optional pack setup (for example "pack" = 24 pieces). Both values are given together or both are left out, and the
 * size must be a whole number from 2 to 100,000. Returns null for unusable input; an empty object means no pack setup.
 */
function parsePack(purchaseUnit: unknown, unitsPerPurchaseUnit: unknown): PackFields | null {
  const none = (purchaseUnit === undefined || purchaseUnit === '' || purchaseUnit === null) && (unitsPerPurchaseUnit === undefined || unitsPerPurchaseUnit === '' || unitsPerPurchaseUnit === null)
  if (none) return {}
  const unit = cleanText(purchaseUnit, 32)
  if (!unit || typeof unitsPerPurchaseUnit !== 'number' || !Number.isSafeInteger(unitsPerPurchaseUnit) || unitsPerPurchaseUnit < 2 || unitsPerPurchaseUnit > 100000) return null
  return { purchaseUnit: unit, unitsPerPurchaseUnit }
}

/** Another active or archived product in this store that already uses this barcode (in either UPC-A or EAN-13 form). */
async function barcodeOwner(storeId: mongoose.Types.ObjectId, barcode: string, exceptId?: mongoose.Types.ObjectId) {
  return ProductModel.findOne({ storeId, barcode: { $in: barcodeVariants(barcode) }, ...(exceptId ? { _id: { $ne: exceptId } } : {}) }).select('name status').lean()
}

function duplicateBarcodeMessage(owner: { name: string; status?: string | null }): string {
  return owner.status === 'archived' ? `This barcode belongs to "${owner.name}", which was archived. Restore that product instead of adding a new one.` : `This barcode is already used by "${owner.name}".`
}

/** Brings an archived product back (for example when its barcode is scanned again). */
export async function restoreProduct(req: AuthenticatedRequest, res: Response): Promise<void> {
  const storeId = storeIdFromRequest(req)
  if (!storeId) { res.status(401).json({ message: 'Invalid session.' }); return }
  const productId = parseObjectId(req.params.id)
  const product = productId ? await ProductModel.findOneAndUpdate({ _id: productId, storeId, status: 'archived' }, { $set: { status: 'active' } }, { returnDocument: 'after' }).lean() : null
  if (!product) { res.status(404).json({ message: 'Archived product not found.' }); return }
  await recordAuditLog({ storeId, userId: new mongoose.Types.ObjectId(req.user!.id), event: 'PRODUCT_RESTORED', resourceType: 'Product', resourceId: product._id })
  res.json({ product })
}

export async function createProduct(req: AuthenticatedRequest, res: Response): Promise<void> {
  const storeId = storeIdFromRequest(req)
  if (!storeId) { res.status(401).json({ message: 'Invalid session.' }); return }
  const payload = (req.body ?? {}) as { name?: unknown; barcode?: unknown; sku?: unknown; category?: unknown; brand?: unknown; supplier?: unknown; costPrice?: unknown; sellingPrice?: unknown; initialStock?: unknown; minStock?: unknown; unit?: unknown; purchaseUnit?: unknown; unitsPerPurchaseUnit?: unknown }
  const pack = parsePack(payload.purchaseUnit, payload.unitsPerPurchaseUnit)
  if (!pack) { res.status(400).json({ message: 'A pack needs a unit name and a size that is a whole number from 2 to 100,000.' }); return }
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
    ...pack,
  }
  for (const field of ['barcode', 'sku', 'brand', 'supplier'] as const) {
    const value = cleanText(payload[field])
    if (value) productData[field] = value
  }
  if (typeof productData.barcode === 'string') {
    const owner = await barcodeOwner(storeId, productData.barcode)
    if (owner) { res.status(409).json({ message: duplicateBarcodeMessage(owner) }); return }
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
  const payload = (req.body ?? {}) as { names?: unknown; items?: unknown; category?: unknown; unit?: unknown; brand?: unknown; costPrice?: unknown; sellingPrice?: unknown; initialStock?: unknown; minStock?: unknown }
  // Products arrive either as plain names (all share the default price) or as items that can carry their own selling price.
  const rawItems: unknown[] = Array.isArray(payload.items) ? payload.items : (Array.isArray(payload.names) ? payload.names.map((name) => ({ name })) : [])
  const isBlankName = (name: unknown) => typeof name === 'string' && name.trim() === ''
  const itemFields = rawItems.map((item) => (typeof item === 'object' && item !== null ? item as { name?: unknown; sellingPrice?: unknown } : { name: undefined, sellingPrice: undefined }))
  if (itemFields.some((item) => cleanText(item.name) === null && !isBlankName(item.name))) { res.status(400).json({ message: 'Each product name must be text of 64 characters or fewer.' }); return }
  const category = cleanText(payload.category)
  // Cost is optional (stored as 0 when left out). The default selling price is 0 for older clients; a price on a product overrides it.
  const costPrice = payload.costPrice ?? 0
  const defaultSellingPrice = payload.sellingPrice ?? 0
  if (!isMoney(costPrice) || !isMoney(defaultSellingPrice) || itemFields.some((item) => item.sellingPrice !== undefined && !isMoney(item.sellingPrice))) { res.status(400).json({ message: 'Cost price and selling price must be valid amounts of zero or more.' }); return }
  const entries = new Map<string, number>()
  for (const item of itemFields) {
    const name = cleanText(item.name)
    if (name !== null && !entries.has(name)) entries.set(name, (item.sellingPrice as number | undefined) ?? defaultSellingPrice)
  }
  if (!entries.size || !category) { res.status(400).json({ message: 'Product names and category are required.' }); return }
  if (entries.size > 200) { res.status(400).json({ message: 'Add at most 200 products at a time.' }); return }
  if ((payload.initialStock !== undefined && !isCount(payload.initialStock)) || (payload.minStock !== undefined && !isCount(payload.minStock))) { res.status(400).json({ message: 'Stock quantities must be whole numbers of zero or more.' }); return }
  for (const optional of [payload.brand, payload.unit]) {
    if (optional !== undefined && optional !== '' && cleanText(optional) === null) { res.status(400).json({ message: 'Brand and unit must be text of 64 characters or fewer.' }); return }
  }
  const unit = cleanText(payload.unit) ?? 'piece'
  const brand = cleanText(payload.brand)
  const currentStock = payload.initialStock ?? 0
  const minStock = payload.minStock ?? 0
  const userId = new mongoose.Types.ObjectId(req.user!.id)

  const session = await mongoose.startSession()
  let products: Awaited<ReturnType<typeof ProductModel.insertMany>> = []
  try {
    await session.withTransaction(async () => {
      products = await ProductModel.insertMany(Array.from(entries, ([name, sellingPrice]) => ({ storeId, name, category, costPrice, sellingPrice, currentStock, minStock, unit, ...(brand ? { brand } : {}) })), { session })
      if (currentStock > 0) {
        await InventoryTransactionModel.create(products.map((product) => ({ storeId, userId, productId: product._id, type: 'stock_in' as const, quantity: currentStock, previousStock: 0, newStock: currentStock, reason: 'Initial product stock' })), { session, ordered: true })
      }
      for (const product of products) {
        await recordAuditLog({ storeId, userId, event: 'PRODUCT_CREATED', resourceType: 'Product', resourceId: product._id }, session)
      }
    })
  } catch (error) {
    console.error('Bulk product creation failed:', error instanceof Error ? error.message : 'Unknown error')
    res.status(500).json({ message: 'Products could not be added.' })
    return
  } finally {
    await session.endSession()
  }
  res.status(201).json({ message: `${products.length} products added.`, products })
}

const UNCATEGORIZED = 'Uncategorized'
const sameWords = (left: string, right: string) => left.replace(/\s+/g, ' ').toLocaleLowerCase() === right.replace(/\s+/g, ' ').toLocaleLowerCase()

/**
 * Categories are just the category text on products, so renaming or deleting one moves its products to another name.
 * Deleting never deletes products: they go to the chosen category, or "Uncategorized".
 */
async function changeCategory(req: AuthenticatedRequest, res: Response, mode: 'rename' | 'delete'): Promise<void> {
  const storeId = storeIdFromRequest(req)
  if (!storeId) { res.status(401).json({ message: 'Invalid session.' }); return }
  const payload = (req.body ?? {}) as { name?: unknown; newName?: unknown; moveTo?: unknown }
  const from = cleanText(payload.name)
  const requested = mode === 'rename' ? payload.newName : (payload.moveTo === undefined || payload.moveTo === '' ? UNCATEGORIZED : payload.moveTo)
  const to = cleanText(requested)
  if (!from || !to) { res.status(400).json({ message: mode === 'rename' ? 'Enter the category and its new name, up to 64 characters.' : 'Category names must be text of 64 characters or fewer.' }); return }
  if (mode === 'rename' && from === to) { res.status(400).json({ message: 'Enter a different name.' }); return }
  if (mode === 'delete' && sameWords(from, to)) { res.status(400).json({ message: 'Choose a different category to move the products to.' }); return }

  const existing = (await ProductModel.distinct('category', { storeId, status: 'active' })) as string[]
  if (!existing.includes(from)) { res.status(404).json({ message: 'Category not found.' }); return }
  // A name that only differs by capitals or spacing from another category joins that category instead of creating a lookalike.
  const target = existing.find((name) => name !== from && sameWords(name, to)) ?? to
  const merged = target !== from && existing.includes(target)
  const moved = await ProductModel.countDocuments({ storeId, category: from, status: 'active' })
  const userId = new mongoose.Types.ObjectId(req.user!.id)

  const session = await mongoose.startSession()
  try {
    await session.withTransaction(async () => {
      await ProductModel.updateMany({ storeId, category: from }, { $set: { category: target } }, { session })
      await recordAuditLog({ storeId, userId, event: mode === 'rename' ? 'CATEGORY_RENAMED' : 'CATEGORY_DELETED', resourceType: 'Category', resourceId: storeId, metadata: { from, to: target, products: moved } }, session)
    })
  } catch (error) {
    console.error('Category change failed:', error instanceof Error ? error.message : 'Unknown error')
    res.status(500).json({ message: 'The category could not be changed.' })
    return
  } finally {
    await session.endSession()
  }
  const count = `${moved} ${moved === 1 ? 'product' : 'products'}`
  const message = mode === 'rename'
    ? (merged ? `"${from}" was merged into "${target}" (${count}).` : `"${from}" was renamed to "${target}" (${count}).`)
    : `"${from}" was deleted. ${count} moved to "${target}".`
  res.json({ message, category: target, moved })
}

export const renameCategory = (req: AuthenticatedRequest, res: Response) => changeCategory(req, res, 'rename')
export const deleteCategory = (req: AuthenticatedRequest, res: Response) => changeCategory(req, res, 'delete')

export async function updateProduct(req: AuthenticatedRequest, res: Response): Promise<void> {
  const storeId = storeIdFromRequest(req)
  if (!storeId) { res.status(401).json({ message: 'Invalid session.' }); return }
  const productId = parseObjectId(req.params.id)
  if (!productId) { res.status(404).json({ message: 'Product not found.' }); return }
  const updates = pickRequestFields(['name', 'barcode', 'sku', 'category', 'brand', 'supplier', 'costPrice', 'sellingPrice', 'minStock', 'unit', 'purchaseUnit', 'unitsPerPurchaseUnit'], req.body)
  if (!Object.keys(updates).length) { res.status(400).json({ message: 'No editable product fields were provided.' }); return }
  // The two pack fields change together: set both, or clear both by sending them empty.
  const packTouched = 'purchaseUnit' in updates || 'unitsPerPurchaseUnit' in updates
  const pack = packTouched ? parsePack(updates.purchaseUnit, updates.unitsPerPurchaseUnit) : {}
  if (!pack) { res.status(400).json({ message: 'A pack needs a unit name and a size that is a whole number from 2 to 100,000.' }); return }
  delete updates.purchaseUnit
  delete updates.unitsPerPurchaseUnit
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
  if (packTouched) {
    if (pack.purchaseUnit) Object.assign(changes, pack)
    else Object.assign(removals, { purchaseUnit: '', unitsPerPurchaseUnit: '' })
  }
  if (typeof changes.barcode === 'string') {
    const owner = await barcodeOwner(storeId, changes.barcode, productId)
    if (owner) { res.status(409).json({ message: duplicateBarcodeMessage(owner) }); return }
  }
  try {
    const before = await ProductModel.findOne({ _id: productId, storeId, status: 'active' }).select('sellingPrice costPrice minStock').lean()
    const product = await ProductModel.findOneAndUpdate({ _id: productId, storeId, status: 'active' }, { ...(Object.keys(changes).length ? { $set: changes } : {}), ...(Object.keys(removals).length ? { $unset: removals } : {}) }, { returnDocument: 'after', runValidators: true }).lean()
    if (!product) { res.status(404).json({ message: 'Product not found.' }); return }
    // Price and alert-level changes keep the old and new values, so they can be traced later.
    const changed: Record<string, string | number | boolean> = { fields: Object.keys({ ...changes, ...removals }).join(',') }
    for (const field of ['sellingPrice', 'costPrice', 'minStock'] as const) {
      if (before && before[field] !== product[field]) { changed[`${field}Before`] = before[field]; changed[`${field}After`] = product[field] }
    }
    await recordAuditLog({ storeId, userId: new mongoose.Types.ObjectId(req.user!.id), event: 'PRODUCT_UPDATED', resourceType: 'Product', resourceId: product._id, metadata: changed })
    res.json({ product })
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 11000) { res.status(409).json({ message: 'This barcode is already used by another product.' }); return }
    throw error
  }
}

const MAX_BATCH = 500

/** Reads `ids` from a batch request: 1 to 500 distinct valid ids, or null when the list is unusable. */
function parseBatchIds(raw: unknown): mongoose.Types.ObjectId[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_BATCH) return null
  const ids = raw.map((value) => parseObjectId(value))
  if (ids.some((id) => id === null)) return null
  return Array.from(new Map((ids as mongoose.Types.ObjectId[]).map((id) => [id.toHexString(), id])).values())
}

/** Changes the selling price and/or cost of many products at once; all of them change, or none do. */
export async function batchUpdateProducts(req: AuthenticatedRequest, res: Response): Promise<void> {
  const storeId = storeIdFromRequest(req)
  if (!storeId) { res.status(401).json({ message: 'Invalid session.' }); return }
  const payload = (req.body ?? {}) as { ids?: unknown; sellingPrice?: unknown; costPrice?: unknown }
  const ids = parseBatchIds(payload.ids)
  if (!ids) { res.status(400).json({ message: `Choose between 1 and ${MAX_BATCH} products.` }); return }
  const selling = payload.sellingPrice === undefined ? undefined : parseAdjustment(payload.sellingPrice)
  const cost = payload.costPrice === undefined ? undefined : parseAdjustment(payload.costPrice)
  if (selling === null || cost === null) { res.status(400).json({ message: 'The price change is not valid.' }); return }
  if (!selling && !cost) { res.status(400).json({ message: 'Choose a selling price or cost change.' }); return }

  const products = await ProductModel.find({ _id: { $in: ids }, storeId, status: 'active' }).select('_id sellingPrice costPrice').lean()
  if (!products.length) { res.status(404).json({ message: 'None of the selected products were found.' }); return }
  const changes = products.map((product) => ({
    id: product._id,
    sellingPrice: selling ? applyAdjustment(product.sellingPrice, selling) : product.sellingPrice,
    costPrice: cost ? applyAdjustment(product.costPrice, cost) : product.costPrice,
  }))
  const invalid = changes.filter((change) => change.sellingPrice === null || change.costPrice === null).length
  if (invalid) {
    res.status(400).json({ message: `${invalid} ${invalid === 1 ? 'product would' : 'products would'} end up with a price below zero or too large. Nothing was changed.` })
    return
  }
  const userId = new mongoose.Types.ObjectId(req.user!.id)

  const session = await mongoose.startSession()
  try {
    await session.withTransaction(async () => {
      await ProductModel.bulkWrite(changes.map((change) => ({
        updateOne: { filter: { _id: change.id, storeId }, update: { $set: { ...(selling ? { sellingPrice: change.sellingPrice! } : {}), ...(cost ? { costPrice: change.costPrice! } : {}) } } },
      })), { session, ordered: true })
      for (const change of changes) {
        await recordAuditLog({ storeId, userId, event: 'PRODUCT_UPDATED', resourceType: 'Product', resourceId: change.id, metadata: { batch: true, ...(selling ? { sellingPrice: change.sellingPrice! } : {}), ...(cost ? { costPrice: change.costPrice! } : {}) } }, session)
      }
    })
  } catch (error) {
    console.error('Batch product update failed:', error instanceof Error ? error.message : 'Unknown error')
    res.status(500).json({ message: 'The prices could not be changed.' })
    return
  } finally {
    await session.endSession()
  }
  const skipped = ids.length - products.length
  res.json({ message: `${products.length} ${products.length === 1 ? 'product' : 'products'} updated.`, updated: products.length, skipped })
}

/** Removes many products from the price list at once (the same archive as the single Archive button). */
export async function batchArchiveProducts(req: AuthenticatedRequest, res: Response): Promise<void> {
  const storeId = storeIdFromRequest(req)
  if (!storeId) { res.status(401).json({ message: 'Invalid session.' }); return }
  const ids = parseBatchIds((req.body as { ids?: unknown } | undefined)?.ids)
  if (!ids) { res.status(400).json({ message: `Choose between 1 and ${MAX_BATCH} products.` }); return }
  const products = await ProductModel.find({ _id: { $in: ids }, storeId, status: 'active' }).select('_id').lean()
  if (!products.length) { res.status(404).json({ message: 'None of the selected products were found.' }); return }
  const userId = new mongoose.Types.ObjectId(req.user!.id)

  const session = await mongoose.startSession()
  try {
    await session.withTransaction(async () => {
      await ProductModel.updateMany({ _id: { $in: products.map((product) => product._id) }, storeId, status: 'active' }, { $set: { status: 'archived' } }, { session })
      for (const product of products) {
        await recordAuditLog({ storeId, userId, event: 'PRODUCT_ARCHIVED', resourceType: 'Product', resourceId: product._id, metadata: { batch: true } }, session)
      }
    })
  } catch (error) {
    console.error('Batch product archive failed:', error instanceof Error ? error.message : 'Unknown error')
    res.status(500).json({ message: 'The products could not be removed.' })
    return
  } finally {
    await session.endSession()
  }
  res.json({ message: `${products.length} ${products.length === 1 ? 'product' : 'products'} removed from the price list.`, archived: products.length })
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
