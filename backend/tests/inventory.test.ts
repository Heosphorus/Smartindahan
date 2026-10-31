import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'

import { AuditLogModel } from '../src/models/AuditLog.js'
import { InventoryTransactionModel } from '../src/models/InventoryTransaction.js'
import { ProductModel } from '../src/models/Product.js'
import { PurchaseModel } from '../src/models/Purchase.js'
import { SupplierModel } from '../src/models/Supplier.js'
import { baseQuantity, barcodeVariants, escapeRegex, roundCost, stockStatus } from '../src/utils/inventory.js'
import { api, createProduct, createStore, startTestServer, stopTestServer } from './helpers/testServer.js'

before(async () => { await startTestServer() }, { timeout: 300_000 })
after(async () => { await stopTestServer() })

type Store = Awaited<ReturnType<typeof createStore>>
type Message = { message: string }
type ProductRow = { _id: string; name: string; currentStock: number; costPrice: number; purchaseUnit?: string; unitsPerPurchaseUnit?: number }
type List = { products: ProductRow[]; pagination: { page: number; limit: number; total: number }; summary: { all: number; out: number; low: number }; categories: string[] }
type PurchaseBody = { message: string; replayed?: boolean; purchase: { id: string; total: number; items: Array<{ productId: string; added: number; previousStock: number; newStock: number; lineTotal: number }> } }
type CountBody = { count: { id: string; status: string; items: Array<{ productId: string; expectedQuantity: number; countedQuantity: number; difference: number; stockNow?: number | null; movedSinceCount?: number | null; reason: string }> } }

let keyCounter = 0
const key = () => `test-key-${Date.now()}-${(keyCounter += 1)}`
const stockOf = async (id: string) => (await ProductModel.findById(id).lean())!.currentStock
const packProduct = (token: string, overrides: Record<string, unknown> = {}) => createProduct(token, { name: 'Softdrink 1L', unit: 'piece', purchaseUnit: 'pack', unitsPerPurchaseUnit: 24, costPrice: 15, sellingPrice: 20, initialStock: 6, minStock: 10, ...overrides })
const restock = (store: Store, body: Record<string, unknown>) => api<PurchaseBody & Message>('/api/store/inventory/restock', { token: store.token, body: { idempotencyKey: key(), ...body } })

test('helpers: stock status, pack conversion, barcode spellings, literal search text and cost precision', () => {
  assert.equal(stockStatus(0, 5), 'out')
  assert.equal(stockStatus(5, 5), 'low')
  assert.equal(stockStatus(6, 5), 'ok')
  assert.equal(stockStatus(3, 0), 'ok', 'a product without an alert level is never "low"')
  assert.equal(baseQuantity(1, 24), 24)
  assert.equal(baseQuantity(0.5, 24), 12)
  assert.equal(baseQuantity(0.1, 30), 3, 'floating-point noise is tolerated')
  for (const [quantity, unitsPer] of [[0, 24], [-1, 24], [NaN, 24], [Infinity, 24], ['2', 24], [null, 24], [0.5, 1], [1.5, 1], [2_000_000, 1], [50_000, 24]] as const) {
    assert.equal(baseQuantity(quantity, unitsPer), null, `${String(quantity)} x ${unitsPer}`)
  }
  assert.deepEqual(barcodeVariants('012345678905'), ['012345678905', '0012345678905'])
  assert.deepEqual(barcodeVariants('0012345678905'), ['0012345678905', '012345678905'])
  assert.deepEqual(barcodeVariants('4801234567890'), ['4801234567890'])
  assert.equal(new RegExp(escapeRegex('a.c+(b)'), 'i').test('A.C+(B)'), true)
  assert.equal(new RegExp(escapeRegex('a.c'), 'i').test('abc'), false)
  assert.equal(roundCost(360 / 24), 15)
  assert.equal(roundCost(100 / 24), 4.1667)
})

test('product search finds products by name, SKU, barcode and brand, and treats the text literally', async () => {
  const store = await createStore()
  await createProduct(store.token, { name: 'Lucky Me Pancit Canton', brand: 'Lucky Me', sku: 'LM-001', barcode: '4807770270017', category: 'Noodles' })
  await createProduct(store.token, { name: 'Coke 1.5L', brand: 'Coca-Cola', sku: 'CK-15', barcode: '4801981100019', category: 'Beverages' })
  await createProduct(store.token, { name: 'A+B (special)', category: 'Misc' })
  const other = await createStore()
  await createProduct(other.token, { name: 'Lucky Me Other Store', barcode: '5000000000001' })

  const search = async (q: string) => (await api<List>(`/api/store/products?q=${encodeURIComponent(q)}`, { token: store.token })).body.products.map((product) => product.name)
  assert.deepEqual(await search('lucky'), ['Lucky Me Pancit Canton'], 'name, case-insensitive, and only this store')
  assert.deepEqual(await search('ck-15'), ['Coke 1.5L'], 'SKU')
  assert.deepEqual(await search('480198'), ['Coke 1.5L'], 'part of a barcode')
  assert.deepEqual(await search('coca'), ['Coke 1.5L'], 'brand')
  assert.deepEqual(await search('A+B ('), ['A+B (special)'], 'pattern characters are matched literally')
  assert.deepEqual(await search('1.5l'), ['Coke 1.5L'])
  assert.deepEqual(await search('1x5l'), [], 'a dot is not a wildcard')
  assert.deepEqual(await search('zzz'), [])
  assert.equal((await api('/api/store/products?q=' + 'x'.repeat(65), { token: store.token })).status, 400)
})

