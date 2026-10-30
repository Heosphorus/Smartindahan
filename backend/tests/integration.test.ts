import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'

import { hashOtp } from '../src/services/authService.js'
import { startOfStoreDay } from '../src/utils/storeTime.js'
import { api, createProduct, createStore, startTestServer, stopTestServer, tokenFor } from './helpers/testServer.js'

type ProductBody = { product: { _id: string; currentStock: number; sellingPrice: number; costPrice: number; name: string; barcode?: string } }
type Message = { message: string }
type SaleBody = { sale: { code: string; total: number; profit: number } }
type Dashboard = { kpis: { todaysSales: number; estimatedProfit: number; transactions: number; inventoryValue: number }; lowStock: Array<{ name: string }>; salesOverview: Array<{ date: string; sales: number }> }

async function stockOf(token: string, productId: string): Promise<number> {
  const list = await api<{ products: Array<{ _id: string; currentStock: number }> }>('/api/store/products?limit=100', { token })
  const found = list.body.products.find((product) => product._id === productId)
  assert.ok(found, 'product should be listed')
  return found.currentStock
}

before(async () => { await startTestServer() }, { timeout: 300_000 })
after(async () => { await stopTestServer() })

test('health endpoint reports a connected database', async () => {
  const health = await api<{ status: string; database: string }>('/api/health')
  assert.equal(health.status, 200)
  assert.deepEqual(health.body, { status: 'ok', database: 'connected' })
})

test('unknown API paths answer with JSON, never HTML', async () => {
  const result = await api<Message>('/api/does-not-exist')
  assert.equal(result.status, 404)
  assert.match(result.headers.get('content-type') ?? '', /application\/json/)
})

test('CORS: allowed origins get headers, unknown origins do not', async () => {
  const allowed = await api('/api/health', { headers: { Origin: 'http://localhost:5173' } })
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:5173')
  const blocked = await api('/api/health', { headers: { Origin: 'https://evil.example' } })
  assert.equal(blocked.headers.get('access-control-allow-origin'), null)
})

test('protected routes reject missing, malformed, stale and unverified tokens', async () => {
  const store = await createStore()
  assert.equal((await api('/api/store/products')).status, 401)
  assert.equal((await api('/api/store/products', { token: 'not-a-jwt' })).status, 401)
  assert.equal((await api('/api/store/products', { token: tokenFor(store.user, 99) })).status, 401, 'stale tokenVersion')
  const unverified = await createStore({ verified: false })
  assert.equal((await api('/api/store/products', { token: unverified.token })).status, 401)
  assert.equal((await api('/api/store/products', { token: store.token })).status, 200)
})

test('a store owner cannot reach admin endpoints', async () => {
  const store = await createStore()
  assert.equal((await api('/api/auth/admin/users', { token: store.token })).status, 403)
  const admin = await createStore({ role: 'ADMIN' })
  assert.equal((await api('/api/auth/admin/users', { token: admin.token })).status, 200)
  assert.equal((await api('/api/store/products', { token: admin.token })).status, 403, 'admins have no store')
})

test('product creation validates input and rejects duplicate barcodes', async () => {
  const { token } = await createStore()
  const bad: Array<Record<string, unknown>> = [
    { name: 'X', category: 'C', costPrice: -1, sellingPrice: 5 },
    { name: 'X', category: 'C', costPrice: 1, sellingPrice: 'free' },
    { name: 123, category: 'C', costPrice: 1, sellingPrice: 5 },
    { name: '  ', category: 'C', costPrice: 1, sellingPrice: 5 },
    { name: 'X', category: 'C', costPrice: 1, sellingPrice: 5, initialStock: -3 },
    { name: 'X', category: 'C', costPrice: 1, sellingPrice: 5, initialStock: 1.5 },
  ]
  for (const body of bad) assert.equal((await api<Message>('/api/store/products', { token, body })).status, 400, JSON.stringify(body))

  await createProduct(token, { barcode: '4800001' })
  const duplicate = await api<Message>('/api/store/products', { token, body: { name: 'Dup', category: 'C', costPrice: 1, sellingPrice: 2, barcode: '4800001' } })
  assert.equal(duplicate.status, 409)
})

