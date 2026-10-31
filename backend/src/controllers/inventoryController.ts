import { createHash } from 'node:crypto'
import type { Response } from 'express'
import mongoose from 'mongoose'

import type { AuthenticatedRequest } from '../middleware/authMiddleware.js'
import { InventoryCountModel } from '../models/InventoryCount.js'
import { InventoryTransactionModel } from '../models/InventoryTransaction.js'
import { ProductModel } from '../models/Product.js'
import { PurchaseModel } from '../models/Purchase.js'
import { SupplierModel } from '../models/Supplier.js'
import { recordAuditLog } from '../services/auditService.js'
import { changeStock, isDuplicateKeyError, OperationError } from '../services/inventoryService.js'
import { baseQuantity, MAX_STOCK_CHANGE, roundCost } from '../utils/inventory.js'
import { parseObjectId } from '../utils/objectId.js'
import { parsePagination } from '../utils/pagination.js'
import { cleanText, isIdempotencyKey, isMoney, roundMoney } from '../utils/validation.js'

const MAX_RESTOCK_LINES = 100
const MAX_COUNT_ITEMS = 500

function storeIdOf(req: AuthenticatedRequest): mongoose.Types.ObjectId | null {
  return parseObjectId(req.user?.storeId)
}

function sendFailure(res: Response, error: unknown, fallback: string): void {
  if (error instanceof OperationError) { res.status(error.statusCode).json({ message: error.message }); return }
  console.error(`${fallback} (${error instanceof Error ? error.name : 'UnknownError'})`)
  res.status(500).json({ message: fallback })
}

/** Restocking: receive a delivery for one or more products ---------------------------------------------------------------- */

type PurchaseLine = { productId: mongoose.Types.ObjectId; productName: string; quantity: number; receivedUnit: string; unitsPerReceivedUnit: number; baseQuantity: number; unitCost: number; costPerBaseUnit: number; lineTotal: number; previousStock: number; newStock: number }
type RestockLine = { productId: mongoose.Types.ObjectId; quantity: number; unit: 'base' | 'purchase'; unitCost: number }

function parseRestockLines(raw: unknown): RestockLine[] | null {
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_RESTOCK_LINES) return null
  const lines: RestockLine[] = []
  for (const entry of raw) {
    const item = (entry ?? {}) as { productId?: unknown; quantity?: unknown; unit?: unknown; unitCost?: unknown }
    const productId = parseObjectId(item.productId)
    if (!productId || typeof item.quantity !== 'number' || !Number.isFinite(item.quantity) || item.quantity <= 0 || !isMoney(item.unitCost)) return null
    if (item.unit !== undefined && item.unit !== 'base' && item.unit !== 'purchase') return null
    lines.push({ productId, quantity: item.quantity, unit: item.unit === 'purchase' ? 'purchase' : 'base', unitCost: item.unitCost })
  }
  return new Set(lines.map((line) => line.productId.toHexString())).size === lines.length ? lines : null
}

function fingerprintOf(lines: RestockLine[], supplierId: mongoose.Types.ObjectId | null): string {
  const normalized = lines.map((line) => [line.productId.toHexString(), line.quantity, line.unit, line.unitCost]).sort((left, right) => String(left[0]).localeCompare(String(right[0])))
  return createHash('sha256').update(JSON.stringify([supplierId?.toHexString() ?? null, normalized])).digest('hex')
}

function purchaseResponse(purchase: { _id: mongoose.Types.ObjectId; total: number; supplierName?: string | null; items: Array<{ productId: mongoose.Types.ObjectId; productName: string; baseQuantity: number; previousStock: number; newStock: number; lineTotal: number }> }) {
  return {
    id: purchase._id.toString(),
    total: purchase.total,
    supplierName: purchase.supplierName ?? null,
    items: purchase.items.map((item) => ({ productId: item.productId.toString(), name: item.productName, added: item.baseQuantity, previousStock: item.previousStock, newStock: item.newStock, lineTotal: item.lineTotal })),
  }
}