test('product list filters by category and stock status, reports counts, sorts and paginates', async () => {
  const store = await createStore()
  await createProduct(store.token, { name: 'Alpha', category: 'Snacks', initialStock: 0, minStock: 5 })
  await createProduct(store.token, { name: 'Bravo', category: 'Snacks', initialStock: 3, minStock: 5 })
  await createProduct(store.token, { name: 'Charlie', category: 'Drinks', initialStock: 5, minStock: 5 })
  await createProduct(store.token, { name: 'Delta', category: 'Drinks', initialStock: 20, minStock: 5 })
  await createProduct(store.token, { name: 'Echo', category: 'Drinks', initialStock: 2, minStock: 0 })
  const list = (query: string) => api<List>(`/api/store/products?${query}`, { token: store.token })
  const names = async (query: string) => (await list(query)).body.products.map((product) => product.name)

  assert.deepEqual(await names('status=out'), ['Alpha'])
  assert.deepEqual(await names('status=low'), ['Bravo', 'Charlie'], 'at or below the alert level, but not empty')
  assert.deepEqual(await names('status=ok'), ['Delta', 'Echo'], 'no alert level means it is never low')
  assert.deepEqual(await names('category=Drinks&status=low'), ['Charlie'])
  assert.deepEqual(await names('sort=stock'), ['Alpha', 'Echo', 'Bravo', 'Charlie', 'Delta'])
  const all = await list('')
  assert.deepEqual(all.body.summary, { all: 5, out: 1, low: 2 })
  assert.deepEqual(all.body.categories, ['Drinks', 'Snacks'])
  const filtered = await list('status=low')
  assert.deepEqual(filtered.body.summary, { all: 5, out: 1, low: 2 }, 'chips always count the whole store')

  const first = await list('limit=2&page=1')
  const second = await list('limit=2&page=3')
  assert.equal(first.body.pagination.total, 5)
  assert.deepEqual(first.body.products.map((product) => product.name), ['Alpha', 'Bravo'])
  assert.deepEqual(second.body.products.map((product) => product.name), ['Echo'])
  for (const bad of ['status=weird', 'sort=price', 'limit=101', 'page=0', 'category=' + 'x'.repeat(65)]) assert.equal((await list(bad)).status, 400, bad)
})

test('barcode lookup matches UPC-A and EAN-13 spellings, reports unknown and archived codes, and stays within the store', async () => {
  const store = await createStore()
  const other = await createStore()
  const product = await createProduct(store.token, { name: 'Imported Chips', barcode: '0012345678905' })
  await createProduct(other.token, { name: 'Their Chips', barcode: '4800000000011' })
  const lookup = (rawValue: unknown, token = store.token) => api<{ found: boolean; product?: { id: string; name: string }; archived?: { id: string; name: string }; message: string }>('/api/store/products/barcode/lookup', { token, body: { rawValue } })

  assert.equal((await lookup('0012345678905')).body.product?.name, 'Imported Chips')
  assert.equal((await lookup('012345678905')).body.product?.id, product._id, 'the 12-digit UPC-A form of the same code finds it')
  const unknown = await lookup('9999999999999')
  assert.equal(unknown.status, 404)
  assert.equal(unknown.body.found, false)
  assert.equal((await lookup('4800000000011')).status, 404, "another store's barcode is unknown here")
  for (const bad of ['', '   ', 'x'.repeat(65), 123, { $ne: '' }, null]) assert.equal((await lookup(bad)).status, 400, JSON.stringify(bad))

  await api(`/api/store/products/${product._id}`, { token: store.token, method: 'DELETE' })
  const archived = await lookup('0012345678905')
  assert.equal(archived.status, 404)
  assert.equal(archived.body.archived?.name, 'Imported Chips')
  assert.equal((await api(`/api/store/products/${product._id}/restore`, { token: other.token, body: {} })).status, 404, "another store cannot restore it")
  assert.equal((await api(`/api/store/products/${product._id}/restore`, { token: store.token, body: {} })).status, 200)
  assert.equal((await lookup('0012345678905')).status, 200)
  assert.equal(await AuditLogModel.countDocuments({ storeId: store.user._id, event: 'PRODUCT_RESTORED' }), 1)
})

