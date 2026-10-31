import test from 'node:test'
import assert from 'node:assert/strict'

import { cleanText, isCount, isEmail, isIdempotencyKey, isMoney, roundMoney } from '../src/utils/validation.js'

test('roundMoney removes floating-point drift', () => {
  assert.equal(roundMoney(0.1 * 3), 0.3)
  assert.equal(roundMoney(19.999), 20)
  assert.equal(roundMoney(1.005 * 100 / 100), 1.01)
})

test('isMoney accepts finite non-negative amounts only', () => {
  assert.equal(isMoney(0), true)
  assert.equal(isMoney(12.5), true)
  for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, '5', null, undefined, 1e12]) assert.equal(isMoney(bad), false)
})

test('isCount accepts whole non-negative numbers only', () => {
  assert.equal(isCount(0), true)
  assert.equal(isCount(25), true)
  for (const bad of [-1, 1.5, '3', Number.NaN, 2 ** 53]) assert.equal(isCount(bad), false)
})

test('cleanText trims and rejects non-strings, blanks and overlong values', () => {
  assert.equal(cleanText('  Lucky Me  '), 'Lucky Me')
  for (const bad of [123, '', '   ', null, {}, 'x'.repeat(65)]) assert.equal(cleanText(bad), null)
})

test('idempotency keys must be short URL-safe tokens', () => {
  assert.equal(isIdempotencyKey('3f2b1c9e-7a4d-4e2b-9c11-0a1b2c3d4e5f'), true)
  for (const bad of ['short', 'has space in it', '', 42, 'x'.repeat(65)]) assert.equal(isIdempotencyKey(bad), false)
})

test('isEmail needs one @, text before it and a dotted domain, and no spaces', () => {
  for (const good of ['a@b.co', 'first.last@store.example.ph', 'a+tag@sub.domain.com']) assert.equal(isEmail(good), true, good)
  for (const bad of ['', 'plain', '@b.co', 'a@', 'a@b', 'a@b.', 'a@.b', 'a b@c.de', 'a@b c.de', 'a@@b.co', 'a@b@c.de']) assert.equal(isEmail(bad), false, bad)
})

test('isEmail stays fast on pathological input, which backtracks badly in the old regular expression', () => {
  const started = performance.now()
  for (const hostile of ['a@' + '.'.repeat(50_000), 'a'.repeat(50_000) + '@', '@'.repeat(50_000), 'a@' + 'b.'.repeat(25_000)]) assert.equal(isEmail(hostile), false)
  assert.ok(performance.now() - started < 200, 'checking oversized input should take milliseconds')
})
