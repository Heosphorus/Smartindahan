import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'

import { AuditLogModel } from '../src/models/AuditLog.js'
import { ProductModel } from '../src/models/Product.js'
import { applyAdjustment, parseAdjustment } from '../src/utils/priceAdjustment.js'
import { api, createStore, startTestServer, stopTestServer } from './helpers/testServer.js'

before(async () => { await startTestServer() }, { timeout: 300_000 })
after(async () => { await stopTestServer() })

type Store = Awaited<ReturnType<typeof createStore>>
type Result = { message: string; updated?: number; skipped?: number; archived?: number }

async function stock(store: Store) {
  const products = await ProductModel.insertMany([
    { storeId: store.user._id, name: 'Coke', category: 'Drinks', costPrice: 10, sellingPrice: 20 },
    { storeId: store.user._id, name: 'Pepsi', category: 'Drinks', costPrice: 11.5, sellingPrice: 19.99 },
    { storeId: store.user._id, name: 'Soap', category: 'Home', costPrice: 5, sellingPrice: 8 },
  ])
  return products.map((product) => String(product._id))
}
const prices = async (store: Store) => Object.fromEntries((await ProductModel.find({ storeId: store.user._id }).lean()).map((product) => [product.name, [product.costPrice, product.sellingPrice]]))

test('price adjustments: set, percent and amount, rounded to centavos and never below zero', () => {
  assert.equal(applyAdjustment(20, { type: 'set', value: 25.5 }), 25.5)
  assert.equal(applyAdjustment(20, { type: 'percent', value: 10 }), 22)
  assert.equal(applyAdjustment(19.99, { type: 'percent', value: 10 }), 21.99)
  assert.equal(applyAdjustment(20, { type: 'percent', value: -100 }), 0)
  assert.equal(applyAdjustment(20, { type: 'amount', value: -5.25 }), 14.75)
  assert.equal(applyAdjustment(3, { type: 'amount', value: -5 }), null, 'would be negative')
  assert.equal(applyAdjustment(99_999_999, { type: 'amount', value: 100 }), null, 'would be too large')
})

test('adjustments are only read from well-formed input', () => {
  assert.deepEqual(parseAdjustment({ type: 'percent', value: -10 }), { type: 'percent', value: -10 })
  for (const bad of [null, 'x', {}, { type: 'set', value: -1 }, { type: 'set', value: '5' }, { type: 'percent', value: -101 }, { type: 'percent', value: 1001 }, { type: 'amount', value: Infinity }, { type: 'multiply', value: 2 }, { type: 'set', value: null }]) {
    assert.equal(parseAdjustment(bad), null, JSON.stringify(bad))
  }
})

test('batch update changes selling price and cost together for the chosen products only, and is audited', async () => {
  const store = await createStore()
  const [coke, pepsi] = await stock(store)
  const result = await api<Result>('/api/store/products/batch-update', { token: store.token, body: { ids: [coke, pepsi, coke], sellingPrice: { type: 'percent', value: 10 }, costPrice: { type: 'amount', value: 1 } } })
  assert.equal(result.status, 200)
  assert.equal(result.body.updated, 2)
  assert.deepEqual(await prices(store), { Coke: [11, 22], Pepsi: [12.5, 21.99], Soap: [5, 8] })
  assert.equal(await AuditLogModel.countDocuments({ storeId: store.user._id, event: 'PRODUCT_UPDATED' }), 2)
})

test('batch update can change just one price, and set an exact value', async () => {
  const store = await createStore()
  const ids = await stock(store)
  assert.equal((await api('/api/store/products/batch-update', { token: store.token, body: { ids, sellingPrice: { type: 'set', value: 30 } } })).status, 200)
  assert.deepEqual(await prices(store), { Coke: [10, 30], Pepsi: [11.5, 30], Soap: [5, 30] })
})

