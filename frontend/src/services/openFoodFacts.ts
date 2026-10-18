export type PublicProductDetails = { name: string; brand: string; category: string }

type OpenFoodFactsResponse = {
  status?: number
  product?: { product_name?: string; product_name_en?: string; brands?: string; categories?: string; categories_hierarchy?: string[] }
}

const concise = (value: unknown) => typeof value === 'string' ? value.split(',')[0]?.trim().slice(0, 64) ?? '' : ''

export async function lookupPublicProduct(barcode: string): Promise<PublicProductDetails | null> {
  const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=product_name,product_name_en,brands,categories,categories_hierarchy`, { signal: AbortSignal.timeout(8000) })
  if (!response.ok) throw new Error('Public product lookup is unavailable right now.')
  const data = await response.json() as OpenFoodFactsResponse
  if (data.status !== 1 || !data.product) return null
  const rawCategory = concise(data.product.categories_hierarchy?.at(-1) ?? data.product.categories)
  const category = rawCategory.includes(':')
    ? rawCategory.split(':').slice(1).join(':').replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
    : rawCategory
  const details = {
    name: concise(data.product.product_name || data.product.product_name_en),
    brand: concise(data.product.brands),
    category,
  }
  return details.name || details.brand || details.category ? details : null
}
