import type { Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

import { env } from '../config/env.js'
import { UserModel, type UserDocument } from '../models/User.js'
import type { AuthenticatedRequest } from '../middleware/authMiddleware.js'

export async function getAdminStats(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const totalUsers = await UserModel.countDocuments()
    const activeUsers = await UserModel.countDocuments({ isActive: true, isEmailVerified: true })
    const pendingUsers = await UserModel.countDocuments({ isEmailVerified: false })

    res.json({
      stats: {
        totalUsers,
        activeUsers,
        pendingUsers,
      },
    })
  } catch (error) {
    console.error('Error getting admin stats:', error)
    res.status(500).json({ message: 'Failed to retrieve admin statistics' })
  }
}

export async function getAllUsers(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const users = await UserModel.find({}, '-passwordHash -failedLoginAttempts -lockedUntil')
      .sort({ createdAt: -1 })
      .lean()

    const maskedUsers = users.map((user: any) => ({
      _id: user._id,
      email: user.email,
      maskedEmail: maskEmail(user.email),
      status: user.isEmailVerified ? (user.isActive ? 'Active' : 'Inactive') : 'Pending',
      createdAt: user.createdAt,
      storeName: user.storeName,
    }))

    res.json({ users: maskedUsers })
  } catch (error) {
    console.error('Error getting all users:', error)
    res.status(500).json({ message: 'Failed to retrieve users' })
  }
}

export async function changeUserPassword(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { userId, newPassword } = req.body

    if (!userId || !newPassword) {
      res.status(400).json({ message: 'User ID and new password are required' })
      return
    }

    if (newPassword.length < 8) {
      res.status(400).json({ message: 'Password must be at least 8 characters long' })
      return
    }

    const passwordHash = await bcrypt.hash(newPassword, 10)

    await UserModel.findByIdAndUpdate(userId, { passwordHash })

    res.json({ message: 'Password changed successfully' })
  } catch (error) {
    console.error('Error changing user password:', error)
    res.status(500).json({ message: 'Failed to change user password' })
  }
}

export async function changeUserEmail(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { userId, newEmail } = req.body

    if (!userId || !newEmail) {
      res.status(400).json({ message: 'User ID and new email are required' })
      return
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(newEmail)) {
      res.status(400).json({ message: 'Invalid email format' })
      return
    }

    const existingUser = await UserModel.findOne({ email: newEmail })
    if (existingUser) {
      res.status(400).json({ message: 'Email already in use' })
      return
    }

    await UserModel.findByIdAndUpdate(userId, { 
      email: newEmail.toLowerCase(),
      isEmailVerified: false 
    })

    res.json({ message: 'Email changed successfully. User will need to verify the new email.' })
  } catch (error) {
    console.error('Error changing user email:', error)
    res.status(500).json({ message: 'Failed to change user email' })
  }
}

export async function impersonateUser(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { userId } = req.body

    if (!userId) {
      res.status(400).json({ message: 'User ID is required' })
      return
    }

    const user = await UserModel.findById(userId)
    if (!user) {
      res.status(404).json({ message: 'User not found' })
      return
    }

    if (!user.isActive) {
      res.status(400).json({ message: 'Cannot impersonate inactive user' })
      return
    }

    const token = jwt.sign(
      { id: user._id, email: user.email, role: user.role },
      env.jwtSecret,
      { expiresIn: '7d' }
    )

    res.json({ token })
  } catch (error) {
    console.error('Error impersonating user:', error)
    res.status(500).json({ message: 'Failed to impersonate user' })
  }
}

function maskEmail(email: string): string {
  const [local, domain] = (email ?? '').split('@')
  if (!local || !domain) return '***@unknown'
  if (local.length <= 2) {
    return `${local[0]}***@${domain}`
  }
  return `${local[0]}${local[1]}***@${domain}`
}
