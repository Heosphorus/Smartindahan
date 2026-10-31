import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import { MongoMemoryReplSet } from 'mongodb-memory-server'

// Never reach a real database from tests: neutralise the developer's .env before the app reads it.
process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = ''
process.env.EMAIL_MODE = 'development'

const { env } = await import('../../src/config/env.js')
const { app } = await import('../../src/server.js')
const { UserModel } = await import('../../src/models/User.js')
const { ProductModel } = await import('../../src/models/Product.js')
const { SaleModel } = await import('../../src/models/Sale.js')
const { ConsentRecordModel } = await import('../../src/models/ConsentRecord.js')
const { PolicyVersionModel } = await import('../../src/models/PolicyVersion.js')
const { currentPolicy, recordConsent, resetPolicySeedState } = await import('../../src/services/policyService.js')

export { env }

let replicaSet: MongoMemoryReplSet | undefined
let httpServer: ReturnType<typeof app.listen> | undefined
let baseUrl = ''

/** Starts an in-memory single-node replica set (required for transactions) and the Express app on a free port. */
export async function startTestServer(): Promise<void> {
  // Every test file starts its own server, so a loaded machine can need longer than the 10-second default to boot one.
  replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' }, instanceOpts: [{ launchTimeout: 60_000 }] })
  await mongoose.connect(replicaSet.getUri('smartindahan_test'))
  await Promise.all([UserModel.init(), ProductModel.init(), SaleModel.init(), ConsentRecordModel.init(), PolicyVersionModel.init()])
  resetPolicySeedState()
  httpServer = app.listen(0)
  await new Promise<void>((resolve, reject) => {
    httpServer!.once('listening', resolve)
    httpServer!.once('error', reject)
  })
  baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`
}

export async function stopTestServer(): Promise<void> {
  await new Promise<void>((resolve) => httpServer ? httpServer.close(() => resolve()) : resolve())
  await mongoose.disconnect()
  await replicaSet?.stop()
}

export type ApiResult<T = Record<string, unknown>> = { status: number; body: T; headers: Headers }

export async function api<T = Record<string, unknown>>(path: string, options: { method?: string; body?: unknown; token?: string; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
    headers: {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers ?? {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  })
  const text = await response.text()
  let body: unknown = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  return { status: response.status, body: body as T, headers: response.headers }
}

export function tokenFor(user: { id: string; email: string; role: string; tokenVersion?: number }, tokenVersion = user.tokenVersion ?? 0): string {
  return jwt.sign({ id: user.id, email: user.email, role: user.role, tokenVersion }, env.jwtSecret, { expiresIn: '1h', jwtid: randomUUID() })
}

let counter = 0

export async function createStore(options: { password?: string; verified?: boolean; role?: 'STORE_OWNER' | 'ADMIN'; acceptPolicies?: boolean } = {}) {
  counter += 1
  const suffix = `${Date.now()}-${counter}`
  const password = options.password ?? 'Passw0rdTest'
  const user = await UserModel.create({
    firstName: 'Test', lastName: `Owner${counter}`, email: `owner-${suffix}@example.test`, mobileNumber: '09123456789',
    passwordHash: await bcrypt.hash(password, 4), storeName: `Test Store ${suffix}`, storeAddress: 'Test Street',
    role: options.role ?? 'STORE_OWNER', isEmailVerified: options.verified ?? true, isActive: true,
  })
  if (options.acceptPolicies ?? true) {
    // A fixture for a user who really did accept the current policies (the app never invents these records).
    for (const [policyType, consentType] of [['terms', 'TERMS_OF_SERVICE'], ['privacy', 'PRIVACY_NOTICE']] as const) {
      const policy = await currentPolicy(policyType)
      await recordConsent({ userId: user._id, consentType, policyVersion: policy!.version, source: 'SETTINGS' })
    }
  }
  return { user, password, email: user.email, id: user.id as string, token: tokenFor({ id: user.id, email: user.email, role: user.role, tokenVersion: user.tokenVersion }) }
}

export type TestStore = Awaited<ReturnType<typeof createStore>>

export async function createProduct(token: string, overrides: Record<string, unknown> = {}) {
  counter += 1
  const result = await api<{ product: { _id: string; name: string; currentStock: number; sellingPrice: number; costPrice: number } }>('/api/store/products', {
    token,
    body: { name: `Item ${counter}`, category: 'Test', costPrice: 8, sellingPrice: 10, initialStock: 10, minStock: 2, ...overrides },
  })
  if (result.status !== 201) throw new Error(`product setup failed: ${result.status} ${JSON.stringify(result.body)}`)
  return result.body.product
}
