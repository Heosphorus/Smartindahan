import { Router } from 'express'

import {
  changeUserEmail,
  changeUserPassword,
  getAllUsers,
  getAdminStats,
  impersonateUser,
} from '../controllers/adminController.js'
import { authenticateToken, requireRole } from '../middleware/authMiddleware.js'

const router = Router()

// All admin routes require authentication and ADMIN role
router.get('/stats', authenticateToken, requireRole('ADMIN'), getAdminStats)
router.get('/users', authenticateToken, requireRole('ADMIN'), getAllUsers)
router.post('/users/password', authenticateToken, requireRole('ADMIN'), changeUserPassword)
router.post('/users/email', authenticateToken, requireRole('ADMIN'), changeUserEmail)
router.post('/users/impersonate', authenticateToken, requireRole('ADMIN'), impersonateUser)

export default router
