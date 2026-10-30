import bcrypt from 'bcryptjs'
import type { Request, Response } from 'express'
import type { Types } from 'mongoose'

import { env } from '../config/env.js'
import { AuditLogModel, type AuditEvent } from '../models/AuditLog.js'
import { ConsentRecordModel, consentTypes, type ConsentType } from '../models/ConsentRecord.js'
import { CustomerModel } from '../models/Customer.js'
import { ExpenseModel } from '../models/Expense.js'
import { InventoryTransactionModel } from '../models/InventoryTransaction.js'
import { PrivacyRequestModel, privacyRequestTypes, type PrivacyRequestDocument } from '../models/PrivacyRequest.js'
import { ProductModel } from '../models/Product.js'
import { SaleModel } from '../models/Sale.js'
import { SupplierModel } from '../models/Supplier.js'
import { UserModel } from '../models/User.js'
import type { AuthenticatedRequest } from '../middleware/authMiddleware.js'
import { consentTypeForPolicy, currentPolicy, pendingReviews, recordConsent } from '../services/policyService.js'
import { parseObjectId } from '../utils/objectId.js'

const EXPORT_LIMIT_PER_COLLECTION = 50_000
const MAX_REQUEST_MESSAGE_LENGTH = 1000
const DELETION_CONFIRMATION_WORD = 'DELETE'

async function audit(req: Request, event: AuditEvent, userId: Types.ObjectId, metadata?: Record<string, string | number | boolean>): Promise<void> {
  const userAgent = req.get('user-agent')
  await AuditLogModel.create({
    userId,
    event,
    ipAddress: req.ip ?? 'unknown-ip',
    ...(userAgent ? { userAgent: userAgent.slice(0, 500) } : {}),
    ...(metadata ? { metadata } : {}),
  })
}

function sessionUserId(req: AuthenticatedRequest, res: Response): Types.ObjectId | null {
  const userId = parseObjectId(req.user?.id)
  if (!userId) res.status(401).json({ message: 'Invalid session.' })
  return userId
}

function deletionState(user: { deletionRequestedAt?: Date | null; deletionScheduledFor?: Date | null }) {
  return user.deletionScheduledFor ? { requestedAt: user.deletionRequestedAt ?? null, scheduledFor: user.deletionScheduledFor } : null
}

/** What the signed-in user still has to review, and whether account deletion is pending. */
export async function getPrivacyStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = sessionUserId(req, res)
  if (!userId) return
  const user = await UserModel.findById(userId).select('deletionRequestedAt deletionScheduledFor role').lean()
  if (!user) {
    res.status(404).json({ message: 'User not found.' })
    return
  }
  // Administrators operate the platform and are not store customers; they are never asked to accept customer terms here.
  const pending = user.role === 'ADMIN' ? [] : await pendingReviews(userId)
  res.status(200).json({ pending, blocking: pending.some((review) => review.blocking), deletion: deletionState(user) })
}

/** The user's own agreement history plus the policies currently in force. */
export async function getPrivacyOverview(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = sessionUserId(req, res)
  if (!userId) return
  const user = await UserModel.findById(userId).select('firstName lastName email mobileNumber storeName storeAddress role createdAt deletionRequestedAt deletionScheduledFor').lean()
  if (!user) {
    res.status(404).json({ message: 'User not found.' })
    return
  }
  const [consents, terms, privacy] = await Promise.all([
    ConsentRecordModel.find({ userId }).sort({ acceptedAt: -1 }).select('consentType policyVersion accepted acceptedAt source').lean(),
    currentPolicy('terms'),
    currentPolicy('privacy'),
  ])
  res.status(200).json({
    account: { firstName: user.firstName, lastName: user.lastName, email: user.email, mobileNumber: user.mobileNumber, storeName: user.storeName, storeAddress: user.storeAddress, createdAt: (user as { createdAt?: Date }).createdAt },
    consents,
    currentPolicies: [terms, privacy].flatMap((policy) => policy ? [{ policyType: policy.policyType, version: policy.version, title: policy.title, isDraft: policy.isDraft, effectiveAt: policy.effectiveAt }] : []),
    deletion: deletionState(user),
    canDeleteAccount: user.role !== 'ADMIN',
  })
}

