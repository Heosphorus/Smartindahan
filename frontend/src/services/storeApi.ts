import { handleAuthenticatedUnauthorized } from './apiSession'
import { API_BASE_URL } from './apiBase'

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

async function storeRequest<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const token = localStorage.getItem('sarismart_token')
  const response = await fetch(`${API_BASE_URL}/store${path}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    ...(body ? { headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) } : {}),
  })
  handleAuthenticatedUnauthorized(response.status, Boolean(token))
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    throw new Error('Store API returned an unexpected response. Open the Vite frontend URL, not a static HTML server.')
  }
  const data = await response.json() as T & { message?: string }
  if (!response.ok) throw new Error(data.message ?? 'Unable to load store data.')
  return data
}

export const storeApi = {
  dashboard: (period: 'weekly' | 'monthly' = 'weekly') => storeRequest<{ store: DashboardSummary['store']; kpis: DashboardSummary['kpis']; salesOverviewPeriod: DashboardSummary['salesOverviewPeriod']; salesOverview: DashboardSummary['salesOverview']; topSelling: DashboardSummary['topSelling']; lowStock: DashboardSummary['lowStock']; recentTransactions: DashboardSummary['recentTransactions'] }>(`/dashboard?period=${period}`),
  products: (page = 1, limit = 100) => storeRequest<{ products: ProductRecord[]; pagination: { page: number; limit: number; total: number } }>(`/products?page=${page}&limit=${limit}`),
  addProduct: (payload: Record<string, unknown>) => storeRequest<{ product: ProductRecord }>('/products', payload),
  bulkAddProducts: (names: string[], category: string, unit: string) => storeRequest<{ products: ProductRecord[]; message: string }>('/products/bulk', { names, category, unit }),
  updateProduct: (id: string, payload: Record<string, unknown>) => storeRequest<{ product: ProductRecord }>(`/products/${id}`, payload, 'PATCH'),
  deleteProduct: (id: string) => storeRequest<{ message: string }>(`/products/${id}`, undefined, 'DELETE'),
  lookupProduct: (rawValue: string) => storeRequest<{ found: boolean; product?: ProductRecord }>(`/products/barcode/lookup`, { rawValue }),
  checkout: (items: Array<{ productId: string; quantity: number }>, paymentMethod = 'Cash') => storeRequest<{ sale: { code: string; total: number; profit: number } }>('/sales/checkout', { items, paymentMethod }),
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