test('a barcode can be used once per store, in either spelling, while another store may reuse it', async () => {
  const store = await createStore()
  const other = await createStore()
  await createProduct(store.token, { name: 'First', barcode: '012345678905' })
  const body = (barcode: string) => ({ name: 'Second', category: 'Test', costPrice: 1, sellingPrice: 2, barcode })
  const same = await api<Message>('/api/store/products', { token: store.token, body: body('012345678905') })
  assert.equal(same.status, 409)
  assert.match(same.body.message, /First/)
  assert.equal((await api('/api/store/products', { token: store.token, body: body('0012345678905') })).status, 409, 'the EAN-13 spelling of the same code')
  assert.equal((await api('/api/store/products', { token: other.token, body: body('012345678905') })).status, 201, 'another store is separate')

  const second = await createProduct(store.token, { name: 'Third' })
  const clash = await api<Message>(`/api/store/products/${second._id}`, { token: store.token, method: 'PATCH', body: { barcode: '0012345678905' } })
  assert.equal(clash.status, 409, 'editing onto a used barcode is refused, not a server error')
  assert.equal((await api(`/api/store/products/${second._id}`, { token: store.token, method: 'PATCH', body: { barcode: '4801234567890' } })).status, 200)

  const archivedFirst = await ProductModel.findOne({ storeId: store.user._id, name: 'First' })
  await api(`/api/store/products/${archivedFirst!._id}`, { token: store.token, method: 'DELETE' })
  const blocked = await api<Message>('/api/store/products', { token: store.token, body: body('012345678905') })
  assert.equal(blocked.status, 409)
  assert.match(blocked.body.message, /archived/)
})

test('pack setup is validated, can be cleared, and price changes are audited with old and new values', async () => {
  const store = await createStore()
  const product = await createProduct(store.token, { name: 'Water', sellingPrice: 15, costPrice: 10 })
  const patch = (body: Record<string, unknown>) => api<{ product: ProductRow } & Message>(`/api/store/products/${product._id}`, { token: store.token, method: 'PATCH', body })
  assert.equal((await patch({ purchaseUnit: 'case', unitsPerPurchaseUnit: 24 })).body.product.unitsPerPurchaseUnit, 24)
  for (const bad of [{ purchaseUnit: 'case' }, { unitsPerPurchaseUnit: 24 }, { purchaseUnit: 'case', unitsPerPurchaseUnit: 1 }, { purchaseUnit: 'case', unitsPerPurchaseUnit: 2.5 }, { purchaseUnit: 'case', unitsPerPurchaseUnit: '24' }, { purchaseUnit: 'case', unitsPerPurchaseUnit: 100001 }, { purchaseUnit: 'x'.repeat(33), unitsPerPurchaseUnit: 6 }]) {
    assert.equal((await patch(bad)).status, 400, JSON.stringify(bad))
  }
  assert.equal((await patch({ sellingPrice: 17.5, minStock: 12 })).status, 200)
  const audit = await AuditLogModel.findOne({ storeId: store.user._id, resourceId: product._id, 'metadata.sellingPriceAfter': 17.5 }).lean()
  assert.equal(audit?.metadata?.sellingPriceBefore, 15)
  assert.equal(audit?.metadata?.minStockAfter, 12)
  const cleared = await patch({ purchaseUnit: '', unitsPerPurchaseUnit: '' })
  assert.equal(cleared.status, 200)
  assert.equal(cleared.body.product.purchaseUnit, undefined)
  assert.equal((await api('/api/store/products', { token: store.token, body: { name: 'Bad pack', category: 'C', costPrice: 1, sellingPrice: 2, purchaseUnit: 'box' } })).status, 400)
})

test('restock converts packs to pieces, records the price paid and a purchase, and updates cost', async () => {
  const store = await createStore()
  const supplier = await SupplierModel.create({ storeId: store.user._id, name: 'ABC Distribution' })
  const product = await packProduct(store.token)
  const result = await restock(store, { supplierId: String(supplier._id), note: 'Monday delivery', items: [{ productId: product._id, quantity: 1, unit: 'purchase', unitCost: 360 }] })

  assert.equal(result.status, 201)
  assert.equal(result.body.purchase.total, 360)
  assert.deepEqual(result.body.purchase.items.map((item) => [item.added, item.previousStock, item.newStock]), [[24, 6, 30]])
  const saved = (await ProductModel.findById(product._id).lean())!
  assert.equal(saved.currentStock, 30)
  assert.equal(saved.costPrice, 15, '360 per pack of 24 is 15 per piece')
  const purchase = (await PurchaseModel.findById(result.body.purchase.id).lean())!
  assert.equal(purchase.supplierName, 'ABC Distribution')
  assert.deepEqual([purchase.items[0]!.receivedUnit, purchase.items[0]!.unitsPerReceivedUnit, purchase.items[0]!.unitCost, purchase.items[0]!.costPerBaseUnit], ['pack', 24, 360, 15])
  const movement = (await InventoryTransactionModel.findOne({ productId: product._id, type: 'stock_in', purchaseId: purchase._id }).lean())!
  assert.deepEqual([movement.quantity, movement.previousStock, movement.newStock, movement.unitCost, String(movement.supplierId)], [24, 6, 30, 15, String(supplier._id)])
  assert.equal(await AuditLogModel.countDocuments({ storeId: store.user._id, event: 'INVENTORY_PURCHASE' }), 1)

  // Changing the pack size later does not rewrite what was recorded for this delivery.
  await api(`/api/store/products/${product._id}`, { token: store.token, method: 'PATCH', body: { unitsPerPurchaseUnit: 12 } })
  assert.equal((await PurchaseModel.findById(purchase._id).lean())!.items[0]!.baseQuantity, 24)
})

