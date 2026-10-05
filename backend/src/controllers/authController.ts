import bcrypt from 'bcryptjs'
import type { Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'

import { env } from '../config/env.js'
import { AuditLogModel, type AuditEvent } from '../models/AuditLog.js'
import { EmailVerificationModel } from '../models/EmailVerification.js'
import { PasswordResetModel } from '../models/PasswordReset.js'
import { UserModel } from '../models/User.js'
import {
  generateOtp,
  hashOtp,
  maskEmail,
  validateOtpCode,
  validatePasswordStrength,
  verifyOtpHash,
} from '../services/authService.js'
import { sendPasswordResetEmail, sendVerificationEmail } from '../services/emailService.js'
import type { AuthenticatedRequest } from '../middleware/authMiddleware.js'
import { parseObjectId } from '../utils/objectId.js'

const OTP_MAX_ATTEMPTS = 5
const OTP_EXPIRES_MS = 5 * 60 * 1000
const LOGIN_LOCK_MS = 15 * 60 * 1000
const loginRate = new Map<string, { count: number; firstRequestAt: number }>()

type RegisterPayload = {
  firstName?: string
  lastName?: string
  email?: string
  mobileNumber?: string
  password?: string
  confirmPassword?: string
  storeName?: string
  storeAddress?: string
  privacyPolicyAccepted?: boolean
  termsAccepted?: boolean
}

function issueToken(user: { id: string; email: string; role: string; tokenVersion: number }): string {
  const options = { expiresIn: env.jwtExpiresIn ?? '7d' } as jwt.SignOptions
  return jwt.sign({ id: user.id, email: user.email, role: user.role, tokenVersion: user.tokenVersion }, env.jwtSecret, options)
}

function clientIp(req: Request): string {
  return req.ip ?? req.headers['x-forwarded-for']?.toString() ?? 'unknown-ip'
}

function checkLoginRateLimit(req: Request): boolean {
  const key = clientIp(req)
  const now = Date.now()
  const current = loginRate.get(key)

  if (!current || now - current.firstRequestAt > 15 * 60 * 1000) {
    loginRate.set(key, { count: 1, firstRequestAt: now })
    return true
  }

  if (current.count >= 10) return false
  loginRate.set(key, { count: current.count + 1, firstRequestAt: current.firstRequestAt })
  return true
}

async function audit(req: Request, event: AuditEvent, userId?: mongoose.Types.ObjectId, metadata?: Record<string, unknown>): Promise<void> {
  const record: {
    event: AuditEvent
    ipAddress: string
    userId?: mongoose.Types.ObjectId
    userAgent?: string
    metadata?: Record<string, unknown>
  } = { event, ipAddress: clientIp(req) }
  const userAgent = req.get('user-agent')
  if (userId) record.userId = userId
  if (userAgent) record.userAgent = userAgent
  if (metadata) record.metadata = metadata
  await AuditLogModel.create(record)
}

function userResponse(user: { _id: mongoose.Types.ObjectId; firstName: string; lastName: string; email: string; role: string; storeName: string; isEmailVerified: boolean }) {
  return {
    id: user._id.toString(),
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    role: user.role,
    storeName: user.storeName,
    isEmailVerified: user.isEmailVerified,
  }
}

export async function register(req: Request, res: Response): Promise<void> {
  const payload = req.body as RegisterPayload
  const required = [payload.firstName, payload.lastName, payload.email, payload.mobileNumber, payload.password, payload.confirmPassword, payload.storeName, payload.storeAddress]

  if (required.some((value) => !value?.trim())) {
    res.status(400).json({ message: 'All fields are required.' })
    return
  }

  if (payload.privacyPolicyAccepted !== true || payload.termsAccepted !== true) {
    res.status(400).json({ message: 'You must accept the Privacy Policy and Terms of Service before creating an account.' })
    return
  }

  const email = payload.email!.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ message: 'Please enter a valid email address.' })
    return
  }

  const passwordCheck = validatePasswordStrength(payload.password!)
  if (!passwordCheck.isValid) {
    res.status(400).json({ message: passwordCheck.message })
    return
  }

  if (payload.password !== payload.confirmPassword) {
    res.status(400).json({ message: 'Passwords do not match.' })
    return
  }

  const existingEmail = await UserModel.exists({ email })
  if (existingEmail) {
    res.status(409).json({ message: 'An account with this email already exists.' })
    return
  }

  const storeName = payload.storeName!.trim()
  const existingStore = await UserModel.exists({ storeName: new RegExp(`^${storeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') })
  if (existingStore) {
    res.status(409).json({ message: 'A store with this name already exists.' })
    return
  }

  const user = await UserModel.create({
    firstName: payload.firstName!.trim(),
    lastName: payload.lastName!.trim(),
    email,
    mobileNumber: payload.mobileNumber!.trim(),
    passwordHash: await bcrypt.hash(payload.password!, 12),
    storeName,
    storeAddress: payload.storeAddress!.trim(),
    role: 'STORE_OWNER',
    privacyPolicyAccepted: true,
    termsAccepted: true,
    acceptedPoliciesAt: new Date(),
  })

  const otp = generateOtp()
  await EmailVerificationModel.deleteMany({ userId: user._id, verified: false })
  await EmailVerificationModel.create({
    userId: user._id,
    otpHash: hashOtp(otp),
    expiresAt: new Date(Date.now() + OTP_EXPIRES_MS),
  })

  try {
    await sendVerificationEmail(user.email, otp)
  } catch {
    await UserModel.deleteOne({ _id: user._id })
    await EmailVerificationModel.deleteMany({ userId: user._id })
    res.status(502).json({ message: 'Unable to send verification email at the moment.' })
    return
  }

  await audit(req, 'USER_REGISTERED', user._id)
  await audit(req, 'EMAIL_VERIFICATION_REQUESTED', user._id)
  res.status(201).json({ message: 'Registration successful. Please verify your email.', user: { id: user.id, email, status: 'EMAIL_VERIFICATION_REQUIRED', maskedEmail: maskEmail(email) } })
}

export async function verifyEmail(req: Request, res: Response): Promise<void> {
  const { userId, otp } = req.body as { userId?: string; otp?: string }
  const targetUserId = parseObjectId(userId)
  if (!targetUserId || !otp || !validateOtpCode(otp)) {
    res.status(400).json({ message: 'A valid 6-digit verification code is required.' })
    return
  }

  const entry = await EmailVerificationModel.findOne({ userId: targetUserId, verified: false }).select('+otpHash')
  if (!entry) {
    res.status(404).json({ message: 'Verification request not found.' })
    return
  }
  if (entry.expiresAt.getTime() < Date.now()) {
    res.status(410).json({ message: 'This verification code has expired. Please request a new code.' })
    return
  }
  if (entry.attempts >= OTP_MAX_ATTEMPTS) {
    res.status(429).json({ message: 'Too many attempts. Please request a new verification code.' })
    return
  }

  entry.attempts += 1
  if (!verifyOtpHash(otp, entry.otpHash)) {
    await entry.save()
    await audit(req, 'OTP_VERIFICATION_FAILED', entry.userId)
    res.status(400).json({ message: 'Incorrect verification code. Please try again.', remainingAttempts: OTP_MAX_ATTEMPTS - entry.attempts })
    return
  }

  const user = await UserModel.findByIdAndUpdate(targetUserId, { isEmailVerified: true }, { new: true })
  if (!user) {
    res.status(404).json({ message: 'User not found.' })
    return
  }

  entry.verified = true
  entry.usedAt = new Date()
  await entry.save()
  await audit(req, 'EMAIL_VERIFIED', user._id)
  res.status(200).json({ message: 'Email verified successfully.', user: { id: user.id, email: user.email, status: 'EMAIL_VERIFIED' } })
}

export async function resendOtp(req: Request, res: Response): Promise<void> {
  const { userId } = req.body as { userId?: string }
  const targetUserId = parseObjectId(userId)
  if (!targetUserId) {
    res.status(400).json({ message: 'A valid user ID is required.' })
    return
  }

  const user = await UserModel.findById(targetUserId)
  if (!user) {
    res.status(404).json({ message: 'User not found.' })
    return
  }

  const recentRequest = await EmailVerificationModel.findOne({ userId: targetUserId, createdAt: { $gt: new Date(Date.now() - 60 * 1000) } })
  if (recentRequest) {
    res.status(429).json({ message: 'Please wait before requesting another code.' })
    return
  }

  const otp = generateOtp()
  await EmailVerificationModel.deleteMany({ userId: targetUserId, verified: false })
  await EmailVerificationModel.create({ userId: user._id, otpHash: hashOtp(otp), expiresAt: new Date(Date.now() + OTP_EXPIRES_MS) })
  try {
    await sendVerificationEmail(user.email, otp)
  } catch {
    res.status(502).json({ message: 'Unable to resend verification code right now.' })
    return
  }

  await audit(req, 'OTP_REQUESTED', user._id)
  res.status(200).json({ message: 'A new verification code has been sent.', maskedEmail: maskEmail(user.email) })
}

export async function login(req: Request, res: Response): Promise<void> {
  if (!checkLoginRateLimit(req)) {
    res.status(429).json({ message: 'Too many login attempts. Please try again later.' })
    return
  }

  const { email: inputEmail, password } = req.body as { email?: string; password?: string }
  const email = inputEmail?.trim().toLowerCase()
  if (!email || !password) {
    res.status(400).json({ message: 'Email and password are required.' })
    return
  }

  const user = await UserModel.findOne({ email }).select('+passwordHash')
  if (!user || !user.isActive) {
    await audit(req, 'LOGIN_FAILED')
    res.status(401).json({ message: 'Invalid email or password.' })
    return
  }
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    res.status(423).json({ message: 'Account temporarily locked. Please try again later.' })
    return
  }

  const validPassword = await bcrypt.compare(password, user.passwordHash)
  if (!validPassword) {
    user.failedLoginAttempts += 1
    if (user.failedLoginAttempts >= 5) user.lockedUntil = new Date(Date.now() + LOGIN_LOCK_MS)
    await user.save()
    await audit(req, 'LOGIN_FAILED', user._id)
    res.status(401).json({ message: 'Invalid email or password.' })
    return
  }

  if (!user.isEmailVerified) {
    res.status(403).json({ message: 'Please verify your email before logging in.', status: 'EMAIL_VERIFICATION_REQUIRED', userId: user.id, maskedEmail: maskEmail(user.email) })
    return
  }

  user.failedLoginAttempts = 0
  user.lockedUntil = null
  user.lastLoginAt = new Date()
  await user.save()
  await audit(req, 'LOGIN_SUCCESSFUL', user._id)
  res.status(200).json({ message: 'Login successful.', token: issueToken({ id: user.id, email: user.email, role: user.role, tokenVersion: user.tokenVersion }), user: { ...userResponse(user), status: 'AUTHENTICATED' } })
}

export async function logout(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = parseObjectId(req.user?.id)
  if (userId) await audit(req, 'LOGOUT', userId)
  res.status(200).json({ message: 'Logged out successfully.' })
}

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const inputEmail = (req.body as { email?: string }).email
  const email = inputEmail?.trim().toLowerCase()
  if (!email) {
    res.status(400).json({ message: 'Email is required.' })
    return
  }

  const user = await UserModel.findOne({ email })
  if (!user) {
    res.status(200).json({ message: 'If an account exists, a reset code has been sent.' })
    return
  }

  const recentRequest = await PasswordResetModel.findOne({ userId: user._id, createdAt: { $gt: new Date(Date.now() - 60 * 1000) } })
  if (recentRequest) {
    res.status(429).json({ message: 'Please wait before requesting another code.' })
    return
  }

  const otp = generateOtp()
  await PasswordResetModel.deleteMany({ userId: user._id, verified: false })
  await PasswordResetModel.create({ userId: user._id, otpHash: hashOtp(otp), expiresAt: new Date(Date.now() + OTP_EXPIRES_MS) })
  try {
    await sendPasswordResetEmail(user.email, otp)
  } catch {
    res.status(502).json({ message: 'Unable to send reset code right now.' })
    return
  }

  await audit(req, 'PASSWORD_RESET_REQUESTED', user._id)
  res.status(200).json({ message: 'If an account exists, a reset code has been sent.', userId: user.id, maskedEmail: maskEmail(user.email) })
}

export async function verifyResetOtp(req: Request, res: Response): Promise<void> {
  const { userId, otp } = req.body as { userId?: string; otp?: string }
  const targetUserId = parseObjectId(userId)
  if (!targetUserId || !otp || !validateOtpCode(otp)) {
    res.status(400).json({ message: 'A valid reset code is required.' })
    return
  }

  const entry = await PasswordResetModel.findOne({ userId: targetUserId, verified: false }).select('+otpHash')
  if (!entry || entry.expiresAt.getTime() < Date.now()) {
    res.status(410).json({ message: 'This reset code has expired. Please request a new one.' })
    return
  }
  if (entry.attempts >= OTP_MAX_ATTEMPTS) {
    res.status(429).json({ message: 'Too many attempts. Please request a new reset code.' })
    return
  }

  entry.attempts += 1
  if (!verifyOtpHash(otp, entry.otpHash)) {
    await entry.save()
    res.status(400).json({ message: 'Incorrect reset code. Please try again.', remainingAttempts: OTP_MAX_ATTEMPTS - entry.attempts })
    return
  }

  entry.verified = true
  await entry.save()
  res.status(200).json({ message: 'Reset code verified successfully.' })
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  const { userId, password, confirmPassword } = req.body as { userId?: string; password?: string; confirmPassword?: string }
  const targetUserId = parseObjectId(userId)
  if (!targetUserId || !password || !confirmPassword) {
    res.status(400).json({ message: 'All password fields are required.' })
    return
  }
  const passwordCheck = validatePasswordStrength(password)
  if (!passwordCheck.isValid) {
    res.status(400).json({ message: passwordCheck.message })
    return
  }
  if (password !== confirmPassword) {
    res.status(400).json({ message: 'Passwords do not match.' })
    return
  }

  const reset = await PasswordResetModel.findOne({ userId: targetUserId, verified: true, usedAt: { $exists: false } })
  if (!reset || reset.expiresAt.getTime() < Date.now()) {
    res.status(403).json({ message: 'Verify a valid reset code before changing your password.' })
    return
  }

  const user = await UserModel.findByIdAndUpdate(targetUserId, { $set: { passwordHash: await bcrypt.hash(password, 12), failedLoginAttempts: 0, lockedUntil: undefined }, $inc: { tokenVersion: 1 } }, { new: true })
  if (!user) {
    res.status(404).json({ message: 'User not found.' })
    return
  }

  reset.usedAt = new Date()
  await reset.save()
  await audit(req, 'PASSWORD_CHANGED', user._id)
  res.status(200).json({ message: 'Your password has been successfully changed.' })
}

export async function getCurrentUser(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = parseObjectId(req.user?.id)
  if (!userId) {
    res.status(401).json({ message: 'Invalid session.' })
    return
  }
  const user = await UserModel.findById(userId)
  if (!user) {
    res.status(404).json({ message: 'User not found.' })
    return
  }
  res.status(200).json({ user: userResponse(user) })
}
