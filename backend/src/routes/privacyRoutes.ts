import { Router, type Request } from 'express'

import {
  acceptPolicy,
  cancelAccountDeletion,
  exportMyData,
  getPrivacyOverview,
  getPrivacyStatus,
  listMyPrivacyRequests,
  requestAccountDeletion,
  submitPrivacyRequest,
} from '../controllers/privacyController.js'
import { authenticateToken } from '../middleware/authMiddleware.js'
import { rateLimit } from '../middleware/rateLimitMiddleware.js'

const router = Router()
const limit = (name: string, max: number, windowMs: number) => rateLimit(max, windowMs, (req: Request) => `privacy-${name}:${req.ip ?? 'unknown'}`)

// Deliberately NOT behind the policy-acceptance gate: someone who declines updated terms can still read their status,
// download their data, send a request and ask for deletion.
router.use(authenticateToken)
router.get('/status', getPrivacyStatus)
router.get('/overview', getPrivacyOverview)
router.post('/consents', limit('consent', 20, 15 * 60 * 1000), acceptPolicy)
router.get('/export', limit('export', 5, 60 * 60 * 1000), exportMyData)
router.get('/requests', listMyPrivacyRequests)
router.post('/requests', limit('request', 10, 60 * 60 * 1000), submitPrivacyRequest)
router.post('/deletion', limit('deletion', 5, 60 * 60 * 1000), requestAccountDeletion)
router.delete('/deletion', cancelAccountDeletion)

export default router
