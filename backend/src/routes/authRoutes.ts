import { Router, type Request } from 'express'

import {
  changePassword,
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
import { clientKey, generalLimit, rateLimit } from '../middleware/rateLimitMiddleware.js'

const router = Router()
// Sessions and logout have no tighter limit of their own; the credential routes below do.
const sessionLimit = generalLimit('session', 300)

router.post('/register', rateLimit(5, 15 * 60 * 1000, (req: Request) => `register:${clientKey(req)}`), register)
router.post('/verify-email', rateLimit(10, 15 * 60 * 1000, (req: Request) => `verify-email:${clientKey(req)}`), verifyEmail)
router.post('/resend-otp', rateLimit(3, 15 * 60 * 1000, (req: Request) => `resend-otp:${clientKey(req)}`), resendOtp)
router.post('/login', rateLimit(10, 15 * 60 * 1000, (req: Request) => `login:${clientKey(req)}`), login)
router.post('/logout', sessionLimit, authenticateToken, logout)
router.post('/forgot-password', rateLimit(5, 15 * 60 * 1000, (req: Request) => `forgot:${clientKey(req)}`), forgotPassword)
router.post('/verify-reset-otp', rateLimit(10, 15 * 60 * 1000, (req: Request) => `verify-reset:${clientKey(req)}`), verifyResetOtp)
router.post('/reset-password', rateLimit(5, 15 * 60 * 1000, (req: Request) => `reset-password:${clientKey(req)}`), resetPassword)
router.post('/change-password', authenticateToken, rateLimit(5, 15 * 60 * 1000, (req: Request) => `change-password:${clientKey(req)}`), changePassword)
router.get('/me', sessionLimit, authenticateToken, getCurrentUser)

export default router
