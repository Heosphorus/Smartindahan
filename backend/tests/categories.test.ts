import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'

import { AuditLogModel } from '../src/models/AuditLog.js'
import { ProductModel } from '../src/models/Product.js'
import { api, createStore, startTestServer, stopTestServer } from './helpers/testServer.js'

before(async () => { await startTestServer() }, { timeout: 300_000 })
after(async () => { await stopTestServer() })

type Change = { message: string; category: string; moved: number }
type Store = Awaited<ReturnType<typeof createStore>>

async function stock(store: Store, products: Array<{ name: string; category: string; status?: 'active' | 'archived' }>) {
  await ProductModel.insertMany(products.map((product) => ({ storeId: store.user._id, costPrice: 1, sellingPrice: 2, ...product })))
}
const categoriesOf = async (store: Store, status: 'active' | 'archived' = 'active') =>
  ((await ProductModel.find({ storeId: store.user._id, status }).lean()).map((product) => `${product.name}:${product.category}`)).sort()

test('renaming a category changes it on every product of that store only, and is audited', async () => {
  const mine = await createStore()
  const other = await createStore()
  await stock(mine, [{ name: 'Coke', category: 'Drinks' }, { name: 'Pepsi', category: 'Drinks' }, { name: 'Soap', category: 'Household' }, { name: 'Old coke', category: 'Drinks', status: 'archived' }])
  await stock(other, [{ name: 'Their coke', category: 'Drinks' }])

  const result = await api<Change>('/api/store/categories/rename', { token: mine.token, body: { name: 'Drinks', newName: 'Beverages' } })
  assert.equal(result.status, 200)
  assert.equal(result.body.category, 'Beverages')
  assert.equal(result.body.moved, 2, 'counts active products')
  assert.deepEqual(await categoriesOf(mine), ['Coke:Beverages', 'Pepsi:Beverages', 'Soap:Household'])
  assert.deepEqual(await categoriesOf(mine, 'archived'), ['Old coke:Beverages'], 'archived products stay in step so restoring one never brings back the old name')
  assert.deepEqual(await categoriesOf(other), ['Their coke:Drinks'], 'another store is untouched')
  assert.equal(await AuditLogModel.countDocuments({ storeId: mine.user._id, event: 'CATEGORY_RENAMED' }), 1)
})

test('renaming into an existing category merges, ignoring capitals and spacing', async () => {
  const store = await createStore()
  await stock(store, [{ name: 'A', category: 'Snacks' }, { name: 'B', category: 'Chips' }])
  const result = await api<Change>('/api/store/categories/rename', { token: store.token, body: { name: 'Chips', newName: '  snacks ' } })
  assert.equal(result.status, 200)
  assert.equal(result.body.category, 'Snacks', 'uses the existing spelling')
  assert.match(result.body.message, /merged/)
  assert.deepEqual(await categoriesOf(store), ['A:Snacks', 'B:Snacks'])

  const caseOnly = await api<Change>('/api/store/categories/rename', { token: store.token, body: { name: 'Snacks', newName: 'SNACKS' } })
  assert.equal(caseOnly.status, 200)
  assert.deepEqual(await categoriesOf(store), ['A:SNACKS', 'B:SNACKS'], 'a capital-letter change to the same category is allowed')
})

test('rename rejects blank, unchanged, over-long and unknown categories', async () => {
  const store = await createStore()
  await stock(store, [{ name: 'A', category: 'Snacks' }])
  const bad: Array<[Record<string, unknown>, number]> = [
    [{ name: 'Snacks', newName: '' }, 400],
    [{ name: 'Snacks', newName: '   ' }, 400],
    [{ name: 'Snacks', newName: 'Snacks' }, 400],
    [{ name: 'Snacks', newName: 'x'.repeat(65) }, 400],
    [{ name: 'Snacks', newName: { $ne: null } }, 400],
    [{ name: { $ne: null }, newName: 'Other' }, 400],
    [{ name: 'Missing', newName: 'Other' }, 404],
  ]
  for (const [body, status] of bad) {
    const response = await api('/api/store/categories/rename', { token: store.token, body })
    assert.equal(response.status, status, `expected ${status} for ${JSON.stringify(body)}`)
  }
  assert.deepEqual(await categoriesOf(store), ['A:Snacks'])
  assert.equal((await api('/api/store/categories/rename', { body: { name: 'Snacks', newName: 'X' } })).status, 401)
})

test('deleting a category keeps its products and moves them to Uncategorized or the chosen category', async () => {
  const store = await createStore()
  await stock(store, [{ name: 'A', category: 'Old' }, { name: 'B', category: 'Old' }, { name: 'C', category: 'Old2' }, { name: 'D', category: 'Keep' }, { name: 'Gone', category: 'Old', status: 'archived' }])

  const toDefault = await api<Change>('/api/store/categories/delete', { token: store.token, body: { name: 'Old' } })
  assert.equal(toDefault.status, 200)
  assert.equal(toDefault.body.category, 'Uncategorized')
  assert.equal(toDefault.body.moved, 2)
  assert.deepEqual(await categoriesOf(store), ['A:Uncategorized', 'B:Uncategorized', 'C:Old2', 'D:Keep'], 'no product was deleted')
  assert.deepEqual(await categoriesOf(store, 'archived'), ['Gone:Uncategorized'])

  const toChosen = await api<Change>('/api/store/categories/delete', { token: store.token, body: { name: 'Old2', moveTo: 'keep' } })
  assert.equal(toChosen.status, 200)
  assert.equal(toChosen.body.category, 'Keep', 'joins the existing category regardless of capitals')
  assert.deepEqual(await categoriesOf(store), ['A:Uncategorized', 'B:Uncategorized', 'C:Keep', 'D:Keep'])
  assert.equal(await AuditLogModel.countDocuments({ storeId: store.user._id, event: 'CATEGORY_DELETED' }), 2)
})

test('delete refuses to move products into the category being deleted, or to an unknown category name', async () => {
  const store = await createStore()
  await stock(store, [{ name: 'A', category: 'Old' }])
  assert.equal((await api('/api/store/categories/delete', { token: store.token, body: { name: 'Old', moveTo: ' old ' } })).status, 400)
  assert.equal((await api('/api/store/categories/delete', { token: store.token, body: { name: 'Old', moveTo: 'y'.repeat(65) } })).status, 400)
  assert.equal((await api('/api/store/categories/delete', { token: store.token, body: { name: 'Nope' } })).status, 404)
  assert.equal((await api('/api/store/categories/delete', { body: { name: 'Old' } })).status, 401)
  assert.deepEqual(await categoriesOf(store), ['A:Old'])
})
