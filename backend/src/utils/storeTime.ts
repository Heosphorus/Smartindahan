// Stores operate in Philippine time (UTC+8, no daylight saving). Sales are stored as UTC instants,
// so "today", weekly and monthly figures must be bucketed by the store's calendar day, not the UTC day.
export const STORE_TIMEZONE = 'Asia/Manila'
const STORE_UTC_OFFSET_MS = 8 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/** The UTC instant at which the store's calendar day containing `now` began. */
export function startOfStoreDay(now: Date): Date {
  const shifted = now.getTime() + STORE_UTC_OFFSET_MS
  return new Date(Math.floor(shifted / DAY_MS) * DAY_MS - STORE_UTC_OFFSET_MS)
}

/** The UTC instant at which the store's calendar month containing `now` began. */
export function startOfStoreMonth(now: Date): Date {
  const shifted = new Date(now.getTime() + STORE_UTC_OFFSET_MS)
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1) - STORE_UTC_OFFSET_MS)
}

/** The store-local calendar date (YYYY-MM-DD) of an instant. */
export function storeDateKey(date: Date): string {
  return new Date(date.getTime() + STORE_UTC_OFFSET_MS).toISOString().slice(0, 10)
}

/** Store-local dates (YYYY-MM-DD), oldest first, for each day from `start` through the day containing `now`. */
export function storeDateRange(start: Date, now: Date): string[] {
  const days = Math.round((startOfStoreDay(now).getTime() - startOfStoreDay(start).getTime()) / DAY_MS) + 1
  return Array.from({ length: Math.max(days, 0) }, (_, index) => storeDateKey(new Date(startOfStoreDay(start).getTime() + index * DAY_MS)))
}
