import type { NextFunction, Response } from 'express'

import { pendingReviews } from '../services/policyService.js'
import { parseObjectId } from '../utils/objectId.js'
import type { AuthenticatedRequest } from './authMiddleware.js'

/**
 * Blocks store features until the user has accepted the current Terms of Service (see policyService for why only the
 * Terms block). Privacy tools (export, deletion, requests), sign-out and the policy pages stay available, so a user who
 * does not agree can still leave with their data.
 */
export async function requirePolicyAcceptance(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  if (req.user?.role === 'ADMIN') {
    next()
    return
  }
  const userId = parseObjectId(req.user?.id)
  if (!userId) {
    res.status(401).json({ message: 'Authentication required.' })
    return
  }
  const blocking = (await pendingReviews(userId)).filter((review) => review.blocking)
  if (blocking.length > 0) {
    res.status(403).json({
      code: 'POLICY_REVIEW_REQUIRED',
      message: 'Please review and accept the updated Terms of Service to continue.',
      pending: blocking.map(({ policyType, version }) => ({ policyType, version })),
    })
    return
  }
  next()
}