test('product CRUD: edit price, clear optional fields without barcode collisions, archive', async () => {
  const { token } = await createStore()
  const first = await createProduct(token)
  const second = await createProduct(token)

  const priced = await api<ProductBody>(`/api/store/products/${first._id}`, { token, method: 'PATCH', body: { sellingPrice: 12.5, barcode: '' } })
  assert.equal(priced.status, 200)
  assert.equal(priced.body.product.sellingPrice, 12.5)
  // Two products with a cleared barcode must not collide on the unique barcode index.
  const cleared = await api<ProductBody>(`/api/store/products/${second._id}`, { token, method: 'PATCH', body: { barcode: '' } })
  assert.equal(cleared.status, 200)

  assert.equal((await api(`/api/store/products/${first._id}`, { token, method: 'PATCH', body: { sellingPrice: -2 } })).status, 400)
  assert.equal((await api(`/api/store/products/${first._id}`, { token, method: 'PATCH', body: { currentStock: 999 } })).status, 400, 'stock is not editable through product update')

  assert.equal((await api(`/api/store/products/${first._id}`, { token, method: 'DELETE' })).status, 200)
  const list = await api<{ products: Array<{ _id: string }> }>('/api/store/products', { token })
  assert.ok(!list.body.products.some((product) => product._id === first._id), 'archived product is hidden')
})

test('tenant isolation: another store cannot read or change a product, stock or sale', async () => {
  const storeA = await createStore()
  const storeB = await createStore()
  const product = await createProduct(storeA.token, { initialStock: 5 })

  assert.equal((await api(`/api/store/products/${product._id}`, { token: storeB.token, method: 'PATCH', body: { sellingPrice: 1 } })).status, 404)
  assert.equal((await api(`/api/store/products/${product._id}`, { token: storeB.token, method: 'DELETE' })).status, 404)
  assert.equal((await api('/api/store/inventory/stock-in', { token: storeB.token, body: { items: [{ productId: product._id, quantity: 5 }] } })).status, 404)
  assert.equal((await api('/api/store/inventory/stock-out', { token: storeB.token, body: { productId: product._id, quantity: 1 } })).status, 404)
  assert.equal((await api('/api/store/sales/checkout', { token: storeB.token, body: { items: [{ productId: product._id, quantity: 1 }] } })).status, 400)
  const listB = await api<{ products: unknown[] }>('/api/store/products', { token: storeB.token })
  assert.equal(listB.body.products.length, 0)
  assert.equal(await stockOf(storeA.token, product._id), 5, 'owner A stock untouched')

  // Forged ownership/role fields in the body are ignored.
  const forged = await api<{ customer: { storeId: string } }>('/api/business/customers', { token: storeB.token, body: { name: 'Forged', storeId: storeA.id, role: 'ADMIN' } })
  assert.equal(forged.status, 201)
  assert.equal(forged.body.customer.storeId, storeB.id)
  const customersA = await api<{ customers: Array<{ name: string }> }>('/api/business/customers', { token: storeA.token })
  assert.ok(!customersA.body.customers.some((customer) => customer.name === 'Forged'))
})

test('barcode lookup returns the price under both contract and POS field names', async () => {
  const { token } = await createStore()
  await createProduct(token, { barcode: '4801234567890', sellingPrice: 18.5 })
  const found = await api<{ found: boolean; product: { sellPrice: number; sellingPrice: number } }>('/api/store/products/barcode/lookup', { token, body: { rawValue: '4801234567890' } })
  assert.equal(found.status, 200)
  assert.equal(found.body.product.sellPrice, 18.5)
  assert.equal(found.body.product.sellingPrice, 18.5)
  assert.equal((await api('/api/store/products/barcode/lookup', { token, body: { rawValue: '0000' } })).status, 404)
})

test('inventory: stock-in adds, stock-out cannot go below zero, count sets exact quantity', async () => {
  const { token } = await createStore()
  const product = await createProduct(token, { initialStock: 3 })
  assert.equal((await api('/api/store/inventory/stock-in', { token, body: { items: [{ productId: product._id, quantity: 7, unitCost: 9 }] } })).status, 201)
  assert.equal(await stockOf(token, product._id), 10)

  assert.equal((await api('/api/store/inventory/stock-out', { token, body: { productId: product._id, quantity: 11 } })).status, 409)
  assert.equal(await stockOf(token, product._id), 10, 'failed stock-out leaves stock unchanged')
  assert.equal((await api('/api/store/inventory/stock-out', { token, body: { productId: product._id, quantity: 4 } })).status, 201)
  assert.equal(await stockOf(token, product._id), 6)

  for (const quantity of [0, -1, 1.5, '2']) assert.equal((await api('/api/store/inventory/stock-in', { token, body: { items: [{ productId: product._id, quantity }] } })).status, 400)
  assert.equal((await api('/api/store/inventory/count', { token, body: { counts: [{ productId: product._id, scannedQuantity: 2 }] } })).status, 201)
  assert.equal(await stockOf(token, product._id), 2)
  assert.equal((await api('/api/store/inventory/count', { token, body: { counts: [{ productId: product._id, scannedQuantity: -1 }] } })).status, 400)
})

