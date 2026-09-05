import { Router, type Request } from 'express'

import {
  forgotPassword,
  getCurrentUser,
  login,
  logout,
  register,
  resendOtp,
  resetPassword,
  verifyEmail,
  verifyResetOtp,
} from '../controllers/authController.js'
import { authenticateToken } from '../middleware/authMiddleware.js'
import { rateLimit } from '../middleware/rateLimitMiddleware.js'

const router = Router()

router.post('/register', rateLimit(5, 15 * 60 * 1000, (req: Request) => `register:${req.ip ?? 'unknown'}`), register)
router.post('/verify-email', verifyEmail)
router.post('/resend-otp', resendOtp)
router.post('/login', rateLimit(10, 15 * 60 * 1000, (req: Request) => `login:${req.ip ?? 'unknown'}`), login)
router.post('/logout', authenticateToken, logout)
router.post('/forgot-password', rateLimit(5, 15 * 60 * 1000, (req: Request) => `forgot:${req.ip ?? 'unknown'}`), forgotPassword)
router.post('/verify-reset-otp', verifyResetOtp)
router.post('/reset-password', resetPassword)
router.get('/me', authenticateToken, getCurrentUser)

export default router
