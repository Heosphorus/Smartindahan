import type { Request } from 'express'
import { ipKeyGenerator, rateLimit as createRateLimiter } from 'express-rate-limit'

/**
 * The caller's address as a rate-limit key. IPv6 clients are grouped by network prefix, because one household or phone
 * is handed a whole range of addresses and could otherwise dodge the limit by switching address.
 */
export const clientKey = (req: Request): string => ipKeyGenerator(req.ip ?? 'unknown')

// Counters live in this process only, so on serverless hosts each warm instance keeps its own window.
export function rateLimit(maxRequests: number, windowMs: number, keyBuilder: (req: Request) => string = clientKey) {
  return createRateLimiter({
    windowMs,
    limit: maxRequests,
    keyGenerator: keyBuilder,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => { res.status(429).json({ message: 'Too many requests. Please try again later.' }) },
  })
}

/** A generous per-client ceiling for routes that have no tighter limit of their own; it stops floods, not normal use. */
export const generalLimit = (name: string, maxRequests: number) => rateLimit(maxRequests, 15 * 60 * 1000, (req) => `${name}:${clientKey(req)}`)
