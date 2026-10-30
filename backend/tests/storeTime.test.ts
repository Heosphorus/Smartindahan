import test from 'node:test'
import assert from 'node:assert/strict'

import { startOfStoreDay, startOfStoreMonth, storeDateKey, storeDateRange } from '../src/utils/storeTime.js'

test('a sale at 1 AM Manila time belongs to the Manila day, not the previous UTC day', () => {
  const oneAmManila = new Date('2026-03-10T17:00:00Z') // 2026-03-11 01:00 in Manila
  assert.equal(storeDateKey(oneAmManila), '2026-03-11')
  assert.equal(startOfStoreDay(oneAmManila).toISOString(), '2026-03-10T16:00:00.000Z')
})

test('a sale at 11 PM Manila time stays on the same Manila day', () => {
  const elevenPmManila = new Date('2026-03-11T15:00:00Z')
  assert.equal(storeDateKey(elevenPmManila), '2026-03-11')
  assert.equal(startOfStoreDay(elevenPmManila).toISOString(), '2026-03-10T16:00:00.000Z')
})

test('month start is the first Manila day of the month', () => {
  assert.equal(startOfStoreMonth(new Date('2026-03-31T17:00:00Z')).toISOString(), '2026-03-31T16:00:00.000Z')
  assert.equal(startOfStoreMonth(new Date('2026-03-15T00:00:00Z')).toISOString(), '2026-02-28T16:00:00.000Z')
})

test('date range lists each Manila day through today, oldest first', () => {
  const now = new Date('2026-03-11T17:00:00Z') // 2026-03-12 01:00 Manila
  const start = new Date(startOfStoreDay(now).getTime() - 6 * 86400000)
  assert.deepEqual(storeDateRange(start, now), ['2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12'])
})
