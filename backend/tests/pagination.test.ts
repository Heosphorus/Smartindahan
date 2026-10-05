import test from 'node:test'
import assert from 'node:assert/strict'

import { parsePagination } from '../src/utils/pagination.js'

test('pagination uses bounded defaults and calculates offsets', () => {
  assert.deepEqual(parsePagination({}), { page: 1, limit: 100, skip: 0 })
  assert.deepEqual(parsePagination({ page: '3', limit: '25' }), { page: 3, limit: 25, skip: 50 })
})

test('pagination rejects invalid values and limits above the maximum', () => {
  assert.equal(parsePagination({ page: '0' }), null)
  assert.equal(parsePagination({ limit: '101' }), null)
  assert.equal(parsePagination({ page: '1.5' }), null)
})