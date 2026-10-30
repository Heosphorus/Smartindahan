import { apiRequest } from './apiClient'

function request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  return apiRequest<T>(`/business${path}`, {
    ...(options.method ? { method: options.method } : {}),
    ...(options.body !== undefined ? { body: options.body } : {}),
    fallbackMessage: 'Unable to load business data.',
  })
}

type Page = { pagination: { page: number; limit: number; total: number } }

/** The API caps pages at 100 rows; keep fetching so stores with larger catalogs are not silently truncated. */
async function fetchEveryPage<T extends Page>(load: (page: number) => Promise<T>, rows: (page: T) => unknown[]): Promise<T> {
  const first = await load(1)
  let loaded = rows(first).length
  const merged = first
  for (let page = 2; loaded < first.pagination.total && page <= 100; page += 1) {
    const next = await load(page)
    const nextRows = rows(next)
    if (!nextRows.length) break
    rows(merged).push(...nextRows)
    loaded += nextRows.length
  }
  return merged
}

export type Sale = { transactionCode: string; total: number; estimatedProfit: number; paymentMethod: string; createdAt: string; items: Array<{ productName: string; quantity: number; lineTotal: number }> }
export type Customer = { _id: string; name: string; mobileNumber?: string; address?: string; outstandingBalance: number; creditLimit: number; utangRequestedAt?: string; utangPaidAt?: string }
export type Supplier = { _id: string; name: string; contactNumber?: string; address?: string }
export type Report = { summary: { sales: number; profit: number; transactions: number }; daily: Array<{ _id: string; sales: number; profit: number }>; paymentMethods: Array<{ _id: string; total: number; count: number }> }
export type Expense = { _id: string; category: string; description: string; amount: number; expenseDate: string }
export type Alert = { id: string; severity: string; title: string; message: string; createdAt: string }
export type Settings = { firstName: string; lastName: string; email: string; mobileNumber: string; storeName: string; storeAddress: string }

export type RestockStatus = 'out' | 'urgent' | 'soon' | 'low'
export type RestockSuggestion = {
  productId: string
  name: string
  unit: string
  status: RestockStatus
  currentStock: number
  minStock: number
  soldLast30Days: number
  averageDailySales: number
  daysOfStockLeft: number | null
  suggestedOrderQuantity: number
  estimatedCost: number
  confidence: 'ok' | 'low'
  reason: string
}
export type SlowMover = { productId: string; name: string; unit: string; currentStock: number; stockValue: number; daysInCatalog: number }
export type RestockInsights = {
  generatedAt: string
  windowDays: number
  coverDays: number
  summary: { needsRestock: number; out: number; urgent: number; estimatedOrderCost: number; slowMovers: number; moneyTiedInSlowMovers: number }
  suggestions: RestockSuggestion[]
  slowMovers: SlowMover[]
  method: string
}

export const businessApi = {
  sales: () => fetchEveryPage((page) => request<{ sales: Sale[] } & Page>(`/sales?page=${page}&limit=100`), (result) => result.sales),
  reports: () => request<Report>('/reports/sales'),
  customers: () => fetchEveryPage((page) => request<{ customers: Customer[] } & Page>(`/customers?page=${page}&limit=100`), (result) => result.customers),
  addCustomer: (payload: Record<string, unknown>) => request<{ customer: Customer }>('/customers', { method: 'POST', body: payload }),
  updateCustomer: (id: string, payload: Record<string, unknown>) => request<{ customer: Customer }>(`/customers/${id}`, { method: 'PATCH', body: payload }),
  deleteCustomer: (id: string) => request<{ message: string }>(`/customers/${id}`, { method: 'DELETE' }),
  suppliers: () => fetchEveryPage((page) => request<{ suppliers: Supplier[] } & Page>(`/suppliers?page=${page}&limit=100`), (result) => result.suppliers),
  addSupplier: (payload: Record<string, unknown>) => request<{ supplier: Supplier }>('/suppliers', { method: 'POST', body: payload }),
  updateSupplier: (id: string, payload: Record<string, unknown>) => request<{ supplier: Supplier }>(`/suppliers/${id}`, { method: 'PATCH', body: payload }),
  deleteSupplier: (id: string) => request<{ message: string }>(`/suppliers/${id}`, { method: 'DELETE' }),
  expenses: () => fetchEveryPage((page) => request<{ expenses: Expense[] } & Page>(`/expenses?page=${page}&limit=100`), (result) => result.expenses),
  addExpense: (payload: Record<string, unknown>) => request<{ expense: Expense }>('/expenses', { method: 'POST', body: payload }),
  updateExpense: (id: string, payload: Record<string, unknown>) => request<{ expense: Expense }>(`/expenses/${id}`, { method: 'PATCH', body: payload }),
  deleteExpense: (id: string) => request<{ message: string }>(`/expenses/${id}`, { method: 'DELETE' }),
  alerts: () => request<{ alerts: Alert[] }>('/alerts'),
  restockInsights: (coverDays = 14) => request<RestockInsights>(`/insights/restock?coverDays=${coverDays}`),
  settings: () => request<{ settings: Settings }>('/settings'),
  updateSettings: (payload: Partial<Settings>) => request<{ settings: Settings }>('/settings', { method: 'PATCH', body: payload }),
}
