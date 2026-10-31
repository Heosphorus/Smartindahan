import { apiRequest, ApiError } from './apiClient'
import type { ProductRecord } from './storeApi'

export type StockStatus = 'out' | 'low' | 'ok'
export type StatusFilter = 'all' | StockStatus

export type ProductQuery = { q?: string; category?: string; status?: StatusFilter; sort?: 'name' | 'stock'; page?: number; limit?: number }
export type ProductPage = {
  products: ProductRecord[]
  pagination: { page: number; limit: number; total: number }
  /** Whole-store counts, so the filter chips can show how many products need attention. */
  summary: { all: number; out: number; low: number }
  categories: string[]
}

export type BarcodeResult =
  | { found: true; product: ProductRecord }
  | { found: false; barcode: string; message: string; archived?: { id: string; name: string } }

export type RestockLine = { productId: string; quantity: number; unit: 'base' | 'purchase'; unitCost: number }
export type PurchaseResult = {
  message: string
  replayed?: boolean
  purchase: { id: string; total: number; supplierName: string | null; items: Array<{ productId: string; name: string; added: number; previousStock: number; newStock: number; lineTotal: number }> }
}

export type MovementType = 'sale' | 'stock_in' | 'stock_out' | 'inventory_count' | 'adjustment'
export type Movement = { id: string; productId: string; type: MovementType; quantity: number; previousStock: number; newStock: number; reason?: string; note?: string; unitCost?: number; purchaseId?: string; countId?: string; createdAt: string }

export type CountItem = {
  productId: string
  name: string
  unit: string
  expectedQuantity: number
  countedQuantity: number
  difference: number
  reason: string
  /** Stock right now, and how much it moved since this product was counted (open counts only). */
  stockNow?: number | null
  movedSinceCount?: number | null
}
export type StockCount = { id: string; name: string; status: 'open' | 'applied' | 'discarded'; items: CountItem[]; updatedAt?: string; appliedAt?: string | null }
export type CountSummary = { id: string; name: string; status: 'open' | 'applied'; itemCount: number; discrepancies: number; updatedAt: string; appliedAt: string | null }
export type CountInput = { productId: string; countedQuantity: number; reason?: string }

const request = <T>(path: string, body?: unknown, method?: string) => apiRequest<T>(`/store${path}`, { ...(body !== undefined ? { body } : {}), ...(method ? { method } : {}), fallbackMessage: 'Unable to reach your inventory right now.' })

/** A key that stays the same for retries of one submission, so the server can recognise a repeat and not apply it twice. */
export function newRequestKey(): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  return `k-${random}`.slice(0, 64)
}

export const inventoryApi = {
  listProducts: (query: ProductQuery = {}) => {
    const params = new URLSearchParams()
    if (query.q) params.set('q', query.q)
    if (query.category) params.set('category', query.category)
    if (query.status && query.status !== 'all') params.set('status', query.status)
    if (query.sort && query.sort !== 'name') params.set('sort', query.sort)
    params.set('page', String(query.page ?? 1))
    params.set('limit', String(query.limit ?? 20))
    return request<ProductPage>(`/products?${params.toString()}`)
  },

  /** Looks a scanned or typed barcode up in this store's own catalog. Unknown and archived codes are results, not errors. */
  async lookupBarcode(rawValue: string): Promise<BarcodeResult> {
    try {
      const response = await request<{ found: true; product: ProductRecord }>('/products/barcode/lookup', { rawValue })
      return { found: true, product: { ...response.product, _id: response.product._id ?? response.product.id } }
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        const data = (error.data ?? {}) as { archived?: { id: string; name: string }; message?: string }
        return { found: false, barcode: rawValue, message: data.message ?? 'Barcode not registered.', ...(data.archived ? { archived: data.archived } : {}) }
      }
      throw error
    }
  },
  restoreProduct: (id: string) => request<{ product: ProductRecord }>(`/products/${id}/restore`, {}),

  stockIn: (productId: string, quantity: number, idempotencyKey: string) => request<{ message: string }>('/inventory/stock-in', { items: [{ productId, quantity }], idempotencyKey }),
  stockOut: (productId: string, quantity: number, reason: string, idempotencyKey: string, note?: string) => request<{ message: string; product: { id: string; currentStock: number } }>('/inventory/stock-out', { productId, quantity, reason, idempotencyKey, ...(note ? { note } : {}) }),
  restock: (payload: { items: RestockLine[]; supplierId?: string; note?: string; updateProductCost?: boolean; idempotencyKey: string }) => request<PurchaseResult>('/inventory/restock', payload),
  movements: (productId: string, limit = 10) => request<{ movements: Movement[]; pagination: { total: number } }>(`/inventory/movements?productId=${encodeURIComponent(productId)}&limit=${limit}`),

  listCounts: (status: 'open' | 'applied') => request<{ counts: CountSummary[] }>(`/inventory/counts?status=${status}`),
  getCount: (id: string) => request<{ count: StockCount }>(`/inventory/counts/${id}`),
  createCount: (items: CountInput[], name?: string) => request<{ count: StockCount }>('/inventory/counts', { items, ...(name ? { name } : {}) }),
  saveCount: (id: string, items: CountInput[], name?: string) => request<{ count: StockCount }>(`/inventory/counts/${id}`, { items, ...(name ? { name } : {}) }, 'PUT'),
  applyCount: (id: string) => request<{ message: string; summary: { adjusted: number; unchanged: number; unitsAdded: number; unitsRemoved: number } }>(`/inventory/counts/${id}/apply`, {}),
  discardCount: (id: string) => request<{ message: string }>(`/inventory/counts/${id}/discard`, {}),
}
