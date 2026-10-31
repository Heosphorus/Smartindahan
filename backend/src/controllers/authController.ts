import bcrypt from 'bcryptjs'
import type { Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'

import { env } from '../config/env.js'
import { AuditLogModel, type AuditEvent } from '../models/AuditLog.js'
import { EmailVerificationModel } from '../models/EmailVerification.js'
import { PasswordResetModel } from '../models/PasswordReset.js'
import { RevokedTokenModel } from '../models/RevokedToken.js'
import { UserModel } from '../models/User.js'
import {
  generateOtp,
  hashOtp,
  maskEmail,
  validateOtpCode,
  validatePasswordStrength,
  verifyOtpHash,
} from '../services/authService.js'
import { currentPolicy, recordConsent } from '../services/policyService.js'
import { sendPasswordResetEmail, sendVerificationEmail } from '../services/emailService.js'
import type { AuthenticatedRequest } from '../middleware/authMiddleware.js'
import { parseObjectId } from '../utils/objectId.js'
import { isEmail } from '../utils/validation.js'

const OTP_MAX_ATTEMPTS = 5
const OTP_EXPIRES_MS = 5 * 60 * 1000
const LOGIN_LOCK_MS = 15 * 60 * 1000
let cachedDummyHash: string | undefined
async function dummyPasswordHash(): Promise<string> {
  cachedDummyHash ??= await bcrypt.hash(randomUUID(), 12)
  return cachedDummyHash
}
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
  termsVersion?: string
  privacyVersion?: string
}

