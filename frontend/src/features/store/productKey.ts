import type { ProductRecord } from '../../services/storeApi'

/** The id the API knows a product by (it arrives as `_id`, or `id` in some responses). */
export const productKey = (product: ProductRecord): string => product._id ?? product.id ?? ''
