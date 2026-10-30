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
  bulkAddProducts: (names: string[], category: string, unit: string) => storeRequest<{ products: ProductRecord[]; message: string }>('/products/bulk', { names, category, unit }),
  updateProduct: (id: string, payload: Record<string, unknown>) => storeRequest<{ product: ProductRecord }>(`/products/${id}`, payload, 'PATCH'),
  deleteProduct: (id: string) => storeRequest<{ message: string }>(`/products/${id}`, undefined, 'DELETE'),
  lookupProduct: (rawValue: string) => storeRequest<{ found: boolean; product?: ProductRecord }>(`/products/barcode/lookup`, { rawValue }),
  checkout: (items: Array<{ productId: string; quantity: number }>, paymentMethod = 'Cash', idempotencyKey?: string) => storeRequest<{ sale: { code: string; total: number; profit: number } }>('/sales/checkout', { items, paymentMethod, ...(idempotencyKey ? { idempotencyKey } : {}) }),
  inventoryCount: (productId: string, scannedQuantity: number) => storeRequest<{ message: string }>('/inventory/count', { counts: [{ productId, scannedQuantity }] }),
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
}