test('a batch where any price would go invalid changes nothing', async () => {
  const store = await createStore()
  const ids = await stock(store)
  const before = await prices(store)
  const result = await api<Result>('/api/store/products/batch-update', { token: store.token, body: { ids, sellingPrice: { type: 'amount', value: -9 } } })
  assert.equal(result.status, 400)
  assert.match(result.body.message, /Nothing was changed/)
  assert.deepEqual(await prices(store), before)
})

test('batch update rejects empty, oversized and malformed requests', async () => {
  const store = await createStore()
  const [one] = await stock(store)
  const bad: Array<Record<string, unknown>> = [
    { ids: [], sellingPrice: { type: 'set', value: 1 } },
    { ids: ['not-an-id'], sellingPrice: { type: 'set', value: 1 } },
    { ids: Array.from({ length: 501 }, () => one), sellingPrice: { type: 'set', value: 1 } },
    { ids: [one] },
    { ids: [one], sellingPrice: { type: 'set', value: -1 } },
    { ids: [one], costPrice: 'free' },
    { ids: { $ne: null }, sellingPrice: { type: 'set', value: 1 } },
  ]
  for (const body of bad) assert.equal((await api('/api/store/products/batch-update', { token: store.token, body })).status, 400, JSON.stringify(body).slice(0, 70))
  assert.equal((await api('/api/store/products/batch-update', { body: { ids: [one], sellingPrice: { type: 'set', value: 1 } } })).status, 401)
})

test("batch actions never touch another store's products, archived ones, or unknown ids", async () => {
  const mine = await createStore()
  const other = await createStore()
  const [coke, pepsi] = await stock(mine)
  const [theirs] = await stock(other)
  await ProductModel.updateOne({ _id: pepsi }, { $set: { status: 'archived' } })

  const update = await api<Result>('/api/store/products/batch-update', { token: mine.token, body: { ids: [coke, pepsi, theirs, '507f1f77bcf86cd799439011'], sellingPrice: { type: 'set', value: 1 } } })
  assert.equal(update.status, 200)
  assert.equal(update.body.updated, 1)
  assert.equal(update.body.skipped, 3)
  assert.equal((await ProductModel.findById(theirs).lean())?.sellingPrice, 20, "another store's product is untouched")
  assert.equal((await ProductModel.findById(pepsi).lean())?.sellingPrice, 19.99)

  assert.equal((await api('/api/store/products/batch-update', { token: mine.token, body: { ids: [theirs], sellingPrice: { type: 'set', value: 1 } } })).status, 404)
  assert.equal((await api('/api/store/products/batch-archive', { token: mine.token, body: { ids: [theirs] } })).status, 404)
  assert.equal((await ProductModel.findById(theirs).lean())?.status, 'active')
})

test('batch archive removes the chosen products from the list and is audited, keeping the records', async () => {
  const store = await createStore()
  const [coke, pepsi, soap] = await stock(store)
  const result = await api<Result>('/api/store/products/batch-archive', { token: store.token, body: { ids: [coke, pepsi] } })
  assert.equal(result.status, 200)
  assert.equal(result.body.archived, 2)
  const list = await api<{ products: Array<{ name: string }> }>('/api/store/products?page=1&limit=100', { token: store.token, method: 'GET' })
  assert.deepEqual(list.body.products.map((product) => product.name), ['Soap'])
  assert.equal(await ProductModel.countDocuments({ storeId: store.user._id }), 3, 'rows are kept, only marked archived')
  assert.equal(await AuditLogModel.countDocuments({ storeId: store.user._id, event: 'PRODUCT_ARCHIVED' }), 2)
  assert.equal((await ProductModel.findById(soap).lean())?.status, 'active')

  assert.equal((await api('/api/store/products/batch-archive', { token: store.token, body: { ids: [] } })).status, 400)
  assert.equal((await api('/api/store/products/batch-archive', { body: { ids: [soap] } })).status, 401)
})
