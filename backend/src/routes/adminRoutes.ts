import { Router } from 'express'

import {
  changeUserEmail,
  changeUserPassword,
  getAllUsers,
  getAdminStats,
  impersonateUser,
} from '../controllers/adminController.js'
import { listPrivacyRequests, publishPolicyVersion, updatePrivacyRequest } from '../controllers/adminPrivacyController.js'
import { authenticateToken, requireRole } from '../middleware/authMiddleware.js'
import { generalLimit } from '../middleware/rateLimitMiddleware.js'

const router = Router()

// All admin routes require authentication and ADMIN role
router.use(generalLimit('admin', 600))
router.get('/stats', authenticateToken, requireRole('ADMIN'), getAdminStats)
router.get('/users', authenticateToken, requireRole('ADMIN'), getAllUsers)
router.post('/users/password', authenticateToken, requireRole('ADMIN'), changeUserPassword)
router.post('/users/email', authenticateToken, requireRole('ADMIN'), changeUserEmail)
router.post('/users/impersonate', authenticateToken, requireRole('ADMIN'), impersonateUser)
router.post('/policies', authenticateToken, requireRole('ADMIN'), publishPolicyVersion)
router.get('/privacy-requests', authenticateToken, requireRole('ADMIN'), listPrivacyRequests)
router.patch('/privacy-requests/:id', authenticateToken, requireRole('ADMIN'), updatePrivacyRequest)

export default router
