async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('sarismart_token')
  const response = await fetch(`/api/business${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers ?? {}) } })
  const data = await response.json() as T & { message?: string }
  if (!response.ok) throw new Error(data.message ?? 'Unable to load business data.')
  return data
}

export type Sale = { transactionCode: string; total: number; estimatedProfit: number; paymentMethod: string; createdAt: string; items: Array<{ productName: string; quantity: number; lineTotal: number }> }
export type Customer = { _id: string; name: string; mobileNumber?: string; address?: string; outstandingBalance: number; creditLimit: number; utangRequestedAt?: string; utangPaidAt?: string }
export type Supplier = { _id: string; name: string; contactNumber?: string; address?: string }
export type Report = { summary: { sales: number; profit: number; transactions: number }; daily: Array<{ _id: string; sales: number; profit: number }>; paymentMethods: Array<{ _id: string; total: number; count: number }> }
export type Expense = { _id: string; category: string; description: string; amount: number; expenseDate: string }
export type Alert = { id: string; severity: string; title: string; message: string; createdAt: string }
export type Settings = { firstName: string; lastName: string; email: string; mobileNumber: string; storeName: string; storeAddress: string }

export const businessApi = {
  sales: () => request<{ sales: Sale[] }>('/sales'),
  reports: () => request<Report>('/reports/sales'),
  customers: () => request<{ customers: Customer[] }>('/customers'),
  addCustomer: (payload: Record<string, unknown>) => request<{ customer: Customer }>('/customers', { method: 'POST', body: JSON.stringify(payload) }),
  updateCustomer: (id: string, payload: Record<string, unknown>) => request<{ customer: Customer }>(`/customers/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteCustomer: (id: string) => request<{ message: string }>(`/customers/${id}`, { method: 'DELETE' }),
  suppliers: () => request<{ suppliers: Supplier[] }>('/suppliers'),
  addSupplier: (payload: Record<string, unknown>) => request<{ supplier: Supplier }>('/suppliers', { method: 'POST', body: JSON.stringify(payload) }),
  updateSupplier: (id: string, payload: Record<string, unknown>) => request<{ supplier: Supplier }>(`/suppliers/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteSupplier: (id: string) => request<{ message: string }>(`/suppliers/${id}`, { method: 'DELETE' }),
  expenses: () => request<{ expenses: Expense[] }>('/expenses'),
  addExpense: (payload: Record<string, unknown>) => request<{ expense: Expense }>('/expenses', { method: 'POST', body: JSON.stringify(payload) }),
  updateExpense: (id: string, payload: Record<string, unknown>) => request<{ expense: Expense }>(`/expenses/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteExpense: (id: string) => request<{ message: string }>(`/expenses/${id}`, { method: 'DELETE' }),
  alerts: () => request<{ alerts: Alert[] }>('/alerts'),
  settings: () => request<{ settings: Settings }>('/settings'),
  updateSettings: (payload: Partial<Settings>) => request<{ settings: Settings }>('/settings', { method: 'PATCH', body: JSON.stringify(payload) }),
}