/**
 * Receives a delivery: every line adds stock (converted from packs to selling units where the product has a pack size), writes
 * a stock movement tied to one purchase record with the actual cost paid, and optionally updates the product's current cost.
 * All lines succeed together or none do. The retry key makes a double tap or a network retry record the delivery only once.
 */
export async function restock(req: AuthenticatedRequest, res: Response): Promise<void> {
  const storeId = storeIdOf(req)
  if (!storeId) { res.status(401).json({ message: 'Invalid session.' }); return }
  const payload = (req.body ?? {}) as { items?: unknown; supplierId?: unknown; note?: unknown; idempotencyKey?: unknown; updateProductCost?: unknown }
  const lines = parseRestockLines(payload.items)
  if (!lines) { res.status(400).json({ message: `Add 1 to ${MAX_RESTOCK_LINES} different products, each with a positive quantity and a cost of zero or more.` }); return }
  if (!isIdempotencyKey(payload.idempotencyKey)) { res.status(400).json({ message: 'A request key is required so the delivery is recorded only once.' }); return }
  const idempotencyKey = payload.idempotencyKey
  let supplierId: mongoose.Types.ObjectId | null = null
  if (payload.supplierId !== undefined && payload.supplierId !== null && payload.supplierId !== '') {
    supplierId = parseObjectId(payload.supplierId)
    if (!supplierId) { res.status(400).json({ message: 'Choose a valid supplier.' }); return }
  }
  if (payload.note !== undefined && payload.note !== '' && cleanText(payload.note, 200) === null) { res.status(400).json({ message: 'Note must be 200 characters or fewer.' }); return }
  if (payload.updateProductCost !== undefined && typeof payload.updateProductCost !== 'boolean') { res.status(400).json({ message: 'Update product cost must be true or false.' }); return }
  const updateProductCost = payload.updateProductCost !== false
  const note = cleanText(payload.note, 200) ?? undefined
  const userId = new mongoose.Types.ObjectId(req.user!.id)
  const fingerprint = fingerprintOf(lines, supplierId)

  const replay = async () => {
    const earlier = await PurchaseModel.findOne({ storeId, idempotencyKey }).lean()
    if (!earlier) return false
    if (earlier.fingerprint !== fingerprint) { res.status(409).json({ message: 'This request key was already used for a different delivery. Review the items and try again.' }); return true }
    res.status(200).json({ message: 'This delivery was already recorded.', replayed: true, purchase: purchaseResponse(earlier) })
    return true
  }
  if (await replay()) return

  const session = await mongoose.startSession()
  try {
    let created: Awaited<ReturnType<typeof PurchaseModel.create>>[number] | undefined
    await session.withTransaction(async () => {
      created = undefined
      let supplierName: string | undefined
      if (supplierId) {
        const supplier = await SupplierModel.findOne({ _id: supplierId, storeId, isDeleted: { $ne: true } }).select('name').session(session).lean()
        if (!supplier) throw new OperationError('Supplier not found.', 404)
        supplierName = supplier.name
      }
      const products = await ProductModel.find({ _id: { $in: lines.map((line) => line.productId) }, storeId, status: 'active' }).session(session).lean()
      const byId = new Map(products.map((product) => [product._id.toHexString(), product]))
      const purchaseId = new mongoose.Types.ObjectId()
      const items: PurchaseLine[] = []
      let total = 0
      for (const line of lines) {
        const product = byId.get(line.productId.toHexString())
        if (!product) throw new OperationError('One of the products was not found.', 404)
        const hasPack = Boolean(product.purchaseUnit && product.unitsPerPurchaseUnit)
        if (line.unit === 'purchase' && !hasPack) throw new OperationError(`${product.name} has no pack size set up. Receive it in ${product.unit} or set a pack size first.`)
        const unitsPer = line.unit === 'purchase' ? product.unitsPerPurchaseUnit! : 1
        const added = baseQuantity(line.quantity, unitsPer)
        if (added === null) throw new OperationError(`${product.name}: the quantity must make a whole number of ${product.unit} (up to ${MAX_STOCK_CHANGE.toLocaleString('en-US')}).`)
        const costPerBase = roundCost(line.unitCost / unitsPer)
        const lineTotal = roundMoney(line.quantity * line.unitCost)
        const result = await changeStock(session, {
          storeId, userId, productId: line.productId, delta: added, type: 'stock_in', unitCost: costPerBase, supplierId: supplierId ?? undefined, purchaseId, idempotencyKey,
          note, set: updateProductCost ? { costPrice: costPerBase } : undefined,
        })
        items.push({ productId: line.productId, productName: product.name, quantity: line.quantity, receivedUnit: line.unit === 'purchase' ? product.purchaseUnit! : product.unit, unitsPerReceivedUnit: unitsPer, baseQuantity: added, unitCost: line.unitCost, costPerBaseUnit: costPerBase, lineTotal, previousStock: result.previousStock, newStock: result.newStock })
        total = roundMoney(total + lineTotal)
        await recordAuditLog({ storeId, userId, event: 'INVENTORY_STOCK_IN', resourceType: 'Product', resourceId: line.productId, metadata: { quantity: added, previousStock: result.previousStock, newStock: result.newStock, costPerUnit: costPerBase } }, session)
      }
      const record: Record<string, unknown> = { _id: purchaseId, storeId, userId, items, total, idempotencyKey, fingerprint }
      if (supplierId) { record.supplierId = supplierId; record.supplierName = supplierName }
      if (note) record.note = note
      const [purchase] = await PurchaseModel.create([record], { session })
      if (!purchase) throw new OperationError('The delivery could not be recorded.', 500)
      await recordAuditLog({ storeId, userId, event: 'INVENTORY_PURCHASE', resourceType: 'Purchase', resourceId: purchaseId, metadata: { lines: items.length, total, ...(supplierName ? { supplier: supplierName } : {}) } }, session)
      created = purchase
    })
    if (!created) throw new OperationError('The delivery could not be recorded.', 500)
    res.status(201).json({ message: 'Delivery recorded and stock updated.', purchase: purchaseResponse(created) })
  } catch (error) {
    // A concurrent request with the same key won the race; its transaction committed and ours rolled back.
    if (isDuplicateKeyError(error) && await replay()) return
    sendFailure(res, error, 'The delivery could not be recorded.')
  } finally {
    await session.endSession()
  }
}

