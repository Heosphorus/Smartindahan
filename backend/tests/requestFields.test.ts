import test from 'node:test'
import assert from 'node:assert/strict'

import { pickRequestFields } from '../src/utils/requestFields.js'

test('pickRequestFields excludes tenant and protected values not in its allow-list', () => {
  const result = pickRequestFields(['name', 'creditLimit'], {
    name: 'Customer One',
    creditLimit: 100,
    storeId: 'another-store',
    outstandingBalance: 9999,
    role: 'ADMIN',
  })

  assert.deepEqual(result, { name: 'Customer One', creditLimit: 100 })
})

test('pickRequestFields ignores arrays and null request bodies', () => {
  assert.deepEqual(pickRequestFields(['name'], null), {})
  assert.deepEqual(pickRequestFields(['name'], ['untrusted']), {})
})