import { useEffect, useState } from 'react'

import { inventoryApi } from '../../services/inventoryApi'
import type { ProductRecord } from '../../services/storeApi'

const SEARCH_DELAY_MS = 250

export type ProductMatches = { loaded: boolean; failed: boolean; products: ProductRecord[] }
const NONE: ProductMatches = { loaded: false, failed: false, products: [] }

/** Products matching typed text (name, SKU, barcode or brand), looked up on the server once typing pauses. */
export function useProductMatches(query: string, limit = 6): ProductMatches {
  const [state, setState] = useState<{ query: string; failed: boolean; products: ProductRecord[] } | null>(null)

  useEffect(() => {
    if (!query) return undefined
    let active = true
    const timer = window.setTimeout(() => {
      inventoryApi.listProducts({ q: query, limit })
        .then((page) => { if (active) setState({ query, failed: false, products: page.products }) })
        .catch(() => { if (active) setState({ query, failed: true, products: [] }) })
    }, SEARCH_DELAY_MS)
    return () => { active = false; window.clearTimeout(timer) }
  }, [query, limit])

  return query && state?.query === query ? { loaded: true, failed: state.failed, products: state.products } : NONE
}