test('restock in pieces, with a pack price that does not divide evenly, and the option to keep the current cost', async () => {
  const store = await createStore()
  const product = await packProduct(store.token, { costPrice: 9 })
  assert.equal((await restock(store, { updateProductCost: false, items: [{ productId: product._id, quantity: 10, unitCost: 14 }] })).status, 201)
  const kept = (await ProductModel.findById(product._id).lean())!
  assert.deepEqual([kept.currentStock, kept.costPrice], [16, 9], 'cost unchanged when asked to keep it')
  assert.equal((await restock(store, { items: [{ productId: product._id, quantity: 2, unit: 'purchase', unitCost: 100 }] })).status, 201)
  const after = (await ProductModel.findById(product._id).lean())!
  assert.deepEqual([after.currentStock, after.costPrice], [64, 4.1667])
  assert.equal((await PurchaseModel.findOne({ storeId: store.user._id }).sort({ createdAt: -1 }).lean())!.total, 200)
  assert.equal((await InventoryTransactionModel.countDocuments({ productId: product._id, type: 'stock_in', purchaseId: { $exists: true } })), 2)
})

test('restock rejects bad requests and changes nothing', async () => {
  const store = await createStore()
  const plain = await createProduct(store.token, { name: 'Plain item', initialStock: 5 })
  const pack = await packProduct(store.token)
  const supplier = await SupplierModel.create({ storeId: store.user._id, name: 'Local' })
  const line = (overrides: Record<string, unknown> = {}) => ({ productId: plain._id, quantity: 3, unitCost: 4, ...overrides })
  const attempts: Array<[string, Record<string, unknown>, number]> = [
    ['no items', { items: [] }, 400],
    ['zero quantity', { items: [line({ quantity: 0 })] }, 400],
    ['negative quantity', { items: [line({ quantity: -2 })] }, 400],
    ['text quantity', { items: [line({ quantity: '3' })] }, 400],
    ['missing cost', { items: [{ productId: plain._id, quantity: 3 }] }, 400],
    ['negative cost', { items: [line({ unitCost: -1 })] }, 400],
    ['odd unit', { items: [line({ unit: 'crate' })] }, 400],
    ['same product twice', { items: [line(), line()] }, 400],
    ['bad product id', { items: [line({ productId: 'nope' })] }, 400],
    ['bad supplier id', { supplierId: 'nope', items: [line()] }, 400],
    ['pack unit on a product with no pack', { items: [line({ unit: 'purchase' })] }, 400],
    ['a fraction of a piece', { items: [line({ quantity: 1.5 })] }, 400],
    ['half a piece from a pack', { items: [{ productId: pack._id, quantity: 0.01, unit: 'purchase', unitCost: 100 }] }, 400],
    ['too many', { items: [line({ quantity: 2_000_000 })] }, 400],
    ['unknown product', { items: [line({ productId: '64b000000000000000000000' })] }, 404],
    ['unknown supplier', { supplierId: '64b000000000000000000000', items: [line()] }, 404],
    ['long note', { note: 'x'.repeat(201), items: [line()] }, 400],
  ]
  for (const [label, body, status] of attempts) assert.equal((await restock(store, body)).status, status, label)
  assert.equal((await api('/api/store/inventory/restock', { token: store.token, body: { items: [line()] } })).status, 400, 'a request key is required')
  assert.equal((await api('/api/store/inventory/restock', { token: store.token, body: { idempotencyKey: 'short', items: [line()] } })).status, 400)
  assert.equal((await api('/api/store/inventory/restock', { body: { idempotencyKey: key(), items: [line()] } })).status, 401)
  assert.equal(await stockOf(plain._id), 5)
  assert.equal(await PurchaseModel.countDocuments({ storeId: store.user._id }), 0)
  assert.equal(await InventoryTransactionModel.countDocuments({ storeId: store.user._id, purchaseId: { $exists: true } }), 0)
  void supplier
})

test('a restock where a later line fails is rolled back completely', async () => {
  const store = await createStore()
  const first = await createProduct(store.token, { name: 'First', initialStock: 5 })
  const second = await createProduct(store.token, { name: 'Second', initialStock: 5 })
  await api(`/api/store/products/${second._id}`, { token: store.token, method: 'DELETE' })
  const result = await restock(store, { items: [{ productId: first._id, quantity: 10, unitCost: 3 }, { productId: second._id, quantity: 10, unitCost: 3 }] })
  assert.equal(result.status, 404)
  assert.equal(await stockOf(first._id), 5, 'the first line was not kept')
  assert.equal(await PurchaseModel.countDocuments({ storeId: store.user._id }), 0)
  assert.equal(await InventoryTransactionModel.countDocuments({ storeId: store.user._id, productId: first._id, type: 'stock_in', purchaseId: { $exists: true } }), 0)
  assert.equal(await AuditLogModel.countDocuments({ storeId: store.user._id, event: 'INVENTORY_PURCHASE' }), 0)
})

