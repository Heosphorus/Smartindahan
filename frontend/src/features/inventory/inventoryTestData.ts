import type { ProductPage } from '../../services/inventoryApi'
import type { ProductRecord } from '../../services/storeApi'

/** A product record for tests; the name doubles as its id. */
export const item = (name: string, overrides: Partial<ProductRecord> = {}): ProductRecord => ({
  _id: name, name, category: 'Drinks', sellingPrice: 20, costPrice: 12, currentStock: 10, minStock: 3, unit: 'piece', ...overrides,
})

/** A product list response like the server's. */
export const pageOf = (products: ProductRecord[], overrides: Partial<ProductPage> = {}): ProductPage => ({
  products,
  pagination: { page: 1, limit: 20, total: products.length },
  summary: { all: products.length, out: products.filter((product) => product.currentStock <= 0).length, low: products.filter((product) => product.currentStock > 0 && product.minStock > 0 && product.currentStock <= product.minStock).length },
  categories: ['Drinks', 'Snacks'],
  ...overrides,
})
