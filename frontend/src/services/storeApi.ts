import { apiRequest } from './apiClient'

export type DashboardSummary = {
  store: { id: string; name: string }
  salesOverviewPeriod: 'weekly' | 'monthly'
  kpis: {
    todaysSales: number
    estimatedProfit: number
    outstandingUtang: number
    inventoryValue: number
    transactions: number
  }
  salesOverview: Array<{ date: string; sales: number }>
  topSelling: Array<{ rank: number; name: string; sold: number }>
  lowStock: Array<{ id: string; name: string; currentStock: number; minStock: number }>
  recentTransactions: Array<{ id: string; amount: number; paymentMethod: string; createdAt: string }>
}

function storeRequest<T>(path: string, body?: unknown, method?: string): Promise<T> {
  return apiRequest<T>(`/store${path}`, { ...(body !== undefined ? { body } : {}), ...(method ? { method } : {}), fallbackMessage: 'Unable to load store data.' })
}

export const storeApi = {
  dashboard: (period: 'weekly' | 'monthly' = 'weekly') => storeRequest<{ store: DashboardSummary['store']; kpis: DashboardSummary['kpis']; salesOverviewPeriod: DashboardSummary['salesOverviewPeriod']; salesOverview: DashboardSummary['salesOverview']; topSelling: DashboardSummary['topSelling']; lowStock: DashboardSummary['lowStock']; recentTransactions: DashboardSummary['recentTransactions'] }>(`/dashboard?period=${period}`),
  products: (page = 1, limit = 100) => storeRequest<{ products: ProductRecord[]; pagination: { page: number; limit: number; total: number } }>(`/products?page=${page}&limit=${limit}`),
  /** Every active product, following the API's 100-row pages. */
  allProducts: async (): Promise<ProductRecord[]> => {
    const pageSize = 100
    const first = await storeRequest<{ products: ProductRecord[]; pagination: { total: number } }>(`/products?page=1&limit=${pageSize}`)
    const pages = Math.ceil(first.pagination.total / pageSize)
    const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, index) => storeRequest<{ products: ProductRecord[] }>(`/products?page=${index + 2}&limit=${pageSize}`)))
    return [...first.products, ...rest.flatMap((page) => page.products)]
  },
  addProduct: (payload: Record<string, unknown>) => storeRequest<{ product: ProductRecord }>('/products', payload),
  bulkAddProducts: (payload: BulkProductPayload) => storeRequest<{ products: ProductRecord[]; message: string }>('/products/bulk', payload),
  /** Changes the selling price and/or cost of the chosen products together; if any price would be invalid, none change. */
  batchUpdateProducts: (ids: string[], changes: { sellingPrice?: PriceAdjustment; costPrice?: PriceAdjustment }) => storeRequest<{ message: string; updated: number; skipped: number }>('/products/batch-update', { ids, ...changes }),
  /** Removes the chosen products from the price list (the same archive as the single Archive button). */
  batchArchiveProducts: (ids: string[]) => storeRequest<{ message: string; archived: number }>('/products/batch-archive', { ids }),
  /** Renames a category on all its products. A name that matches another category merges the two. */
  renameCategory: (name: string, newName: string) => storeRequest<CategoryChange>('/categories/rename', { name, newName }),
  /** Deletes a category. Its products are kept and moved to `moveTo`, or to "Uncategorized" when that is left out. */
  deleteCategory: (name: string, moveTo?: string) => storeRequest<CategoryChange>('/categories/delete', { name, ...(moveTo ? { moveTo } : {}) }),
  updateProduct: (id: string, payload: Record<string, unknown>) => storeRequest<{ product: ProductRecord }>(`/products/${id}`, payload, 'PATCH'),
  deleteProduct: (id: string) => storeRequest<{ message: string }>(`/products/${id}`, undefined, 'DELETE'),
  lookupProduct: (rawValue: string) => storeRequest<{ found: boolean; product?: ProductRecord }>(`/products/barcode/lookup`, { rawValue }),
  checkout: (items: Array<{ productId: string; quantity: number }>, paymentMethod = 'Cash', idempotencyKey?: string) => storeRequest<{ sale: { code: string; total: number; profit: number } }>('/sales/checkout', { items, paymentMethod, ...(idempotencyKey ? { idempotencyKey } : {}) }),
  /** Records a counted quantity; `expectedQuantity` is what the person saw, so sales made since then are kept. */
  inventoryCount: (productId: string, scannedQuantity: number, expectedQuantity?: number) => storeRequest<{ message: string }>('/inventory/count', { counts: [{ productId, scannedQuantity, ...(expectedQuantity !== undefined ? { expectedQuantity } : {}) }] }),
}

/** `set` is an exact price; `percent` and `amount` are added to the current price (negative values lower it). */
export type PriceAdjustment = { type: 'set' | 'percent' | 'amount'; value: number }

export type CategoryChange = { message: string; category: string; moved: number }

/**
 * A bulk add: each item can carry its own selling price, and `sellingPrice` is the default for items without one.
 * Everything else is shared by every product. Cost is optional; the server stores 0 when it is left out.
 */
export type BulkProductPayload = {
  items: Array<{ name: string; sellingPrice?: number }>
  category: string
  unit: string
  sellingPrice?: number
  costPrice?: number
  brand?: string
  initialStock?: number
  minStock?: number
}

export type ProductRecord = {
  _id?: string
  id?: string
  name: string
  category: string
  brand?: string
  barcode?: string
  sku?: string
  sellingPrice: number
  costPrice: number
  currentStock: number
  minStock: number
  unit?: string
  /** The unit it is bought in (for example "pack") and how many selling units are in one; both or neither. */
  purchaseUnit?: string
  unitsPerPurchaseUnit?: number
}