test('checkout deducts stock, records frozen price and cost, and computes profit', async () => {
  const { token } = await createStore()
  const chips = await createProduct(token, { costPrice: 6.5, sellingPrice: 10, initialStock: 10 })
  const soda = await createProduct(token, { costPrice: 12, sellingPrice: 15, initialStock: 4 })

  const sale = await api<SaleBody>('/api/store/sales/checkout', { token, body: { items: [{ productId: chips._id, quantity: 3 }, { productId: soda._id, quantity: 2 }], paymentMethod: 'GCash' } })
  assert.equal(sale.status, 201)
  assert.equal(sale.body.sale.total, 60) // 3*10 + 2*15
  assert.equal(sale.body.sale.profit, 16.5) // 3*3.5 + 2*3
  assert.equal(await stockOf(token, chips._id), 7)
  assert.equal(await stockOf(token, soda._id), 2)

  // Later price changes never rewrite history.
  await api(`/api/store/products/${chips._id}`, { token, method: 'PATCH', body: { sellingPrice: 99, costPrice: 50 } })
  const history = await api<{ sales: Array<{ total: number; estimatedProfit: number; items: Array<{ unitPrice: number; costPrice: number }> }> }>('/api/business/sales', { token })
  assert.equal(history.body.sales.length, 1)
  assert.equal(history.body.sales[0]!.total, 60)
  assert.equal(history.body.sales[0]!.estimatedProfit, 16.5)
  assert.deepEqual(history.body.sales[0]!.items.map((item) => [item.unitPrice, item.costPrice]), [[10, 6.5], [15, 12]])
})

test('checkout rejects bad carts and never partially modifies stock', async () => {
  const { token } = await createStore()
  const plenty = await createProduct(token, { initialStock: 10 })
  const scarce = await createProduct(token, { initialStock: 1 })

  const partial = await api<Message>('/api/store/sales/checkout', { token, body: { items: [{ productId: plenty._id, quantity: 4 }, { productId: scarce._id, quantity: 2 }] } })
  assert.equal(partial.status, 409)
  assert.equal(await stockOf(token, plenty._id), 10, 'first line must be rolled back')
  assert.equal(await stockOf(token, scarce._id), 1)

  const invalidBodies: unknown[] = [
    { items: [] },
    { items: [{ productId: plenty._id, quantity: 0 }] },
    { items: [{ productId: plenty._id, quantity: -2 }] },
    { items: [{ productId: plenty._id, quantity: 1.5 }] },
    { items: [{ productId: 'nope', quantity: 1 }] },
    { items: [{ productId: plenty._id, quantity: 1 }], paymentMethod: 'Bitcoin' },
    { items: [{ productId: plenty._id, quantity: 1 }], paymentMethod: 'Utang' },
    { items: [{ productId: plenty._id, quantity: 1 }], idempotencyKey: 'x' },
    {},
  ]
  for (const body of invalidBodies) assert.equal((await api('/api/store/sales/checkout', { token, body })).status, 400, JSON.stringify(body))
  assert.equal(await stockOf(token, plenty._id), 10)
  const history = await api<{ sales: unknown[] }>('/api/business/sales', { token })
  assert.equal(history.body.sales.length, 0, 'no sale recorded for rejected carts')
})

test('a cart that lists the same product twice cannot oversell it', async () => {
  const { token } = await createStore()
  const product = await createProduct(token, { initialStock: 3 })
  const result = await api<Message>('/api/store/sales/checkout', { token, body: { items: [{ productId: product._id, quantity: 2 }, { productId: product._id, quantity: 2 }] } })
  assert.equal(result.status, 409)
  assert.equal(await stockOf(token, product._id), 3)
})

