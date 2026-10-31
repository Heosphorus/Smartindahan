import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'

import { AuditLogModel } from '../src/models/AuditLog.js'
import { InventoryTransactionModel } from '../src/models/InventoryTransaction.js'
import { ProductModel } from '../src/models/Product.js'
import { api, createStore, startTestServer, stopTestServer } from './helpers/testServer.js'

before(async () => { await startTestServer() }, { timeout: 300_000 })
after(async () => { await stopTestServer() })

type Bulk = { message: string; products: Array<{ _id: string; name: string; costPrice: number; sellingPrice: number; currentStock: number; minStock: number; brand?: string; unit: string }> }

test('bulk add applies the shared price, stock and brand to every product, and cost is optional', async () => {
  const store = await createStore()
  const result = await api<Bulk>('/api/store/products/bulk', {
    token: store.token,
    body: { names: ['Canned sardines', 'Instant noodles', 'canned sardines'.replace('c', 'C')], category: 'Canned goods', unit: 'can', brand: 'Ligo', sellingPrice: 25, initialStock: 12, minStock: 4 },
  })
  assert.equal(result.status, 201)
  assert.equal(result.body.message, '2 products added.', 'a repeated name is added once')
  for (const product of result.body.products) {
    assert.equal(product.sellingPrice, 25)
    assert.equal(product.costPrice, 0, 'cost left out is stored as 0')
    assert.equal(product.currentStock, 12)
    assert.equal(product.minStock, 4)
    assert.equal(product.brand, 'Ligo')
    assert.equal(product.unit, 'can')
  }
  const stocked = await InventoryTransactionModel.find({ productId: { $in: result.body.products.map((product) => product._id) } }).lean()
  assert.equal(stocked.length, 2, 'starting stock is recorded in the stock history like a single add')
  assert.ok(stocked.every((entry) => entry.type === 'stock_in' && entry.quantity === 12 && entry.newStock === 12))
  const audits = await AuditLogModel.countDocuments({ event: 'PRODUCT_CREATED', resourceId: { $in: result.body.products.map((product) => product._id) } })
  assert.equal(audits, 2)
})

test('an optional cost is stored when given, and old clients that send only names still work', async () => {
  const store = await createStore()
  const priced = await api<Bulk>('/api/store/products/bulk', { token: store.token, body: { names: ['Coke 8 oz'], category: 'Beverages', costPrice: 10, sellingPrice: 13 } })
  assert.equal(priced.status, 201)
  assert.equal(priced.body.products[0]!.costPrice, 10)
  assert.equal(priced.body.products[0]!.currentStock, 0)

  const legacy = await api<Bulk>('/api/store/products/bulk', { token: store.token, body: { names: ['Old style item'], category: 'Misc', unit: 'piece' } })
  assert.equal(legacy.status, 201)
  assert.equal(legacy.body.products[0]!.sellingPrice, 0)
  assert.equal(await InventoryTransactionModel.countDocuments({ productId: legacy.body.products[0]!._id }), 0, 'no stock history when there is no starting stock')
})

test('each item can carry its own selling price, and the default fills in for the rest', async () => {
  const store = await createStore()
  const result = await api<Bulk>('/api/store/products/bulk', {
    token: store.token,
    body: { items: [{ name: 'Safeguard Soap', sellingPrice: 20 }, { name: 'Coke Mismo', sellingPrice: 12.5 }, { name: 'Nido, 400g' }, { name: 'Safeguard Soap', sellingPrice: 99 }], category: 'Groceries', sellingPrice: 30, initialStock: 6 },
  })
  assert.equal(result.status, 201)
  assert.equal(result.body.message, '3 products added.', 'a repeated name is added once, keeping its first price')
  const priceOf = (name: string) => result.body.products.find((product) => product.name === name)?.sellingPrice
  assert.equal(priceOf('Safeguard Soap'), 20)
  assert.equal(priceOf('Coke Mismo'), 12.5)
  assert.equal(priceOf('Nido, 400g'), 30)
  assert.ok(result.body.products.every((product) => product.currentStock === 6), 'stock is still shared')

  const noDefault = await api<Bulk>('/api/store/products/bulk', { token: store.token, body: { items: [{ name: 'Priced only', sellingPrice: 8 }, { name: 'No price anywhere' }], category: 'Groceries' } })
  assert.equal(noDefault.status, 201)
  assert.equal(noDefault.body.products.find((product) => product.name === 'No price anywhere')?.sellingPrice, 0, 'older behaviour: no price at all is stored as 0')
})

test('a bad price on one item rejects the whole batch', async () => {
  const store = await createStore()
  const before = await ProductModel.countDocuments({ storeId: store.user._id })
  for (const items of [
    [{ name: 'A', sellingPrice: 5 }, { name: 'B', sellingPrice: -1 }],
    [{ name: 'A', sellingPrice: '5' }],
    [{ name: 'A', sellingPrice: null }],
    [{ name: 'A'.repeat(65), sellingPrice: 5 }],
  ]) {
    const response = await api('/api/store/products/bulk', { token: store.token, body: { items, category: 'X', sellingPrice: 5 } })
    assert.equal(response.status, 400, `expected 400 for ${JSON.stringify(items).slice(0, 80)}`)
  }
  assert.equal(await ProductModel.countDocuments({ storeId: store.user._id }), before)
})

test('bulk add rejects bad numbers and over-long names without creating anything', async () => {
  const store = await createStore()
  const before = await ProductModel.countDocuments({ storeId: store.user._id })
  const bad = [
    { names: ['A'], category: 'X', sellingPrice: -1 },
    { names: ['A'], category: 'X', sellingPrice: '12' },
    { names: ['A'], category: 'X', sellingPrice: 5, costPrice: -2 },
    { names: ['A'], category: 'X', sellingPrice: 5, initialStock: 1.5 },
    { names: ['A'], category: 'X', sellingPrice: 5, minStock: -1 },
    { names: ['A', 'B'.repeat(65)], category: 'X', sellingPrice: 5 },
    { names: ['A'], category: 'X', sellingPrice: 5, brand: 'b'.repeat(65) },
  ]
  for (const body of bad) {
    const response = await api('/api/store/products/bulk', { token: store.token, body })
    assert.ok(response.status === 400, `expected 400 for ${JSON.stringify(body).slice(0, 80)} but got ${response.status}`)
  }
  assert.equal(await ProductModel.countDocuments({ storeId: store.user._id }), before)
})

test('bulk add only ever writes to the signed-in store and needs a session', async () => {
  const mine = await createStore()
  const other = await createStore()
  assert.equal((await api('/api/store/products/bulk', { body: { names: ['A'], category: 'X' } })).status, 401)
  const result = await api<Bulk>('/api/store/products/bulk', { token: mine.token, body: { names: ['Mine only'], category: 'X', sellingPrice: 5, storeId: other.id } })
  assert.equal(result.status, 201)
  assert.equal(await ProductModel.countDocuments({ storeId: other.user._id }), 0, 'a forged storeId in the body is ignored')
  assert.equal(await ProductModel.countDocuments({ storeId: mine.user._id }), 1)
})
