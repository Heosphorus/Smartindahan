import { Router, type Request } from 'express'

import { getPolicy, listCurrentPolicies } from '../controllers/legalController.js'
import { clientKey, rateLimit } from '../middleware/rateLimitMiddleware.js'

const router = Router()

// Public on purpose: people must be able to read the policies before they register.
router.use(rateLimit(120, 15 * 60 * 1000, (req: Request) => `legal:${clientKey(req)}`))
router.get('/policies', listCurrentPolicies)
router.get('/policies/:type', getPolicy)

export default router