test('repeating a checkout with the same idempotency key records one sale', async () => {
  const { token } = await createStore()
  const product = await createProduct(token, { initialStock: 10 })
  const body = { items: [{ productId: product._id, quantity: 2 }], idempotencyKey: 'cart-0001-abcdef' }

  const first = await api<SaleBody>('/api/store/sales/checkout', { token, body })
  const replay = await api<SaleBody>('/api/store/sales/checkout', { token, body })
  assert.equal(first.status, 201)
  assert.equal(replay.status, 200)
  assert.equal(replay.body.sale.code, first.body.sale.code)
  assert.equal(await stockOf(token, product._id), 8, 'stock deducted once')

  const burst = { items: [{ productId: product._id, quantity: 1 }], idempotencyKey: 'cart-0002-burst' }
  const results = await Promise.all(Array.from({ length: 6 }, () => api<SaleBody>('/api/store/sales/checkout', { token, body: burst })))
  assert.ok(results.every((result) => result.status === 200 || result.status === 201), results.map((result) => result.status).join(','))
  assert.equal(new Set(results.map((result) => result.body.sale.code)).size, 1, 'every response refers to the same sale')
  assert.equal(await stockOf(token, product._id), 7, 'concurrent duplicates deduct once')
  const history = await api<{ sales: unknown[] }>('/api/business/sales', { token })
  assert.equal(history.body.sales.length, 2)
})

test('concurrent checkouts never drive stock negative', async () => {
  const { token } = await createStore()
  const product = await createProduct(token, { initialStock: 5 })
  const results = await Promise.all(Array.from({ length: 10 }, () => api<Message>('/api/store/sales/checkout', { token, body: { items: [{ productId: product._id, quantity: 1 }] } })))
  const succeeded = results.filter((result) => result.status === 201).length
  assert.equal(succeeded, 5, results.map((result) => result.status).join(','))
  assert.equal(await stockOf(token, product._id), 0)
})

test('dashboard reflects sales, low stock and buckets by Manila day', async () => {
  const { token, id } = await createStore()
  const product = await createProduct(token, { costPrice: 4, sellingPrice: 10, initialStock: 5, minStock: 5 })
  assert.equal((await api('/api/store/sales/checkout', { token, body: { items: [{ productId: product._id, quantity: 2 }] } })).status, 201)

  // Insert sales just inside and just outside "today" in Manila time.
  const { SaleModel } = await import('../src/models/Sale.js')
  const dayStart = startOfStoreDay(new Date())
  const item = { productId: new mongoose.Types.ObjectId(), productName: 'x', quantity: 1, unitPrice: 100, costPrice: 60, lineTotal: 100 }
  const common = { storeId: new mongoose.Types.ObjectId(id), cashierId: new mongoose.Types.ObjectId(id), items: [item], subtotal: 100, total: 100, estimatedProfit: 40, paymentMethod: 'Cash' as const }
  await SaleModel.create([
    { ...common, transactionCode: `TXN-early-${id}`, createdAt: new Date(dayStart.getTime() + 60_000) },
    { ...common, transactionCode: `TXN-prev-${id}`, createdAt: new Date(dayStart.getTime() - 60_000) },
  ])

  const dashboard = await api<Dashboard>('/api/store/dashboard', { token })
  assert.equal(dashboard.status, 200)
  // Skip the exact-count check in the first minute of the Manila day, when "+60s" could fall in the future.
  if (Date.now() - dayStart.getTime() > 120_000) {
    assert.equal(dashboard.body.kpis.transactions, 2, 'the Manila-day-start sale counts, the one before it does not')
    assert.equal(dashboard.body.kpis.todaysSales, 120)
    assert.equal(dashboard.body.kpis.estimatedProfit, 52)
  }
  assert.equal(dashboard.body.kpis.inventoryValue, 12) // 3 units * 4
  assert.deepEqual(dashboard.body.lowStock.map((entry) => entry.name), [product.name])
  assert.equal(dashboard.body.salesOverview.length, 7, 'weekly overview covers seven days')
  assert.equal((await api('/api/store/dashboard?period=yearly', { token })).status, 400)
})