test('submitting the same restock twice, one after the other or at once, adds the stock once', async () => {
  const store = await createStore()
  const product = await createProduct(store.token, { name: 'Twice', initialStock: 0 })
  const body = { idempotencyKey: 'retry-key-sequential', items: [{ productId: product._id, quantity: 12, unitCost: 5 }] }
  const first = await api<PurchaseBody>('/api/store/inventory/restock', { token: store.token, body })
  const again = await api<PurchaseBody>('/api/store/inventory/restock', { token: store.token, body })
  assert.deepEqual([first.status, again.status, again.body.replayed, again.body.purchase.id], [201, 200, true, first.body.purchase.id])
  assert.equal(await stockOf(product._id), 12)

  const racing = { idempotencyKey: 'retry-key-parallel', items: [{ productId: product._id, quantity: 7, unitCost: 5 }] }
  const results = await Promise.all(Array.from({ length: 5 }, () => api<PurchaseBody>('/api/store/inventory/restock', { token: store.token, body: racing })))
  assert.ok(results.every((result) => result.status === 200 || result.status === 201), results.map((result) => result.status).join())
  assert.equal(results.filter((result) => result.status === 201).length, 1)
  assert.equal(await stockOf(product._id), 19)
  assert.equal(await PurchaseModel.countDocuments({ storeId: store.user._id }), 2)

  const different = await api<Message>('/api/store/inventory/restock', { token: store.token, body: { idempotencyKey: 'retry-key-sequential', items: [{ productId: product._id, quantity: 99, unitCost: 5 }] } })
  assert.equal(different.status, 409, 'a key reused for different items is refused')
  assert.equal(await stockOf(product._id), 19)
})

test('restocking is limited to the signed-in store, including its suppliers', async () => {
  const store = await createStore()
  const other = await createStore()
  const theirs = await createProduct(other.token, { name: 'Theirs', initialStock: 4 })
  const mine = await createProduct(store.token, { name: 'Mine', initialStock: 4 })
  const theirSupplier = await SupplierModel.create({ storeId: other.user._id, name: 'Their supplier' })
  assert.equal((await restock(store, { items: [{ productId: theirs._id, quantity: 5, unitCost: 1 }] })).status, 404)
  assert.equal((await restock(store, { supplierId: String(theirSupplier._id), items: [{ productId: mine._id, quantity: 5, unitCost: 1 }] })).status, 404)
  assert.equal(await stockOf(theirs._id), 4)
  assert.equal(await stockOf(mine._id), 4)
  const archivedSupplier = await SupplierModel.create({ storeId: store.user._id, name: 'Gone', isDeleted: true })
  assert.equal((await restock(store, { supplierId: String(archivedSupplier._id), items: [{ productId: mine._id, quantity: 5, unitCost: 1 }] })).status, 404)
})

test('concurrent sales and deliveries never lose or invent stock, and the history adds up', async () => {
  const store = await createStore()
  const product = await createProduct(store.token, { name: 'Busy item', initialStock: 100 })
  const sales = Array.from({ length: 12 }, (_, index) => api('/api/store/sales/checkout', { token: store.token, body: { items: [{ productId: product._id, quantity: 2 }], idempotencyKey: `sale-key-${index}-${keyCounter}` } }))
  const deliveries = Array.from({ length: 8 }, () => restock(store, { items: [{ productId: product._id, quantity: 5, unitCost: 8 }] }))
  const removals = Array.from({ length: 4 }, () => api('/api/store/inventory/stock-out', { token: store.token, body: { productId: product._id, quantity: 3, reason: 'Damaged' } }))
  const results = await Promise.all([...sales, ...deliveries, ...removals])
  assert.ok(results.every((result) => result.status === 200 || result.status === 201), results.map((result) => result.status).join())
  const final = await stockOf(product._id)
  assert.equal(final, 100 - 12 * 2 + 8 * 5 - 4 * 3)
  const movements = await InventoryTransactionModel.find({ productId: product._id }).sort({ _id: 1 }).lean()
  // The history starts with the +100 recorded when the product was created, so it adds up to the stock on hand.
  assert.equal(movements.length, 1 + 12 + 8 + 4)
  assert.equal(movements.reduce((sum, movement) => sum + movement.quantity, 0), final, 'the movements account for all the stock')
  assert.ok(movements.every((movement) => movement.newStock - movement.previousStock === movement.quantity), 'each movement is internally consistent')})

test('a sale cannot take more than is in stock, even across several lines, and leaves no partial change', async () => {
  const store = await createStore()
  const plenty = await createProduct(store.token, { name: 'Plenty', initialStock: 10 })
  const scarce = await createProduct(store.token, { name: 'Scarce', initialStock: 1 })
  const sale = await api<Message>('/api/store/sales/checkout', { token: store.token, body: { items: [{ productId: plenty._id, quantity: 4 }, { productId: scarce._id, quantity: 2 }] } })
  assert.equal(sale.status, 409)
  assert.equal(await stockOf(plenty._id), 10, 'the first line was not deducted')
  assert.equal(await InventoryTransactionModel.countDocuments({ storeId: store.user._id, type: 'sale' }), 0)
  const ok = await api('/api/store/sales/checkout', { token: store.token, body: { items: [{ productId: plenty._id, quantity: 4 }], idempotencyKey: 'sale-exact-once' } })
  const replay = await api('/api/store/sales/checkout', { token: store.token, body: { items: [{ productId: plenty._id, quantity: 4 }], idempotencyKey: 'sale-exact-once' } })
  assert.deepEqual([ok.status, replay.status], [201, 200])
  assert.equal(await stockOf(plenty._id), 6, 'a repeated sale is deducted once')
  const movement = await InventoryTransactionModel.findOne({ productId: plenty._id, type: 'sale' }).lean()
  assert.deepEqual([movement!.quantity, movement!.previousStock, movement!.newStock], [-4, 10, 6])
})

