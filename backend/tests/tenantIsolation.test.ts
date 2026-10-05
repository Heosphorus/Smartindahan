import test from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'

import { env } from '../src/config/env.js'
import { ProductModel } from '../src/models/Product.js'
import { UserModel } from '../src/models/User.js'
import { app } from '../src/server.js'

const testUri = process.env.MONGODB_TEST_URI?.trim()
const testDatabaseName = testUri ? /^mongodb(?:\+srv)?:\/\/[^/]+\/([^/?]+)/.exec(testUri)?.[1] : undefined
const isolatedTestDatabase = Boolean(testUri && testUri !== env.mongoUri && testDatabaseName && /test/i.test(testDatabaseName))

test('store API scopes resources and ignores forged role and ownership fields', { skip: !isolatedTestDatabase }, async () => {
  await mongoose.connect(testUri!, { serverSelectionTimeoutMS: 10000 })
  const ownerAId = new mongoose.Types.ObjectId()
  const ownerBId = new mongoose.Types.ObjectId()
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  let httpServer: ReturnType<typeof app.listen> | undefined

  try {
    await UserModel.create([
      { _id: ownerAId, firstName: 'Owner', lastName: 'A', email: `owner-a-${suffix}@example.test`, mobileNumber: '09123456789', passwordHash: 'test-hash', storeName: `Store A ${suffix}`, storeAddress: 'Test A', role: 'STORE_OWNER', isEmailVerified: true, isActive: true },
      { _id: ownerBId, firstName: 'Owner', lastName: 'B', email: `owner-b-${suffix}@example.test`, mobileNumber: '09123456780', passwordHash: 'test-hash', storeName: `Store B ${suffix}`, storeAddress: 'Test B', role: 'STORE_OWNER', isEmailVerified: true, isActive: true },
    ])
    const [productA, productB] = await ProductModel.create([
      { storeId: ownerAId, name: 'A product', category: 'Test', costPrice: 1, sellingPrice: 2, currentStock: 5, minStock: 0 },
      { storeId: ownerBId, name: 'B product', category: 'Test', costPrice: 1, sellingPrice: 2, currentStock: 5, minStock: 0 },
    ])
    assert.ok(productA)
    assert.ok(productB)

    httpServer = app.listen(0)
    await new Promise<void>((resolve, reject) => {
      httpServer!.once('listening', resolve)
      httpServer!.once('error', reject)
    })
    const address = httpServer.address() as AddressInfo
    const baseUrl = `http://127.0.0.1:${address.port}`
    const ownerTokenWithForgedAdminRole = jwt.sign({ id: ownerAId.toString(), role: 'ADMIN', tokenVersion: 0 }, env.jwtSecret, { expiresIn: '1m' })

    const listResponse = await fetch(`${baseUrl}/api/store/products`, { headers: { Authorization: `Bearer ${ownerTokenWithForgedAdminRole}` } })
    assert.equal(listResponse.status, 200)
    const listBody = await listResponse.json() as { products: Array<{ _id: string }> }
    assert.deepEqual(listBody.products.map((product) => product._id), [productA._id.toString()])

    const crossStoreResponse = await fetch(`${baseUrl}/api/store/products/${productB._id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${ownerTokenWithForgedAdminRole}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Tampered', storeId: ownerAId.toString() }),
    })
    assert.equal(crossStoreResponse.status, 404)

    const protectedFieldResponse = await fetch(`${baseUrl}/api/store/products/${productA._id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${ownerTokenWithForgedAdminRole}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated', storeId: ownerBId.toString(), currentStock: 999 }),
    })
    assert.equal(protectedFieldResponse.status, 200)
    const updatedProduct = await ProductModel.findById(productA._id).lean()
    assert.equal(updatedProduct?.storeId.toString(), ownerAId.toString())
    assert.equal(updatedProduct?.currentStock, 5)

    const adminRouteResponse = await fetch(`${baseUrl}/api/auth/admin/stats`, { headers: { Authorization: `Bearer ${ownerTokenWithForgedAdminRole}` } })
    assert.equal(adminRouteResponse.status, 403)
  } finally {
    if (httpServer?.listening) await new Promise<void>((resolve, reject) => httpServer!.close((error) => error ? reject(error) : resolve()))
    await ProductModel.deleteMany({ storeId: { $in: [ownerAId, ownerBId] } })
    await UserModel.deleteMany({ _id: { $in: [ownerAId, ownerBId] } })
    await mongoose.disconnect()
  }
})