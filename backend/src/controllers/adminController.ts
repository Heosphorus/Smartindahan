import type { Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'

import { env } from '../config/env.js'
import { UserModel, type UserDocument } from '../models/User.js'
import type { AuthenticatedRequest } from '../middleware/authMiddleware.js'
import { AuditLogModel } from '../models/AuditLog.js'
import { validatePasswordStrength } from '../services/authService.js'
import { parseObjectId } from '../utils/objectId.js'

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
    console.error('Admin stats request failed:', error instanceof Error ? error.name : 'UnknownError')
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
    console.error('Admin user-list request failed:', error instanceof Error ? error.name : 'UnknownError')
    res.status(500).json({ message: 'Failed to retrieve users' })
  }
}

export async function changeUserPassword(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { userId, newPassword } = req.body
    const targetUserId = parseObjectId(userId)

    if (!targetUserId || !newPassword || typeof newPassword !== 'string') {
      res.status(400).json({ message: 'User ID and new password are required' })
      return
    }

    const passwordCheck = validatePasswordStrength(newPassword)
    if (!passwordCheck.isValid) {
      res.status(400).json({ message: passwordCheck.message })
      return
    }

    const passwordHash = await bcrypt.hash(newPassword, 10)

    const user = await UserModel.findByIdAndUpdate(targetUserId, { $set: { passwordHash }, $inc: { tokenVersion: 1 } }, { new: true })
    if (!user) { res.status(404).json({ message: 'User not found' }); return }
    if (req.user?.id) await AuditLogModel.create({ userId: new mongoose.Types.ObjectId(req.user.id), event: 'ADMIN_PASSWORD_CHANGED', metadata: { targetUserId: user._id.toString() } })

    res.json({ message: 'Password changed successfully' })
  } catch (error) {
    console.error('Admin password update failed:', error instanceof Error ? error.name : 'UnknownError')
    res.status(500).json({ message: 'Failed to change user password' })
  }
}

export async function changeUserEmail(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { userId, newEmail } = req.body
    const targetUserId = parseObjectId(userId)

    if (!targetUserId || !newEmail) {
      res.status(400).json({ message: 'User ID and new email are required' })
      return
    }

    const normalizedEmail = typeof newEmail === 'string' ? newEmail.trim().toLowerCase() : ''
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(normalizedEmail)) {
      res.status(400).json({ message: 'Invalid email format' })
      return
    }

    const existingUser = await UserModel.findOne({ email: normalizedEmail })
    if (existingUser) {
      res.status(400).json({ message: 'Email already in use' })
      return
    }

    const user = await UserModel.findByIdAndUpdate(targetUserId, { $set: { email: normalizedEmail, isEmailVerified: false }, $inc: { tokenVersion: 1 } }, { new: true })
    if (!user) { res.status(404).json({ message: 'User not found' }); return }
    if (req.user?.id) await AuditLogModel.create({ userId: new mongoose.Types.ObjectId(req.user.id), event: 'ADMIN_EMAIL_CHANGED', metadata: { targetUserId: user._id.toString() } })

    res.json({ message: 'Email changed successfully. User will need to verify the new email.' })
  } catch (error) {
    console.error('Admin email update failed:', error instanceof Error ? error.name : 'UnknownError')
    res.status(500).json({ message: 'Failed to change user email' })
  }
}

export async function impersonateUser(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { userId } = req.body
    const targetUserId = parseObjectId(userId)

    if (!targetUserId) {
      res.status(400).json({ message: 'User ID is required' })
      return
    }

    const user = await UserModel.findById(targetUserId)
    if (!user) {
      res.status(404).json({ message: 'User not found' })
      return
    }

    if (!user.isActive) {
      res.status(400).json({ message: 'Cannot impersonate inactive user' })
      return
    }

    const token = jwt.sign(
      { id: user._id, email: user.email, role: user.role, tokenVersion: user.tokenVersion },
      env.jwtSecret,
      { expiresIn: '15m' }
    )

    if (req.user?.id) await AuditLogModel.create({ userId: new mongoose.Types.ObjectId(req.user.id), event: 'ADMIN_IMPERSONATION', metadata: { targetUserId: user._id.toString() } })
    res.json({ token })
  } catch (error) {
    console.error('Admin impersonation failed:', error instanceof Error ? error.name : 'UnknownError')
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