test('stock-in and stock-out validate input, refuse overdrafts, and are not applied twice for one key', async () => {
  const store = await createStore()
  const product = await createProduct(store.token, { name: 'Counter item', initialStock: 10 })
  const out = (body: Record<string, unknown>) => api<Message & { product?: { currentStock: number } }>('/api/store/inventory/stock-out', { token: store.token, body: { productId: product._id, ...body } })
  assert.equal((await out({ quantity: 11, reason: 'Lost' })).status, 409)
  assert.equal((await out({ quantity: 2, reason: 'Because' })).status, 400)
  assert.equal((await out({ quantity: 2.5 })).status, 400)
  assert.equal((await out({ quantity: 2, note: 'x'.repeat(201) })).status, 400)
  assert.equal((await out({ quantity: 2, idempotencyKey: 'bad key!' })).status, 400)
  assert.equal(await stockOf(product._id), 10)
  const first = await out({ quantity: 4, reason: 'Expired', note: 'past date', idempotencyKey: 'stock-out-once' })
  const again = await out({ quantity: 4, reason: 'Expired', idempotencyKey: 'stock-out-once' })
  assert.deepEqual([first.status, again.status, again.body.product?.currentStock], [201, 200, 6])
  assert.equal(await stockOf(product._id), 6)
  const movement = await InventoryTransactionModel.findOne({ productId: product._id, type: 'stock_out' }).lean()
  assert.deepEqual([movement!.reason, movement!.note, movement!.quantity], ['Expired', 'past date', -4])
  // The last of the stock can be removed, but not one more.
  assert.equal((await out({ quantity: 6, reason: 'Other' })).status, 201)
  assert.equal((await out({ quantity: 1 })).status, 409)

  const inBody = (items: unknown[], extra: Record<string, unknown> = {}) => api<Message>('/api/store/inventory/stock-in', { token: store.token, body: { items, ...extra } })
  assert.equal((await inBody([{ productId: product._id, quantity: 5 }, { productId: product._id, quantity: 5 }])).status, 400, 'the same product twice')
  assert.equal((await inBody([{ productId: product._id, quantity: 5 }], { idempotencyKey: 'stock-in-once' })).status, 201)
  assert.equal((await inBody([{ productId: product._id, quantity: 5 }], { idempotencyKey: 'stock-in-once' })).status, 200)
  assert.equal(await stockOf(product._id), 5)
})

test('inventory counts keep the quantity the system expected, so a sale made after counting is not overwritten', async () => {
  const store = await createStore()
  const product = await createProduct(store.token, { name: 'Counted item', initialStock: 20 })
  const created = await api<CountBody>('/api/store/inventory/counts', { token: store.token, body: { name: 'Aisle 1', items: [{ productId: product._id, countedQuantity: 17, reason: 'Damaged' }] } })
  assert.equal(created.status, 201)
  assert.deepEqual([created.body.count.items[0]!.expectedQuantity, created.body.count.items[0]!.countedQuantity, created.body.count.items[0]!.difference], [20, 17, -3])
  assert.equal(await stockOf(product._id), 20, 'saving a count changes no stock')

  // Five are sold while the count is waiting for review.
  assert.equal((await api('/api/store/sales/checkout', { token: store.token, body: { items: [{ productId: product._id, quantity: 5 }] } })).status, 201)
  const review = await api<CountBody>(`/api/store/inventory/counts/${created.body.count.id}`, { token: store.token })
  assert.deepEqual([review.body.count.items[0]!.stockNow, review.body.count.items[0]!.movedSinceCount], [15, -5], 'the review shows what moved since counting')

  const applied = await api<Message & { summary: { adjusted: number; unitsRemoved: number } }>(`/api/store/inventory/counts/${created.body.count.id}/apply`, { token: store.token, body: {} })
  assert.equal(applied.status, 200)
  assert.deepEqual([applied.body.summary.adjusted, applied.body.summary.unitsRemoved], [1, 3])
  assert.equal(await stockOf(product._id), 12, '20 - 5 sold - 3 missing: the sale is kept')
  const movement = (await InventoryTransactionModel.findOne({ productId: product._id, type: 'inventory_count' }).lean())!
  assert.deepEqual([movement.quantity, movement.previousStock, movement.newStock, movement.reason, String(movement.countId)], [-3, 15, 12, 'Damaged', created.body.count.id])
  assert.equal(await AuditLogModel.countDocuments({ storeId: store.user._id, event: 'INVENTORY_COUNT_APPLIED' }), 1)

  const again = await api<Message>(`/api/store/inventory/counts/${created.body.count.id}/apply`, { token: store.token, body: {} })
  assert.equal(again.status, 409)
  assert.equal(await stockOf(product._id), 12, 'applying twice does not adjust twice')
  assert.equal((await api(`/api/store/inventory/counts/${created.body.count.id}`, { token: store.token, method: 'PUT', body: { items: [] } })).status, 404, 'an applied count is closed')
})

