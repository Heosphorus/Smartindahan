import assert from 'node:assert/strict'
import test from 'node:test'

import { parseObjectId } from '../src/utils/objectId.js'

test('parseObjectId accepts a 24-character hexadecimal string', () => {
  const id = parseObjectId('507f1f77bcf86cd799439011')
  assert.ok(id)
  assert.equal(id.toString(), '507f1f77bcf86cd799439011')
})

test('parseObjectId rejects operator-shaped objects and malformed strings', () => {
  assert.equal(parseObjectId({ $ne: null }), null)
  assert.equal(parseObjectId('not-an-object-id'), null)
  assert.equal(parseObjectId(null), null)
})