/** Stock history for one product (or the whole store), newest first, so every change can be traced. */
export async function listMovements(req: AuthenticatedRequest, res: Response): Promise<void> {
  const storeId = storeIdOf(req)
  if (!storeId) { res.status(401).json({ message: 'Invalid session.' }); return }
  const pagination = parsePagination(req.query as Record<string, unknown>, 20)
  if (!pagination) { res.status(400).json({ message: 'Invalid page or limit.' }); return }
  const filter: Record<string, unknown> = { storeId }
  if (req.query.productId !== undefined) {
    const productId = parseObjectId(req.query.productId)
    if (!productId) { res.status(400).json({ message: 'Invalid product.' }); return }
    filter.productId = productId
  }
  const [movements, total] = await Promise.all([
    InventoryTransactionModel.find(filter).sort({ createdAt: -1, _id: -1 }).skip(pagination.skip).limit(pagination.limit).lean(),
    InventoryTransactionModel.countDocuments(filter),
  ])
  res.json({ movements: movements.map((movement) => ({ id: movement._id, productId: movement.productId, type: movement.type, quantity: movement.quantity, previousStock: movement.previousStock, newStock: movement.newStock, reason: movement.reason, note: movement.note, unitCost: movement.unitCost, purchaseId: movement.purchaseId, countId: movement.countId, createdAt: movement.createdAt })), pagination: { page: pagination.page, limit: pagination.limit, total } })
}

