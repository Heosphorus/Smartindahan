export type Pagination = { page: number; limit: number; skip: number }

export function parsePagination(query: Record<string, unknown>, defaultLimit = 100): Pagination | null {
  const pageValue = query.page === undefined ? 1 : Number(query.page)
  const limitValue = query.limit === undefined ? defaultLimit : Number(query.limit)
  if (!Number.isSafeInteger(pageValue) || pageValue < 1 || !Number.isSafeInteger(limitValue) || limitValue < 1 || limitValue > 100) return null
  return { page: pageValue, limit: limitValue, skip: (pageValue - 1) * limitValue }
}