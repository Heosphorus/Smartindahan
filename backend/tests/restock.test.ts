import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'

import { buildRestockInsights, type ProductInput } from '../src/services/restockService.js'
import { api, createProduct, createStore, startTestServer, stopTestServer } from './helpers/testServer.js'

const now = new Date('2026-06-30T00:00:00Z')
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000)
const product = (id: string, overrides: Partial<ProductInput> = {}): ProductInput => ({ id, name: `Item ${id}`, unit: 'piece', currentStock: 50, minStock: 0, costPrice: 10, createdAt: daysAgo(90), ...overrides })

test('restock maths: days of stock left, suggested quantity and cost', () => {
  // 30 sold over a 30 day window = 1 per day; 6 left = 6 days; cover 14 days = target 14, order 8.
  const result = buildRestockInsights([product('a', { currentStock: 6 })], new Map([['a', 30]]), now)
  const [suggestion] = result.suggestions
  assert.equal(suggestion!.status, 'soon')
  assert.equal(suggestion!.averageDailySales, 1)
  assert.equal(suggestion!.daysOfStockLeft, 6)
  assert.equal(suggestion!.suggestedOrderQuantity, 8)
  assert.equal(suggestion!.estimatedCost, 80)
  assert.equal(suggestion!.confidence, 'ok')
  assert.equal(result.summary.estimatedOrderCost, 80)

  const longer = buildRestockInsights([product('a', { currentStock: 6 })], new Map([['a', 30]]), now, 30)
  assert.equal(longer.suggestions[0]!.suggestedOrderQuantity, 24)
})

test('products are classified and ordered by urgency; healthy stock is left out', () => {
  const products = [
    product('soon', { currentStock: 6 }),
    product('urgent', { currentStock: 2 }),
    product('out', { currentStock: 0 }),
    product('healthy', { currentStock: 100 }),
    product('low', { currentStock: 5, minStock: 5 }),
  ]
  const sold = new Map([['soon', 30], ['urgent', 30], ['out', 15], ['healthy', 30]])
  const result = buildRestockInsights(products, sold, now)
  assert.deepEqual(result.suggestions.map((entry) => [entry.productId, entry.status]), [['out', 'out'], ['urgent', 'urgent'], ['soon', 'soon'], ['low', 'low']])
  assert.equal(result.suggestions.find((entry) => entry.productId === 'low')!.suggestedOrderQuantity, 0, 'at the minimum already: nothing more to order')
  assert.equal(result.summary.out, 1)
  assert.equal(result.summary.urgent, 1)
})

test('minimum stock raises the suggested quantity even with no recent sales', () => {
  const [entry] = buildRestockInsights([product('m', { currentStock: 1, minStock: 6 })], new Map(), now).suggestions
  assert.equal(entry!.status, 'low')
  assert.equal(entry!.suggestedOrderQuantity, 5)
  assert.equal(entry!.daysOfStockLeft, null)
})

test('slow movers are old products with stock and no sales; out-of-stock items with no signal are ignored', () => {
  const result = buildRestockInsights([
    product('slow', { currentStock: 40, costPrice: 12.5 }),
    product('new-unsold', { currentStock: 40, createdAt: daysAgo(5) }),
    product('empty-unused', { currentStock: 0, minStock: 0 }),
  ], new Map(), now)
  assert.deepEqual(result.slowMovers.map((entry) => entry.productId), ['slow'])
  assert.equal(result.slowMovers[0]!.stockValue, 500)
  assert.equal(result.summary.moneyTiedInSlowMovers, 500)
  assert.equal(result.suggestions.length, 0)
})

test('a very new product is flagged low confidence and not extrapolated from a single day', () => {
  // Added 2 days ago, 7 sold: divided by the 7 day minimum (1 per day), not by 2 days (3.5 per day).
  const [entry] = buildRestockInsights([product('new', { currentStock: 7, createdAt: daysAgo(2) })], new Map([['new', 7]]), now).suggestions
  assert.equal(entry!.averageDailySales, 1)
  assert.equal(entry!.confidence, 'low')
})

before(async () => { await startTestServer() }, { timeout: 300_000 })
after(async () => { await stopTestServer() })

type Insights = { suggestions: Array<{ productId: string; status: string; soldLast30Days: number }>; slowMovers: unknown[]; summary: { needsRestock: number } }

test('the API uses only the signed-in store\'s own sales and stock', async () => {
  const mine = await createStore()
  const other = await createStore()
  const chips = await createProduct(mine.token, { initialStock: 10, minStock: 0 })
  await createProduct(mine.token, { initialStock: 30, minStock: 0 })
  const foreign = await createProduct(other.token, { initialStock: 1, minStock: 5 })

  assert.equal((await api('/api/business/insights/restock')).status, 401)
  assert.equal((await api('/api/business/insights/restock?coverDays=0', { token: mine.token })).status, 400)
  assert.equal((await api('/api/business/insights/restock?coverDays=abc', { token: mine.token })).status, 400)

  const sold = await api('/api/store/sales/checkout', { token: mine.token, body: { items: [{ productId: chips._id, quantity: 9 }], paymentMethod: 'Cash' } })
  assert.equal(sold.status, 201)

  const result = await api<Insights>('/api/business/insights/restock', { token: mine.token })
  assert.equal(result.status, 200)
  const entry = result.body.suggestions.find((suggestion) => suggestion.productId === chips._id)
  assert.ok(entry, 'the nearly sold-out product is suggested')
  assert.equal(entry.soldLast30Days, 9)
  assert.equal(entry.status, 'urgent')
  assert.ok(!result.body.suggestions.some((suggestion) => suggestion.productId === foreign._id), 'another store\'s products never appear')
  assert.equal(result.body.suggestions.length, 1)
})
