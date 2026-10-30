import test from 'node:test'
import assert from 'node:assert/strict'
import type { Response } from 'express'

import { authenticateToken, requireRole, requireStoreMembership, type AuthenticatedRequest } from '../src/middleware/authMiddleware.js'

function fakeResponse() {
  const captured: { status?: number; body?: unknown } = {}
  const res = {
    status(code: number) { captured.status = code; return res },
    json(body: unknown) { captured.body = body; return res },
  }
  return { res: res as unknown as Response, captured }
}

const request = (headers: Record<string, string> = {}, user?: AuthenticatedRequest['user']) => ({ headers, ...(user ? { user } : {}) }) as unknown as AuthenticatedRequest

test('requests without a bearer token are rejected before touching the database', async () => {
  for (const headers of [{}, { authorization: 'Basic abc' }, { authorization: 'Bearer ' }]) {
    const { res, captured } = fakeResponse()
    let called = false
    await authenticateToken(request(headers), res, () => { called = true })
    assert.equal(captured.status, 401)
    assert.equal(called, false)
  }
})

test('a malformed or wrongly signed token is rejected', async () => {
  const { res, captured } = fakeResponse()
  await authenticateToken(request({ authorization: 'Bearer abc.def.ghi' }), res, () => assert.fail('must not continue'))
  assert.equal(captured.status, 401)
})

test('role guard allows listed roles only', () => {
  const guard = requireRole('STORE_OWNER')
  const denied = fakeResponse()
  guard(request({}, { id: '1', email: 'a@b.c', role: 'CASHIER' }), denied.res, () => assert.fail('must not continue'))
  assert.equal(denied.captured.status, 403)

  const anonymous = fakeResponse()
  guard(request(), anonymous.res, () => assert.fail('must not continue'))
  assert.equal(anonymous.captured.status, 401)

  let allowed = false
  guard(request({}, { id: '1', email: 'a@b.c', role: 'STORE_OWNER' }), fakeResponse().res, () => { allowed = true })
  assert.equal(allowed, true)
})

test('store membership requires a valid store id', () => {
  const denied = fakeResponse()
  requireStoreMembership(request({}, { id: '1', email: 'a@b.c', role: 'ADMIN' }), denied.res, () => assert.fail('must not continue'))
  assert.equal(denied.captured.status, 403)
  let allowed = false
  requireStoreMembership(request({}, { id: '1', email: 'a@b.c', role: 'STORE_OWNER', storeId: 'a'.repeat(24) }), fakeResponse().res, () => { allowed = true })
  assert.equal(allowed, true)
})