test('supplier CRUD with archive, duplicate protection and isolation', async () => {
  const a = await createStore()
  const b = await createStore()
  const created = await api<{ supplier: { _id: string } }>('/api/business/suppliers', { token: a.token, body: { name: 'Metro Wholesale', contactNumber: '0917' } })
  assert.equal(created.status, 201)
  assert.equal((await api('/api/business/suppliers', { token: a.token, body: { name: 'Metro Wholesale' } })).status, 409)
  assert.equal((await api('/api/business/suppliers', { token: b.token, body: { name: 'Metro Wholesale' } })).status, 201, 'same name is fine in another store')
  assert.equal((await api('/api/business/suppliers', { token: a.token, body: { name: '   ' } })).status, 400)

  const id = created.body.supplier._id
  assert.equal((await api(`/api/business/suppliers/${id}`, { token: b.token, method: 'PATCH', body: { name: 'Hijack' } })).status, 404)
  assert.equal((await api(`/api/business/suppliers/${id}`, { token: a.token, method: 'PATCH', body: { address: 'Manila' } })).status, 200)
  assert.equal((await api(`/api/business/suppliers/${id}`, { token: a.token, method: 'DELETE' })).status, 200)
  const list = await api<{ suppliers: unknown[] }>('/api/business/suppliers', { token: a.token })
  assert.equal(list.body.suppliers.length, 0)
})

test('expenses require a positive amount', async () => {
  const { token } = await createStore()
  assert.equal((await api('/api/business/expenses', { token, body: { category: 'Rent', description: 'May', amount: 0 } })).status, 400)
  assert.equal((await api('/api/business/expenses', { token, body: { category: 'Rent', description: 'May', amount: '500' } })).status, 400)
  assert.equal((await api('/api/business/expenses', { token, body: { category: 'Rent', description: 'May', amount: 500 } })).status, 201)
})

test('pagination parameters are validated', async () => {
  const { token } = await createStore()
  for (const query of ['page=0', 'limit=101', 'limit=abc', 'page=1.5']) assert.equal((await api(`/api/store/products?${query}`, { token })).status, 400, query)
})

test('change password: needs the current password, signs out other sessions, returns a fresh token', async () => {
  const store = await createStore()
  const wrong = await api<Message>('/api/auth/change-password', { token: store.token, body: { currentPassword: 'Wrong1234', newPassword: 'NewPassw0rd', confirmPassword: 'NewPassw0rd' } })
  assert.equal(wrong.status, 400)
  const weak = await api<Message>('/api/auth/change-password', { token: store.token, body: { currentPassword: store.password, newPassword: 'short', confirmPassword: 'short' } })
  assert.equal(weak.status, 400)
  const mismatch = await api<Message>('/api/auth/change-password', { token: store.token, body: { currentPassword: store.password, newPassword: 'NewPassw0rd', confirmPassword: 'Different1' } })
  assert.equal(mismatch.status, 400)
  assert.equal((await api('/api/auth/change-password', { body: { currentPassword: store.password, newPassword: 'NewPassw0rd', confirmPassword: 'NewPassw0rd' } })).status, 401)

  const changed = await api<{ token: string }>('/api/auth/change-password', { token: store.token, body: { currentPassword: store.password, newPassword: 'NewPassw0rd', confirmPassword: 'NewPassw0rd' } })
  assert.equal(changed.status, 200)
  assert.equal((await api('/api/store/products', { token: store.token })).status, 401, 'old token is revoked')
  assert.equal((await api('/api/store/products', { token: changed.body.token })).status, 200, 'new token works')
  assert.equal((await api('/api/auth/login', { body: { email: store.email, password: 'NewPassw0rd' } })).status, 200)
  assert.equal((await api('/api/auth/login', { body: { email: store.email, password: store.password } })).status, 401)
})