/** Inventory counts: record physical quantities, review the differences, then apply them ------------------------------------ */

type CountInput = { productId: mongoose.Types.ObjectId; countedQuantity: number; reason?: string }

function parseCountItems(raw: unknown): CountInput[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_COUNT_ITEMS) return null
  const items: CountInput[] = []
  for (const entry of raw) {
    const item = (entry ?? {}) as { productId?: unknown; countedQuantity?: unknown; reason?: unknown }
    const productId = parseObjectId(item.productId)
    if (!productId || typeof item.countedQuantity !== 'number' || !Number.isSafeInteger(item.countedQuantity) || item.countedQuantity < 0 || item.countedQuantity > MAX_STOCK_CHANGE) return null
    if (item.reason !== undefined && item.reason !== '' && cleanText(item.reason, 120) === null) return null
    const reason = cleanText(item.reason, 120)
    items.push({ productId, countedQuantity: item.countedQuantity, ...(reason ? { reason } : {}) })
  }
  return new Set(items.map((item) => item.productId.toHexString())).size === items.length ? items : null
}

type CountRecord = { _id: mongoose.Types.ObjectId; name: string; status: string; items: Array<{ productId: mongoose.Types.ObjectId; productName: string; unit: string; expectedQuantity: number; countedQuantity: number; reason?: string | null }>; createdAt?: Date; updatedAt?: Date; appliedAt?: Date | null }

/** A count as the client sees it, with each product's stock right now so the review can show what moved since it was counted. */
async function countView(count: CountRecord, storeId: mongoose.Types.ObjectId) {
  const stockNow = new Map<string, number>()
  if (count.status === 'open' && count.items.length) {
    const products = await ProductModel.find({ _id: { $in: count.items.map((item) => item.productId) }, storeId }).select('currentStock status').lean()
    for (const product of products) if (product.status === 'active') stockNow.set(product._id.toHexString(), product.currentStock)
  }
  return {
    id: count._id.toString(), name: count.name, status: count.status, createdAt: count.createdAt, updatedAt: count.updatedAt, appliedAt: count.appliedAt ?? null,
    items: count.items.map((item) => {
      const now = stockNow.get(item.productId.toHexString())
      return {
        productId: item.productId.toString(), name: item.productName, unit: item.unit, expectedQuantity: item.expectedQuantity, countedQuantity: item.countedQuantity,
        difference: item.countedQuantity - item.expectedQuantity, reason: item.reason ?? '',
        ...(count.status === 'open' ? { stockNow: now ?? null, movedSinceCount: now === undefined ? null : now - item.expectedQuantity } : {}),
      }
    }),
  }
}

export async function listCounts(req: AuthenticatedRequest, res: Response): Promise<void> {
  const storeId = storeIdOf(req)
  if (!storeId) { res.status(401).json({ message: 'Invalid session.' }); return }
  const status = req.query.status
  if (status !== undefined && status !== 'open' && status !== 'applied') { res.status(400).json({ message: 'Status must be open or applied.' }); return }
  const counts = await InventoryCountModel.find({ storeId, status: status ?? { $in: ['open', 'applied'] } }).sort({ updatedAt: -1 }).limit(20).lean()
  res.json({ counts: counts.map((count) => ({ id: count._id.toString(), name: count.name, status: count.status, itemCount: count.items.length, discrepancies: count.items.filter((item) => item.countedQuantity !== item.expectedQuantity).length, updatedAt: count.updatedAt, appliedAt: count.appliedAt ?? null })) })
}

export async function getCount(req: AuthenticatedRequest, res: Response): Promise<void> {
  const storeId = storeIdOf(req)
  const countId = parseObjectId(req.params.id)
  if (!storeId) { res.status(401).json({ message: 'Invalid session.' }); return }
  const count = countId ? await InventoryCountModel.findOne({ _id: countId, storeId, status: { $ne: 'discarded' } }).lean() : null
  if (!count) { res.status(404).json({ message: 'Count not found.' }); return }
  res.json({ count: await countView(count, storeId) })
}

