import { Schema, model, type InferSchemaType } from 'mongoose'

import { appendOnly } from './immutable.js'

// TERMS_OF_SERVICE: acceptance of contractual terms. PRIVACY_NOTICE: acknowledgment that the notice was presented
// (not "consent" to processing). Optional marketing consent is intentionally absent: the app sends no marketing.
export const consentTypes = ['TERMS_OF_SERVICE', 'PRIVACY_NOTICE'] as const
export type ConsentType = (typeof consentTypes)[number]
export const consentSources = ['REGISTRATION', 'REVIEW_PROMPT', 'SETTINGS'] as const

// Append-only ledger: a record exists only because the user performed the action on `acceptedAt`.
const consentRecordSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  consentType: { type: String, enum: consentTypes, required: true },
  policyVersion: { type: String, required: true },
  accepted: { type: Boolean, required: true },
  acceptedAt: { type: Date, required: true },
  withdrawnAt: { type: Date },
  source: { type: String, enum: consentSources, required: true },
}, { timestamps: { createdAt: true, updatedAt: false } })

consentRecordSchema.index({ userId: 1, consentType: 1, acceptedAt: -1 })
appendOnly(consentRecordSchema)

export type ConsentRecordDocument = InferSchemaType<typeof consentRecordSchema>
export const ConsentRecordModel = model('ConsentRecord', consentRecordSchema)
