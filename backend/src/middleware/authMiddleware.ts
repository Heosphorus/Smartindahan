import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

import { env } from '../config/env.js'

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string
    email: string
    role: string
  }
}

export function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token) {
    res.status(401).json({ message: 'Authentication required.' })
    return
  }

  try {
    const decoded = jwt.verify(token, env.jwtSecret) as { id: string; email: string; role: string }
    req.user = decoded
    next()
  } catch {
    res.status(401).json({ message: 'Session expired or invalid token.' })
  }
}

export function requireRole(...allowedRoles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ message: 'Authentication required.' })
      return
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({ message: 'You do not have permission to perform this action.' })
      return
    }

    next()
  }
}