/**
 * Builds the saved items for a count. A product keeps the quantity the system expected when it was first counted; the expected
 * quantity is refreshed only when the counted number changes, because that is the moment the shelf was looked at.
 */
async function buildItems(storeId: mongoose.Types.ObjectId, inputs: CountInput[], existing: CountRecord['items']) {
  const products = await ProductModel.find({ _id: { $in: inputs.map((input) => input.productId) }, storeId, status: 'active' }).select('name unit currentStock').lean()
  const byId = new Map(products.map((product) => [product._id.toHexString(), product]))
  const before = new Map(existing.map((item) => [item.productId.toHexString(), item]))
  return inputs.map((input) => {
    const product = byId.get(input.productId.toHexString())
    if (!product) throw new OperationError('One of the products was not found.', 404)
    const previous = before.get(input.productId.toHexString())
    const expectedQuantity = previous && previous.countedQuantity === input.countedQuantity ? previous.expectedQuantity : product.currentStock
    return { productId: input.productId, productName: product.name, unit: product.unit, expectedQuantity, countedQuantity: input.countedQuantity, ...(input.reason ? { reason: input.reason } : {}) }
  })
}

export async function createCount(req: AuthenticatedRequest, res: Response): Promise<void> {
  const storeId = storeIdOf(req)
  if (!storeId) { res.status(401).json({ message: 'Invalid session.' }); return }
  const payload = (req.body ?? {}) as { name?: unknown; items?: unknown }
  const items = parseCountItems(payload.items ?? [])
  if (!items) { res.status(400).json({ message: `Count up to ${MAX_COUNT_ITEMS} different products with whole-number quantities of zero or more.` }); return }
  if (payload.name !== undefined && payload.name !== '' && cleanText(payload.name, 80) === null) { res.status(400).json({ message: 'Count name must be 80 characters or fewer.' }); return }
  const name = cleanText(payload.name, 80) ?? `Stock count ${new Date().toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' })}`
  try {
    const saved = await buildItems(storeId, items, [])
    const count = await InventoryCountModel.create({ storeId, userId: new mongoose.Types.ObjectId(req.user!.id), name, items: saved })
    res.status(201).json({ count: await countView(count.toObject() as unknown as CountRecord, storeId) })
  } catch (error) {
    sendFailure(res, error, 'The count could not be saved.')
  }
}

/** Saves progress on an open count by replacing its items. */
export async function saveCount(req: AuthenticatedRequest, res: Response): Promise<void> {
  const storeId = storeIdOf(req)
  const countId = parseObjectId(req.params.id)
  if (!storeId) { res.status(401).json({ message: 'Invalid session.' }); return }
  const payload = (req.body ?? {}) as { name?: unknown; items?: unknown }
  const items = parseCountItems(payload.items)
  if (!items) { res.status(400).json({ message: `Count up to ${MAX_COUNT_ITEMS} different products with whole-number quantities of zero or more.` }); return }
  if (payload.name !== undefined && cleanText(payload.name, 80) === null) { res.status(400).json({ message: 'Count name must be 1 to 80 characters.' }); return }
  const current = countId ? await InventoryCountModel.findOne({ _id: countId, storeId, status: 'open' }).lean() : null
  if (!current) { res.status(404).json({ message: 'Open count not found. It may have been applied or discarded.' }); return }
  try {
    const saved = await buildItems(storeId, items, current.items)
    const name = cleanText(payload.name, 80)
    // Only an open count can change, even if it was applied by another request while this one was being prepared.
    const updated = await InventoryCountModel.findOneAndUpdate({ _id: current._id, storeId, status: 'open' }, { $set: { items: saved, ...(name ? { name } : {}) } }, { returnDocument: 'after' }).lean()
    if (!updated) { res.status(409).json({ message: 'This count was already applied or discarded.' }); return }
    res.json({ count: await countView(updated, storeId) })
  } catch (error) {
    sendFailure(res, error, 'The count could not be saved.')
  }
}