test('registration, email verification and login work end to end', async () => {
  const email = `new-owner-${Date.now()}@example.test`
  const policies = await api<{ policies: Array<{ policyType: string; version: string }> }>('/api/legal/policies')
  const versionOf = (type: string) => policies.body.policies.find((policy) => policy.policyType === type)!.version
  const registration = { firstName: 'Ana', lastName: 'Cruz', email, mobileNumber: '09171234567', password: 'Passw0rdTest', confirmPassword: 'Passw0rdTest', storeName: `Ana Store ${Date.now()}`, storeAddress: 'Quezon City', privacyPolicyAccepted: true, termsAccepted: true, termsVersion: versionOf('terms'), privacyVersion: versionOf('privacy') }

  assert.equal((await api('/api/auth/register', { body: { ...registration, termsAccepted: false } })).status, 400)
  assert.equal((await api('/api/auth/register', { body: { ...registration, password: 'weak', confirmPassword: 'weak' } })).status, 400)
  const registered = await api<{ user: { id: string } }>('/api/auth/register', { body: registration })
  assert.equal(registered.status, 201)
  const userId = registered.body.user.id

  assert.equal((await api('/api/auth/login', { body: { email, password: registration.password } })).status, 403, 'cannot log in before verifying')

  // Delivery is mocked in test mode; replace the stored code hash with a known one.
  const { EmailVerificationModel } = await import('../src/models/EmailVerification.js')
  await EmailVerificationModel.updateOne({ userId, verified: false }, { $set: { otpHash: hashOtp('123456') } })
  const wrongCode = await api<{ remainingAttempts: number }>('/api/auth/verify-email', { body: { userId, otp: '000000' } })
  assert.equal(wrongCode.status, 400)
  assert.equal(wrongCode.body.remainingAttempts, 4)
  assert.equal((await api('/api/auth/verify-email', { body: { userId, otp: '123456' } })).status, 200)

  const login = await api<{ token: string }>('/api/auth/login', { body: { email, password: registration.password } })
  assert.equal(login.status, 200)
  const me = await api<{ user: { email: string } }>('/api/auth/me', { token: login.body.token })
  assert.equal(me.body.user.email, email)
  assert.equal((await api('/api/auth/logout', { token: login.body.token, body: {} })).status, 200)
})

test('forgot password does not reveal whether an email is registered', async () => {
  const store = await createStore()
  const known = await api<{ userId?: string; maskedEmail?: string; message: string }>('/api/auth/forgot-password', { body: { email: store.email } })
  const unknown = await api<{ userId?: string; maskedEmail?: string; message: string }>('/api/auth/forgot-password', { body: { email: `nobody-${Date.now()}@example.test` } })
  assert.equal(known.status, 200)
  assert.equal(unknown.status, 200)
  assert.deepEqual(Object.keys(unknown.body).sort(), Object.keys(known.body).sort())
  assert.equal(unknown.body.message, known.body.message)
})

test('password reset requires a verified code and revokes old sessions', async () => {
  const store = await createStore()
  const { PasswordResetModel } = await import('../src/models/PasswordReset.js')
  assert.equal((await api('/api/auth/reset-password', { body: { userId: store.id, password: 'ResetPassw0rd', confirmPassword: 'ResetPassw0rd' } })).status, 403, 'no verified code yet')

  assert.equal((await api('/api/auth/forgot-password', { body: { email: store.email } })).status, 200)
  await PasswordResetModel.updateOne({ userId: store.id, verified: false }, { $set: { otpHash: hashOtp('654321') } })
  assert.equal((await api('/api/auth/verify-reset-otp', { body: { userId: store.id, otp: '654321' } })).status, 200)
  assert.equal((await api('/api/auth/reset-password', { body: { userId: store.id, password: 'ResetPassw0rd', confirmPassword: 'ResetPassw0rd' } })).status, 200)
  assert.equal((await api('/api/store/products', { token: store.token })).status, 401)
  assert.equal((await api('/api/auth/login', { body: { email: store.email, password: 'ResetPassw0rd' } })).status, 200)
  assert.equal((await api('/api/auth/reset-password', { body: { userId: store.id, password: 'AnotherPassw0rd', confirmPassword: 'AnotherPassw0rd' } })).status, 403, 'a reset code is single use')
})

test('NoSQL operator payloads are rejected rather than interpreted', async () => {
  const store = await createStore()
  const login = await api('/api/auth/login', { body: { email: { $ne: null }, password: { $ne: null } } })
  assert.notEqual(login.status, 200)
  assert.equal((await api(`/api/store/products/${encodeURIComponent('{"$ne":null}')}`, { token: store.token, method: 'PATCH', body: { name: 'x' } })).status, 404)
  const lookup = await api('/api/store/products/barcode/lookup', { token: store.token, body: { rawValue: { $ne: '' } } })
  assert.ok(lookup.status === 404 || lookup.status === 400)
  assert.equal((await api('/api/store/products', { token: store.token, body: { name: { $gt: '' }, category: 'C', costPrice: 1, sellingPrice: 2 } })).status, 400)
})

test('overlong text inputs are rejected before reaching handlers', async () => {
  const { token } = await createStore()
  const result = await api<Message>('/api/store/products', { token, body: { name: 'x'.repeat(65), category: 'C', costPrice: 1, sellingPrice: 2 } })
  assert.equal(result.status, 400)
})
