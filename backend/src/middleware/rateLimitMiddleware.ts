import type { NextFunction, Request, Response } from 'express'

const attempts = new Map<string, { count: number; firstRequestAt: number }>()

export function rateLimit(maxRequests: number, windowMs: number, keyBuilder?: (req: Request) => string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = keyBuilder ? keyBuilder(req) : req.ip ?? 'global'
    const now = Date.now()
    const current = attempts.get(key)

    if (!current) {
      attempts.set(key, { count: 1, firstRequestAt: now })
      next()
      return
    }

    if (now - current.firstRequestAt > windowMs) {
      attempts.set(key, { count: 1, firstRequestAt: now })
      next()
      return
    }

    if (current.count >= maxRequests) {
      res.status(429).json({ message: 'Too many requests. Please try again later.' })
      return
    }

    attempts.set(key, { count: current.count + 1, firstRequestAt: current.firstRequestAt })
    next()
  }
}