export async function discardCount(req: AuthenticatedRequest, res: Response): Promise<void> {
  const storeId = storeIdOf(req)
  const countId = parseObjectId(req.params.id)
  if (!storeId) { res.status(401).json({ message: 'Invalid session.' }); return }
  const discarded = countId ? await InventoryCountModel.findOneAndUpdate({ _id: countId, storeId, status: 'open' }, { $set: { status: 'discarded' } }) : null
  if (!discarded) { res.status(404).json({ message: 'Open count not found.' }); return }
  res.json({ message: 'Count discarded. Stock was not changed.' })
}

/**
 * Applies a reviewed count. Each product changes by (counted - expected), added to the stock at that moment, so sales and deliveries
 * that happened after the count are kept instead of overwritten. A product that cannot absorb the change (it would go below zero)
 * stops the whole apply with a message, and nothing is changed. The count can be applied only once.
 */
export async function applyCount(req: AuthenticatedRequest, res: Response): Promise<void> {
  const storeId = storeIdOf(req)
  const countId = parseObjectId(req.params.id)
  if (!storeId) { res.status(401).json({ message: 'Invalid session.' }); return }
  if (!countId) { res.status(404).json({ message: 'Open count not found.' }); return }
  const userId = new mongoose.Types.ObjectId(req.user!.id)
  const session = await mongoose.startSession()
  try {
    let summary = { adjusted: 0, unchanged: 0, unitsAdded: 0, unitsRemoved: 0 }
    await session.withTransaction(async () => {
      summary = { adjusted: 0, unchanged: 0, unitsAdded: 0, unitsRemoved: 0 }
      // Claiming the count first is what makes a second apply (double click, two devices) fail instead of adjusting stock twice.
      const claimed = await InventoryCountModel.findOneAndUpdate({ _id: countId, storeId, status: 'open' }, { $set: { status: 'applied', appliedAt: new Date(), appliedBy: userId } }, { returnDocument: 'before', session }).lean()
      if (!claimed) throw new OperationError('This count was already applied or discarded.', 409)
      if (!claimed.items.length) throw new OperationError('There is nothing to apply. Count at least one product first.')
      for (const item of claimed.items) {
        const delta = item.countedQuantity - item.expectedQuantity
        if (delta === 0) { summary.unchanged += 1; continue }
        const result = await changeStock(session, { storeId, userId, productId: item.productId, delta, type: 'inventory_count', countId, reason: item.reason ?? 'Stock count', note: claimed.name })
        await recordAuditLog({ storeId, userId, event: 'INVENTORY_COUNT', resourceType: 'Product', resourceId: item.productId, metadata: { countedStock: item.countedQuantity, expectedStock: item.expectedQuantity, previousStock: result.previousStock, newStock: result.newStock } }, session)
        summary.adjusted += 1
        if (delta > 0) summary.unitsAdded += delta
        else summary.unitsRemoved += -delta
      }
      await recordAuditLog({ storeId, userId, event: 'INVENTORY_COUNT_APPLIED', resourceType: 'InventoryCount', resourceId: countId, metadata: { adjusted: summary.adjusted, unchanged: summary.unchanged, unitsAdded: summary.unitsAdded, unitsRemoved: summary.unitsRemoved } }, session)
    })
    res.json({ message: summary.adjusted ? `Count applied: ${summary.adjusted} ${summary.adjusted === 1 ? 'product' : 'products'} adjusted.` : 'Count applied. Every count matched the system, so nothing was adjusted.', summary })
  } catch (error) {
    sendFailure(res, error, 'The count could not be applied.')
  } finally {
    await session.endSession()
  }
}