test('applying the same count from two devices at once adjusts stock once', async () => {
  const store = await createStore()
  const product = await createProduct(store.token, { name: 'Double apply', initialStock: 10 })
  const created = await api<CountBody>('/api/store/inventory/counts', { token: store.token, body: { items: [{ productId: product._id, countedQuantity: 14 }] } })
  const results = await Promise.all(Array.from({ length: 4 }, () => api(`/api/store/inventory/counts/${created.body.count.id}/apply`, { token: store.token, body: {} })))
  assert.equal(results.filter((result) => result.status === 200).length, 1, results.map((result) => result.status).join())
  assert.ok(results.every((result) => result.status === 200 || result.status === 409))
  assert.equal(await stockOf(product._id), 14)
  assert.equal(await InventoryTransactionModel.countDocuments({ productId: product._id, type: 'inventory_count' }), 1)
})

test('saving a count refreshes the expected quantity only for products whose counted number changed', async () => {
  const store = await createStore()
  const steady = await createProduct(store.token, { name: 'Steady', initialStock: 10 })
  const recount = await createProduct(store.token, { name: 'Recount', initialStock: 10 })
  const created = await api<CountBody>('/api/store/inventory/counts', { token: store.token, body: { items: [{ productId: steady._id, countedQuantity: 9 }, { productId: recount._id, countedQuantity: 9 }] } })
  await api('/api/store/inventory/stock-in', { token: store.token, body: { items: [{ productId: steady._id, quantity: 5 }, { productId: recount._id, quantity: 5 }] } })
  const saved = await api<CountBody>(`/api/store/inventory/counts/${created.body.count.id}`, { token: store.token, method: 'PUT', body: { items: [{ productId: steady._id, countedQuantity: 9 }, { productId: recount._id, countedQuantity: 14, reason: 'Recounted' }] } })
  const byId = Object.fromEntries(saved.body.count.items.map((item) => [item.productId, item]))
  assert.equal(byId[steady._id]!.expectedQuantity, 10, 'untouched line keeps its original snapshot')
  assert.equal(byId[recount._id]!.expectedQuantity, 15, 'a recounted line is compared with the stock at that time')
  assert.equal(byId[recount._id]!.difference, -1)
  assert.equal(byId[recount._id]!.reason, 'Recounted')
})

test('a count that cannot be applied safely changes nothing and stays open for correction', async () => {
  const store = await createStore()
  const fine = await createProduct(store.token, { name: 'Fine', initialStock: 10 })
  const sold = await createProduct(store.token, { name: 'Sold out', initialStock: 10 })
  const created = await api<CountBody>('/api/store/inventory/counts', { token: store.token, body: { items: [{ productId: fine._id, countedQuantity: 12 }, { productId: sold._id, countedQuantity: 4 }] } })
  // All ten were sold after counting, so removing six more would go below zero.
  assert.equal((await api('/api/store/sales/checkout', { token: store.token, body: { items: [{ productId: sold._id, quantity: 10 }] } })).status, 201)
  const blocked = await api<Message>(`/api/store/inventory/counts/${created.body.count.id}/apply`, { token: store.token, body: {} })
  assert.equal(blocked.status, 409)
  assert.match(blocked.body.message, /Sold out/)
  assert.equal(await stockOf(fine._id), 10, 'the adjustment that could have been applied was not')
  assert.equal(await InventoryTransactionModel.countDocuments({ storeId: store.user._id, type: 'inventory_count' }), 0)
  const stillOpen = await api<CountBody>(`/api/store/inventory/counts/${created.body.count.id}`, { token: store.token })
  assert.equal(stillOpen.body.count.status, 'open')
  const fixed = await api<CountBody>(`/api/store/inventory/counts/${created.body.count.id}`, { token: store.token, method: 'PUT', body: { items: [{ productId: fine._id, countedQuantity: 12 }, { productId: sold._id, countedQuantity: 0 }] } })
  assert.equal(fixed.status, 200)
  assert.equal((await api(`/api/store/inventory/counts/${created.body.count.id}/apply`, { token: store.token, body: {} })).status, 200)
  assert.equal(await stockOf(fine._id), 12)
  assert.equal(await stockOf(sold._id), 0)
})

