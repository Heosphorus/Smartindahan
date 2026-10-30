import type { Response } from 'express'
import mongoose from 'mongoose'

import { AuditLogModel } from '../models/AuditLog.js'
import { PrivacyRequestModel, privacyRequestStatuses, type PrivacyRequestDocument } from '../models/PrivacyRequest.js'
import { policyTypes, type PolicyType } from '../models/PolicyVersion.js'
import { UserModel } from '../models/User.js'
import type { AuthenticatedRequest } from '../middleware/authMiddleware.js'
import { publishPolicy, type PolicySection } from '../services/policyService.js'
import { parseObjectId } from '../utils/objectId.js'

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null
}

function parseSections(value: unknown): PolicySection[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 40) return null
  const sections: PolicySection[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return null
    const entry = raw as Record<string, unknown>
    const id = text(entry.id, 40)
    const heading = text(entry.heading, 150)
    const paragraphs = Array.isArray(entry.paragraphs) ? entry.paragraphs : []
    const bullets = Array.isArray(entry.bullets) ? entry.bullets : []
    if (!id || !/^[a-z0-9-]+$/.test(id) || !heading || paragraphs.length > 20 || bullets.length > 30) return null
    const cleanParagraphs = paragraphs.map((paragraph) => text(paragraph, 3000))
    const cleanBullets = bullets.map((bullet) => text(bullet, 1500))
    if (cleanParagraphs.includes(null) || cleanBullets.includes(null)) return null
    sections.push({ id, heading, paragraphs: cleanParagraphs as string[], bullets: cleanBullets as string[] })
  }
  return sections
}

/** Publishes a new immutable policy version. Existing versions can never be replaced. */
export async function publishPolicyVersion(req: AuthenticatedRequest, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>
  const policyType = typeof body.policyType === 'string' && (policyTypes as readonly string[]).includes(body.policyType) ? body.policyType as PolicyType : null
  const version = text(body.version, 40)
  const title = text(body.title, 120)
  const summary = text(body.summary, 1500)
  const changeSummary = text(body.changeSummary, 1500)
  const sections = parseSections(body.sections)
  const effectiveAt = typeof body.effectiveAt === 'string' ? new Date(body.effectiveAt) : null
  if (!policyType || !version || !/^[A-Za-z0-9._-]+$/.test(version) || !title || !summary || !changeSummary || !sections
    || typeof body.isDraft !== 'boolean' || typeof body.requiresReacceptance !== 'boolean' || !effectiveAt || Number.isNaN(effectiveAt.getTime())) {
    res.status(400).json({ message: 'Provide policyType, version, title, summary, changeSummary, sections, isDraft, requiresReacceptance and effectiveAt.' })
    return
  }
  // Backdating would retroactively change what users were shown; schedule new versions from now on.
  if (effectiveAt.getTime() < Date.now() - 60_000) {
    res.status(400).json({ message: 'The effective date cannot be in the past.' })
    return
  }
  try {
    const published = await publishPolicy({ policyType, version, title, summary, changeSummary, sections, isDraft: body.isDraft, requiresReacceptance: body.requiresReacceptance, effectiveAt })
    const actorId = parseObjectId(req.user?.id)
    if (actorId) await AuditLogModel.create({ userId: actorId, event: 'POLICY_PUBLISHED', metadata: { policyType, version, requiresReacceptance: body.requiresReacceptance } })
    const { sections: _sections, ...summaryView } = published
    res.status(201).json({ message: 'Policy version published.', policy: summaryView })
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 11000) {
      res.status(409).json({ message: 'That version already exists. Published versions cannot be changed; publish a new version number.' })
      return
    }
    throw error
  }
}

export async function listPrivacyRequests(req: AuthenticatedRequest, res: Response): Promise<void> {
  const status = typeof req.query.status === 'string' && (privacyRequestStatuses as readonly string[]).includes(req.query.status) ? req.query.status as PrivacyRequestDocument['status'] : undefined
  const requests = await PrivacyRequestModel.find(status ? { status } : {}).sort({ createdAt: 1 }).limit(200).lean()
  const users = await UserModel.find({ _id: { $in: requests.map((request) => request.userId) } }).select('email firstName lastName').lean()
  const byId = new Map(users.map((user) => [user._id.toString(), user]))
  res.status(200).json({
    requests: requests.map((request) => {
      const user = byId.get(request.userId.toString())
      return { ...request, type: request.requestType, requester: user ? { email: user.email, name: `${user.firstName} ${user.lastName}` } : null }
    }),
  })
}

export async function updatePrivacyRequest(req: AuthenticatedRequest, res: Response): Promise<void> {
  const requestId = parseObjectId(req.params.id)
  const { status, resolutionNote } = (req.body ?? {}) as { status?: unknown; resolutionNote?: unknown }
  if (!requestId || typeof status !== 'string' || !(privacyRequestStatuses as readonly string[]).includes(status)) {
    res.status(400).json({ message: 'A valid request and status are required.' })
    return
  }
  const note = typeof resolutionNote === 'string' ? resolutionNote.trim().slice(0, 1000) : undefined
  const closed = status === 'COMPLETED' || status === 'DECLINED'
  const updated = await PrivacyRequestModel.findByIdAndUpdate(requestId, { $set: { status, ...(note ? { resolutionNote: note } : {}), ...(closed ? { resolvedAt: new Date() } : {}) } }, { returnDocument: 'after' })
  if (!updated) {
    res.status(404).json({ message: 'Request not found.' })
    return
  }
  const actorId = parseObjectId(req.user?.id)
  if (actorId) await AuditLogModel.create({ userId: actorId, event: 'PRIVACY_REQUEST_UPDATED', resourceType: 'PrivacyRequest', resourceId: new mongoose.Types.ObjectId(requestId), metadata: { status } })
  res.status(200).json({ message: 'Request updated.' })
}