/** The user actively accepts (Terms) or acknowledges (Privacy Policy) the CURRENT version after reading it. */
export async function acceptPolicy(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = sessionUserId(req, res)
  if (!userId) return
  const { consentType, policyVersion, source } = (req.body ?? {}) as { consentType?: unknown; policyVersion?: unknown; source?: unknown }
  if (typeof consentType !== 'string' || !(consentTypes as readonly string[]).includes(consentType) || typeof policyVersion !== 'string') {
    res.status(400).json({ message: 'Choose which policy you are accepting and its version.' })
    return
  }
  const policyType = (Object.keys(consentTypeForPolicy) as Array<keyof typeof consentTypeForPolicy>).find((type) => consentTypeForPolicy[type] === consentType)
  const current = policyType ? await currentPolicy(policyType) : null
  if (!current || current.version !== policyVersion) {
    res.status(409).json({ code: 'POLICY_VERSION_MISMATCH', message: 'A newer version was published. Please review the current version before accepting.' })
    return
  }
  const alreadyAccepted = await ConsentRecordModel.exists({ userId, consentType: consentType as ConsentType, policyVersion, accepted: true })
  if (!alreadyAccepted) {
    await recordConsent({ userId, consentType: consentType as ConsentType, policyVersion, source: source === 'SETTINGS' ? 'SETTINGS' : 'REVIEW_PROMPT' })
    await audit(req, 'CONSENT_RECORDED', userId, { consentType, policyVersion, source: source === 'SETTINGS' ? 'SETTINGS' : 'REVIEW_PROMPT' })
  }
  res.status(200).json({ message: 'Your choice has been recorded.', pending: await pendingReviews(userId) })
}

/** A copy of everything stored about this account and its own store. Never includes another user's records. */
export async function exportMyData(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = sessionUserId(req, res)
  if (!userId) return
  const user = await UserModel.findById(userId).select('-passwordHash -tokenVersion -failedLoginAttempts -lockedUntil').lean()
  if (!user) {
    res.status(404).json({ message: 'User not found.' })
    return
  }
  const storeScoped = user.role === 'STORE_OWNER'
  const bounded = <T>(query: { limit: (n: number) => { lean: () => Promise<T[]> } }) => query.limit(EXPORT_LIMIT_PER_COLLECTION).lean()
  const storeFilter = { storeId: userId }
  const [consents, privacyRequests, auditEvents, products, sales, inventoryTransactions, customers, suppliers, expenses] = await Promise.all([
    bounded(ConsentRecordModel.find({ userId }).sort({ acceptedAt: 1 }).select('-__v')),
    bounded(PrivacyRequestModel.find({ userId }).sort({ createdAt: 1 }).select('-__v')),
    bounded(AuditLogModel.find({ userId }).sort({ createdAt: 1 }).select('event resourceType createdAt ipAddress userAgent metadata')),
    storeScoped ? bounded(ProductModel.find(storeFilter).select('-__v')) : [],
    storeScoped ? bounded(SaleModel.find(storeFilter).select('-__v')) : [],
    storeScoped ? bounded(InventoryTransactionModel.find(storeFilter).select('-__v')) : [],
    storeScoped ? bounded(CustomerModel.find(storeFilter).select('-__v')) : [],
    storeScoped ? bounded(SupplierModel.find(storeFilter).select('-__v')) : [],
    storeScoped ? bounded(ExpenseModel.find(storeFilter).select('-__v')) : [],
  ])
  await audit(req, 'DATA_EXPORT_REQUESTED', userId)
  const counts = { consents: consents.length, privacyRequests: privacyRequests.length, auditEvents: auditEvents.length, products: products.length, sales: sales.length, inventoryTransactions: inventoryTransactions.length, customers: customers.length, suppliers: suppliers.length, expenses: expenses.length }
  const truncated = Object.values(counts).some((count) => count >= EXPORT_LIMIT_PER_COLLECTION)
  res.setHeader('Content-Disposition', 'attachment; filename="smartindahan-my-data.json"')
  res.setHeader('Cache-Control', 'no-store')
  res.status(200).json({
    exportedAt: new Date().toISOString(),
    note: 'This file contains the information smarTindahan stores for your account. Passwords, verification codes and session tokens are never included.',
    truncated,
    counts,
    account: user,
    consents,
    privacyRequests,
    securityEvents: auditEvents,
    store: { products, sales, inventoryTransactions, customers, suppliers, expenses },
  })
}

