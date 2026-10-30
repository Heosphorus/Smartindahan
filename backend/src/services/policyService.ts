import { createHash } from 'node:crypto'
import type { ClientSession, Types } from 'mongoose'

import { initialPolicies, type PolicyDraft, type PolicySection } from '../legal/initialPolicies.js'

export type { PolicySection }
import { ConsentRecordModel, type ConsentType } from '../models/ConsentRecord.js'
import { PolicyVersionModel, policyTypes, type PolicyType } from '../models/PolicyVersion.js'

export const consentTypeForPolicy: Record<PolicyType, ConsentType> = { terms: 'TERMS_OF_SERVICE', privacy: 'PRIVACY_NOTICE' }
// Updated Terms are a contract the user must accept to keep using the store features. An updated privacy notice only
// needs to be acknowledged: it never blocks the app (and never extends what we may do with the data).
const blockingPolicy: Record<PolicyType, boolean> = { terms: true, privacy: false }

export type PolicyView = {
  policyType: PolicyType
  version: string
  title: string
  summary: string
  changeSummary: string
  sections: PolicySection[]
  isDraft: boolean
  publishedAt: Date
  effectiveAt: Date
  requiresReacceptance: boolean
  isCurrent: boolean
}

export type PendingReview = {
  policyType: PolicyType
  consentType: ConsentType
  version: string
  title: string
  isDraft: boolean
  blocking: boolean
  acceptedVersion: string | null
  changes: Array<{ version: string; changeSummary: string }>
}

type StoredPolicy = {
  policyType: PolicyType
  version: string
  title: string
  summary: string
  changeSummary: string
  sections: unknown
  isDraft: boolean
  publishedAt: Date
  effectiveAt: Date
  requiresReacceptance: boolean
}

export function hashPolicy(policy: Pick<PolicyDraft, 'policyType' | 'version' | 'title' | 'summary' | 'sections'>): string {
  return createHash('sha256').update(JSON.stringify([policy.policyType, policy.version, policy.title, policy.summary, policy.sections])).digest('hex')
}

let seeding: Promise<void> | undefined

/** Inserts the first draft version of each policy type, only when that type has no published version yet. */
export function ensurePolicySeed(): Promise<void> {
  seeding ??= (async () => {
    // Production does not build indexes automatically; the unique (type, version) index is what stops two cold starts seeding twice.
    await PolicyVersionModel.createIndexes()
    for (const policyType of policyTypes) {
      if (await PolicyVersionModel.exists({ policyType })) continue
      const draft = initialPolicies.find((candidate) => candidate.policyType === policyType)
      if (!draft) continue
      const now = new Date()
      try {
        await PolicyVersionModel.create({ ...draft, publishedAt: now, effectiveAt: now, contentHash: hashPolicy(draft) })
      } catch (error) {
        // Another instance seeded it first (unique index on type + version).
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 11000)) throw error
      }
    }
  })().catch((error: unknown) => {
    seeding = undefined
    throw error
  })
  return seeding
}

/** Test hook: forget that seeding ran (a fresh database needs seeding again). */
export function resetPolicySeedState(): void {
  seeding = undefined
}

function toView(doc: StoredPolicy, isCurrent: boolean): PolicyView {
  return {
    policyType: doc.policyType,
    version: doc.version,
    title: doc.title,
    summary: doc.summary,
    changeSummary: doc.changeSummary,
    sections: doc.sections as PolicySection[],
    isDraft: doc.isDraft,
    publishedAt: doc.publishedAt,
    effectiveAt: doc.effectiveAt,
    requiresReacceptance: doc.requiresReacceptance,
    isCurrent,
  }
}

export async function currentPolicy(policyType: PolicyType, at?: Date): Promise<PolicyView | null> {
  await ensurePolicySeed()
  // Read the clock after seeding, otherwise a version created a moment ago would look like it is not yet in force.
  const when = at ?? new Date()
  const doc = await PolicyVersionModel.findOne({ policyType, effectiveAt: { $lte: when } }).sort({ effectiveAt: -1, createdAt: -1 }).lean()
  return doc ? toView(doc as StoredPolicy, true) : null
}

export async function policyVersion(policyType: PolicyType, version: string, at?: Date): Promise<PolicyView | null> {
  await ensurePolicySeed()
  const doc = await PolicyVersionModel.findOne({ policyType, version }).lean()
  if (!doc) return null
  const current = await currentPolicy(policyType, at)
  return toView(doc as StoredPolicy, current?.version === doc.version)
}

export async function policyHistory(policyType: PolicyType, at?: Date): Promise<Array<Omit<PolicyView, 'sections'>>> {
  await ensurePolicySeed()
  const docs = await PolicyVersionModel.find({ policyType }).sort({ effectiveAt: -1 }).lean()
  const current = await currentPolicy(policyType, at)
  return docs.map((doc) => {
    const { sections: _sections, ...rest } = toView(doc as StoredPolicy, current?.version === doc.version)
    return rest
  })
}

/** Which current policies this user still has to accept or acknowledge. Never invents a record on the user's behalf. */
export async function pendingReviews(userId: Types.ObjectId, atOverride?: Date): Promise<PendingReview[]> {
  const pending: PendingReview[] = []
  for (const policyType of policyTypes) {
    const current = await currentPolicy(policyType, atOverride)
    if (!current) continue
    const at = atOverride ?? new Date()
    const consentType = consentTypeForPolicy[policyType]
    const latest = await ConsentRecordModel.findOne({ userId, consentType, accepted: true }).sort({ acceptedAt: -1 }).lean()
    if (latest?.policyVersion === current.version) continue

    const accepted = latest ? await PolicyVersionModel.findOne({ policyType, version: latest.policyVersion }).lean() : null
    const newer = await PolicyVersionModel.find({
      policyType,
      effectiveAt: { $lte: at, ...(accepted ? { $gt: accepted.effectiveAt } : {}) },
    }).sort({ effectiveAt: 1 }).lean()
    // Versions that do not require renewed agreement never prompt users who already accepted an earlier one.
    if (accepted && !newer.some((version) => version.requiresReacceptance)) continue
    pending.push({
      policyType,
      consentType,
      version: current.version,
      title: current.title,
      isDraft: current.isDraft,
      blocking: blockingPolicy[policyType],
      acceptedVersion: latest?.policyVersion ?? null,
      changes: newer.map((version) => ({ version: version.version, changeSummary: version.changeSummary })),
    })
  }
  return pending
}

export async function recordConsent(
  input: { userId: Types.ObjectId; consentType: ConsentType; policyVersion: string; source: 'REGISTRATION' | 'REVIEW_PROMPT' | 'SETTINGS' },
  session?: ClientSession,
): Promise<void> {
  const record = { ...input, accepted: true, acceptedAt: new Date() }
  if (session) await ConsentRecordModel.create([record], { session })
  else await ConsentRecordModel.create(record)
}

export type PublishInput = Pick<PolicyDraft, 'policyType' | 'version' | 'title' | 'summary' | 'changeSummary' | 'sections' | 'isDraft' | 'requiresReacceptance'> & { effectiveAt: Date }

/** Publishes a NEW immutable version. An existing type + version can never be replaced. */
export async function publishPolicy(input: PublishInput): Promise<PolicyView> {
  await ensurePolicySeed()
  const doc = await PolicyVersionModel.create({ ...input, publishedAt: new Date(), contentHash: hashPolicy(input) })
  return toView(doc.toObject() as StoredPolicy, false)
}
