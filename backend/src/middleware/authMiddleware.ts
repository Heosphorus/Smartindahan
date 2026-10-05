import type { Request, Response, NextFunction } from 'express'
import jwt, { type JwtPayload } from 'jsonwebtoken'
import mongoose from 'mongoose'

import { env } from '../config/env.js'
import { UserModel } from '../models/User.js'

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string
    email: string
    role: string
    storeId?: string
  }
}

export async function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token) {
    res.status(401).json({ message: 'Authentication required.' })
    return
  }

  let decoded: JwtPayload
  try {
    const verified = jwt.verify(token, env.jwtSecret)
    if (typeof verified === 'string') throw new Error('Invalid token payload')
    decoded = verified
  } catch {
    res.status(401).json({ message: 'Session expired or invalid token.' })
    return
  }

  const id = typeof decoded.id === 'string' ? decoded.id : decoded.sub
  if (!id || !mongoose.isValidObjectId(id)) {
    res.status(401).json({ message: 'Session expired or invalid token.' })
    return
  }

  const user = await UserModel.findById(id).select('email role isActive isEmailVerified tokenVersion').lean()
  if (!user || !user.isActive || !user.isEmailVerified) {
    res.status(401).json({ message: 'Session expired or invalid token.' })
    return
  }
  if (typeof decoded.tokenVersion !== 'number' || decoded.tokenVersion !== (user.tokenVersion ?? 0)) {
    res.status(401).json({ message: 'Session expired or invalid token.' })
    return
  }

  req.user = {
    id: user._id.toString(),
    email: user.email,
    role: user.role,
    ...(user.role === 'STORE_OWNER' ? { storeId: user._id.toString() } : {}),
  }
  next()
}

export function requireStoreMembership(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user?.storeId || !mongoose.isValidObjectId(req.user.storeId)) {
    res.status(403).json({ message: 'This account is not assigned to a store.' })
    return
  }
  next()
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