export async function submitPrivacyRequest(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = sessionUserId(req, res)
  if (!userId) return
  const { type, message } = (req.body ?? {}) as { type?: unknown; message?: unknown }
  const text = typeof message === 'string' ? message.trim() : ''
  if (typeof type !== 'string' || !(privacyRequestTypes as readonly string[]).includes(type)) {
    res.status(400).json({ message: 'Choose what kind of request this is.' })
    return
  }
  if (!text) {
    res.status(400).json({ message: 'Please describe your request.' })
    return
  }
  if (text.length > MAX_REQUEST_MESSAGE_LENGTH) {
    res.status(400).json({ message: `Please keep your message under ${MAX_REQUEST_MESSAGE_LENGTH} characters.` })
    return
  }
  const created = await PrivacyRequestModel.create({ userId, requestType: type as PrivacyRequestDocument['requestType'], message: text })
  await audit(req, 'PRIVACY_REQUEST_SUBMITTED', userId, { type })
  res.status(201).json({ message: 'Your request was received. We will reply to the email address on your account.', request: { id: created.id, type, status: created.status, createdAt: created.get('createdAt') as Date } })
}

export async function listMyPrivacyRequests(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = sessionUserId(req, res)
  if (!userId) return
  const stored = await PrivacyRequestModel.find({ userId }).sort({ createdAt: -1 }).limit(50).select('requestType message status resolutionNote resolvedAt createdAt').lean()
  res.status(200).json({ requests: stored.map(({ requestType, ...rest }) => ({ ...rest, type: requestType })) })
}

/** Schedules closure of the account after reauthenticating. Nothing is deleted until the waiting period ends. */
export async function requestAccountDeletion(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = sessionUserId(req, res)
  if (!userId) return
  const { password, confirmation } = (req.body ?? {}) as { password?: unknown; confirmation?: unknown }
  if (typeof password !== 'string' || !password || confirmation !== DELETION_CONFIRMATION_WORD) {
    res.status(400).json({ message: `Enter your password and type ${DELETION_CONFIRMATION_WORD} to confirm.` })
    return
  }
  const user = await UserModel.findById(userId).select('+passwordHash role deletionScheduledFor')
  if (!user) {
    res.status(404).json({ message: 'User not found.' })
    return
  }
  if (user.role === 'ADMIN') {
    res.status(403).json({ message: 'Administrator accounts cannot be closed here. Contact the platform owner.' })
    return
  }
  if (!(await bcrypt.compare(password, user.passwordHash))) {
    await audit(req, 'LOGIN_FAILED', userId, { reason: 'delete-account' })
    res.status(400).json({ message: 'Your password is incorrect.' })
    return
  }
  if (user.deletionScheduledFor) {
    res.status(200).json({ message: 'Your account is already scheduled for deletion.', deletion: deletionState(user) })
    return
  }
  const requestedAt = new Date()
  user.deletionRequestedAt = requestedAt
  user.deletionScheduledFor = new Date(requestedAt.getTime() + env.accountDeletionGraceDays * 24 * 60 * 60 * 1000)
  await user.save()
  await audit(req, 'ACCOUNT_DELETION_REQUESTED', userId, { graceDays: env.accountDeletionGraceDays })
  res.status(200).json({ message: 'Your account is scheduled for deletion. You can cancel until then.', deletion: deletionState(user) })
}

export async function cancelAccountDeletion(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = sessionUserId(req, res)
  if (!userId) return
  const result = await UserModel.updateOne({ _id: userId, deletionScheduledFor: { $exists: true, $ne: null } }, { $unset: { deletionRequestedAt: 1, deletionScheduledFor: 1 } })
  if (result.modifiedCount === 0) {
    res.status(404).json({ message: 'No account deletion is scheduled.' })
    return
  }
  await audit(req, 'ACCOUNT_DELETION_CANCELLED', userId)
  res.status(200).json({ message: 'Account deletion cancelled. Your account stays open.' })
}