function issueToken(user: { id: string; email: string; role: string; tokenVersion: number }): string {
  const options = { expiresIn: env.jwtExpiresIn ?? '7d', jwtid: randomUUID() } as jwt.SignOptions
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
  const payload = (req.body ?? {}) as RegisterPayload
  const required = [payload.firstName, payload.lastName, payload.email, payload.mobileNumber, payload.password, payload.confirmPassword, payload.storeName, payload.storeAddress]

  if (required.some((value) => typeof value !== 'string' || !value.trim())) {
    res.status(400).json({ message: 'All fields are required.' })
    return
  }

  // The server enforces the agreement itself: the checkbox in the browser is only a convenience.
  if (payload.termsAccepted !== true || payload.privacyPolicyAccepted !== true) {
    res.status(400).json({ code: 'AGREEMENT_REQUIRED', message: 'Please confirm that you have read and agree to the Terms of Service and acknowledge the Privacy Policy to create an account.' })
    return
  }
  const [terms, privacy] = await Promise.all([currentPolicy('terms'), currentPolicy('privacy')])
  if (!terms || !privacy) {
    res.status(503).json({ message: 'The policies are temporarily unavailable. Please try again shortly.' })
    return
  }
  // The user must have agreed to the versions they were shown, not whatever happens to be current when the request arrives.
  if (payload.termsVersion !== terms.version || payload.privacyVersion !== privacy.version) {
    res.status(409).json({ code: 'POLICY_VERSION_MISMATCH', message: 'The Terms of Service or Privacy Policy were updated. Please review the current versions and confirm again.' })
    return
  }

  const email = payload.email!.trim().toLowerCase()
  if (!isEmail(email)) {
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

  const passwordHash = await bcrypt.hash(payload.password!, 12)
  const otp = generateOtp()
  const session = await mongoose.startSession()
  let userId: mongoose.Types.ObjectId
  try {
    // The account, its agreement records and its verification code are created together or not at all. The email is sent
    // last, so a failed delivery rolls everything back and leaves no account and no acceptance record behind.
    session.startTransaction()
    const [created] = await UserModel.create([{
      firstName: payload.firstName!.trim(),
      lastName: payload.lastName!.trim(),
      email,
      mobileNumber: payload.mobileNumber!.trim(),
      passwordHash,
      storeName,
      storeAddress: payload.storeAddress!.trim(),
      role: 'STORE_OWNER',
      privacyPolicyAccepted: true,
      termsAccepted: true,
      acceptedPoliciesAt: new Date(),
    }], { session })
    userId = created!._id
    await recordConsent({ userId, consentType: 'TERMS_OF_SERVICE', policyVersion: terms.version, source: 'REGISTRATION' }, session)
    await recordConsent({ userId, consentType: 'PRIVACY_NOTICE', policyVersion: privacy.version, source: 'REGISTRATION' }, session)
    await EmailVerificationModel.create([{ userId, otpHash: hashOtp(otp), expiresAt: new Date(Date.now() + OTP_EXPIRES_MS) }], { session })
    await sendVerificationEmail(email, otp)
    await session.commitTransaction()
  } catch (error) {
    await session.abortTransaction().catch(() => undefined)
    const duplicate = error && typeof error === 'object' && 'code' in error && error.code === 11000
    if (duplicate) {
      res.status(409).json({ message: 'An account with this email or store name already exists.' })
      return
    }
    console.error('Registration failed:', error instanceof Error ? error.name : 'UnknownError')
    res.status(502).json({ message: 'We could not complete your registration and nothing was saved. Please try again in a moment.' })
    return
  } finally {
    await session.endSession()
  }

  await audit(req, 'USER_REGISTERED', userId)
  await audit(req, 'CONSENT_RECORDED', userId, { consentType: 'TERMS_OF_SERVICE', policyVersion: terms.version, source: 'REGISTRATION' })
  await audit(req, 'CONSENT_RECORDED', userId, { consentType: 'PRIVACY_NOTICE', policyVersion: privacy.version, source: 'REGISTRATION' })
  await audit(req, 'EMAIL_VERIFICATION_REQUESTED', userId)
  res.status(201).json({ message: 'Registration successful. Please verify your email.', user: { id: userId.toString(), email, status: 'EMAIL_VERIFICATION_REQUIRED', maskedEmail: maskEmail(email) } })
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

  const user = await UserModel.findByIdAndUpdate(targetUserId, { isEmailVerified: true }, { returnDocument: 'after' })
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

  const { email: inputEmail, password } = (req.body ?? {}) as { email?: unknown; password?: unknown }
  const email = typeof inputEmail === 'string' ? inputEmail.trim().toLowerCase() : ''
  if (!email || typeof password !== 'string' || !password) {
    res.status(400).json({ message: 'Email and password are required.' })
    return
  }

  const user = await UserModel.findOne({ email }).select('+passwordHash')
  if (!user || !user.isActive) {
    // Spend the same time as a real password check so response timing does not reveal which emails are registered.
    await bcrypt.compare(password, await dummyPasswordHash())
    await audit(req, 'LOGIN_FAILED')
    res.status(401).json({ message: 'Invalid email or password.' })
    return
  }
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    res.status(423).json({ message: 'Account temporarily locked. Please try again later.' })
    return
  }
  if (user.lockedUntil) {
    // The lock has expired: start a fresh attempt window instead of re-locking on the very next typo.
    user.failedLoginAttempts = 0
    user.lockedUntil = null
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
  if (req.user?.jti && req.user.tokenExpiresAt) {
    // Revoke exactly this session token; other devices stay signed in.
    await RevokedTokenModel.updateOne({ jti: req.user.jti }, { $setOnInsert: { expiresAt: req.user.tokenExpiresAt } }, { upsert: true })
  }
  if (userId) await audit(req, 'LOGOUT', userId)
  res.status(200).json({ message: 'Logged out successfully.' })
}

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const inputEmail = ((req.body ?? {}) as { email?: unknown }).email
  const email = typeof inputEmail === 'string' ? inputEmail.trim().toLowerCase() : ''
  if (!email) {
    res.status(400).json({ message: 'Email is required.' })
    return
  }

  const user = await UserModel.findOne({ email })
  if (!user) {
    // Same response shape as a real account (random id, masked address) so this endpoint cannot be used to discover registered emails.
    res.status(200).json({ message: 'If an account exists, a reset code has been sent.', userId: new mongoose.Types.ObjectId().toString(), maskedEmail: maskEmail(email) })
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

  const user = await UserModel.findByIdAndUpdate(targetUserId, { $set: { passwordHash: await bcrypt.hash(password, 12), failedLoginAttempts: 0, lockedUntil: undefined }, $inc: { tokenVersion: 1 } }, { returnDocument: 'after' })
  if (!user) {
    res.status(404).json({ message: 'User not found.' })
    return
  }

  reset.usedAt = new Date()
  await reset.save()
  await audit(req, 'PASSWORD_CHANGED', user._id)
  res.status(200).json({ message: 'Your password has been successfully changed.' })
}

export async function changePassword(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = parseObjectId(req.user?.id)
  if (!userId) {
    res.status(401).json({ message: 'Invalid session.' })
    return
  }
  const { currentPassword, newPassword, confirmPassword } = (req.body ?? {}) as { currentPassword?: unknown; newPassword?: unknown; confirmPassword?: unknown }
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || typeof confirmPassword !== 'string' || !currentPassword || !newPassword) {
    res.status(400).json({ message: 'Current password, new password and confirmation are required.' })
    return
  }
  const passwordCheck = validatePasswordStrength(newPassword)
  if (!passwordCheck.isValid) {
    res.status(400).json({ message: passwordCheck.message })
    return
  }
  if (newPassword !== confirmPassword) {
    res.status(400).json({ message: 'Passwords do not match.' })
    return
  }
  if (newPassword === currentPassword) {
    res.status(400).json({ message: 'Choose a new password that is different from the current one.' })
    return
  }

  const user = await UserModel.findById(userId).select('+passwordHash')
  if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
    await audit(req, 'LOGIN_FAILED', userId, { reason: 'change-password' })
    res.status(400).json({ message: 'Your current password is incorrect.' })
    return
  }

  user.passwordHash = await bcrypt.hash(newPassword, 12)
  // Invalidates every other signed-in device; the response carries a fresh token for this one.
  user.tokenVersion += 1
  await user.save()
  await audit(req, 'PASSWORD_CHANGED', user._id)
  res.status(200).json({ message: 'Your password has been changed.', token: issueToken({ id: user.id, email: user.email, role: user.role, tokenVersion: user.tokenVersion }) })
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