test('counts can be listed, discarded without changing stock, and are validated', async () => {
  const store = await createStore()
  const product = await createProduct(store.token, { name: 'Listed', initialStock: 6 })
  const matching = await api<CountBody>('/api/store/inventory/counts', { token: store.token, body: { items: [{ productId: product._id, countedQuantity: 6 }] } })
  const discarded = await api<CountBody>('/api/store/inventory/counts', { token: store.token, body: { name: 'Throw away', items: [{ productId: product._id, countedQuantity: 1 }] } })
  const listed = await api<{ counts: Array<{ id: string; name: string; itemCount: number; discrepancies: number }> }>('/api/store/inventory/counts?status=open', { token: store.token })
  assert.equal(listed.body.counts.length, 2)
  assert.deepEqual(listed.body.counts.find((count) => count.id === discarded.body.count.id)?.discrepancies, 1)
  assert.equal((await api(`/api/store/inventory/counts/${discarded.body.count.id}/discard`, { token: store.token, body: {} })).status, 200)
  assert.equal((await api(`/api/store/inventory/counts/${discarded.body.count.id}/apply`, { token: store.token, body: {} })).status, 409)
  assert.equal(await stockOf(product._id), 6)
  const applied = await api<Message & { summary: { adjusted: number; unchanged: number } }>(`/api/store/inventory/counts/${matching.body.count.id}/apply`, { token: store.token, body: {} })
  assert.deepEqual([applied.body.summary.adjusted, applied.body.summary.unchanged], [0, 1], 'a count that matches changes nothing and records no movement')
  assert.equal(await InventoryTransactionModel.countDocuments({ productId: product._id, type: 'inventory_count' }), 0)
  assert.equal((await api('/api/store/inventory/counts?status=weird', { token: store.token })).status, 400)

  for (const bad of [{ items: [{ productId: product._id, countedQuantity: -1 }] }, { items: [{ productId: product._id, countedQuantity: 1.5 }] }, { items: [{ productId: product._id, countedQuantity: '3' }] }, { items: [{ productId: 'nope', countedQuantity: 1 }] }, { items: [{ productId: product._id, countedQuantity: 1 }, { productId: product._id, countedQuantity: 2 }] }, { items: 'all' }, { name: 'x'.repeat(81), items: [] }, { items: [{ productId: product._id, countedQuantity: 1, reason: 'x'.repeat(121) }] }]) {
    assert.equal((await api('/api/store/inventory/counts', { token: store.token, body: bad })).status, 400, JSON.stringify(bad))
  }
  assert.equal((await api('/api/store/inventory/counts', { token: store.token, body: { items: [{ productId: '64b000000000000000000000', countedQuantity: 1 }] } })).status, 404)
  const empty = await api<CountBody>('/api/store/inventory/counts', { token: store.token, body: {} })
  assert.equal(empty.status, 201)
  assert.equal((await api(`/api/store/inventory/counts/${empty.body.count.id}/apply`, { token: store.token, body: {} })).status, 400, 'an empty count has nothing to apply')
})

test('counts, restocks and stock history belong to one store', async () => {
  const store = await createStore()
  const other = await createStore()
  const product = await createProduct(store.token, { name: 'Private', initialStock: 8 })
  const theirProduct = await createProduct(other.token, { name: 'Theirs', initialStock: 8 })
  const count = await api<CountBody>('/api/store/inventory/counts', { token: store.token, body: { items: [{ productId: product._id, countedQuantity: 5 }] } })
  const id = count.body.count.id
  for (const [method, path, body] of [['GET', ''], ['PUT', '', { items: [] }], ['POST', '/apply', {}], ['POST', '/discard', {}]] as Array<[string, string, unknown?]>) {
    const result = await api(`/api/store/inventory/counts/${id}${path}`, { token: other.token, method, ...(body !== undefined ? { body } : {}) })
    assert.ok(result.status === 404 || result.status === 409, `${method} ${path} -> ${result.status}`)
  }
  assert.equal(((await api<{ counts: unknown[] }>('/api/store/inventory/counts', { token: other.token })).body).counts.length, 0)
  assert.equal((await api('/api/store/inventory/counts', { token: other.token, body: { items: [{ productId: product._id, countedQuantity: 1 }] } })).status, 404)
  assert.equal(await stockOf(product._id), 8)
  assert.equal((await api('/api/store/inventory/counts', {})).status, 401)

  await api('/api/store/inventory/stock-in', { token: store.token, body: { items: [{ productId: product._id, quantity: 2 }] } })
  const history = await api<{ movements: Array<{ productId: string; type: string; quantity: number }>; pagination: { total: number } }>(`/api/store/inventory/movements?productId=${product._id}`, { token: store.token })
  assert.deepEqual(history.body.movements.map((movement) => [movement.type, movement.quantity]), [['stock_in', 2], ['stock_in', 8]])
  const spied = await api<{ movements: unknown[] }>(`/api/store/inventory/movements?productId=${theirProduct._id}`, { token: store.token })
  assert.equal(spied.body.movements.length, 0, "another store's history is not visible")
  assert.equal((await api('/api/store/inventory/movements?productId=nope', { token: store.token })).status, 400)
})

test('the single-product count (used by the product form) adds the difference to the current stock, so a sale in between is kept', async () => {
  const store = await createStore()
  const product = await createProduct(store.token, { name: 'Form count', initialStock: 10 })
  await api('/api/store/sales/checkout', { token: store.token, body: { items: [{ productId: product._id, quantity: 3 }] } })
  // The person saw 10 and typed 8 (two missing); the three sold in the meantime are not forgotten.
  const result = await api('/api/store/inventory/count', { token: store.token, body: { counts: [{ productId: product._id, scannedQuantity: 8, expectedQuantity: 10 }] } })
  assert.equal(result.status, 201)
  assert.equal(await stockOf(product._id), 5)
  const unchanged = await api('/api/store/inventory/count', { token: store.token, body: { counts: [{ productId: product._id, scannedQuantity: 5 }] } })
  assert.equal(unchanged.status, 201)
  assert.equal(await InventoryTransactionModel.countDocuments({ productId: product._id, type: 'inventory_count' }), 1, 'no movement when nothing changed')
  assert.equal((await api('/api/store/inventory/count', { token: store.token, body: { counts: [{ productId: product._id, scannedQuantity: 1, expectedQuantity: -2 }] } })).status, 400)
  assert.equal((await api('/api/store/inventory/count', { token: store.token, body: { counts: [{ productId: product._id, scannedQuantity: 0, expectedQuantity: 99 }] } })).status, 409, 'the change would take stock below zero')
  assert.equal(await stockOf(product._id), 5)
})
