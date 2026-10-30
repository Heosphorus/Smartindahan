import { Schema, model, type InferSchemaType } from 'mongoose'

import { appendOnly } from './immutable.js'

export const policyTypes = ['terms', 'privacy'] as const
export type PolicyType = (typeof policyTypes)[number]

const sectionSchema = new Schema({
  id: { type: String, required: true },
  heading: { type: String, required: true },
  paragraphs: { type: [String], default: [] },
  bullets: { type: [String], default: [] },
}, { _id: false })

// One immutable document per published version. A new version is a new document; old ones are never edited.
const policyVersionSchema = new Schema({
  policyType: { type: String, enum: policyTypes, required: true },
  version: { type: String, required: true },
  title: { type: String, required: true },
  summary: { type: String, required: true },
  changeSummary: { type: String, required: true },
  sections: { type: [sectionSchema], required: true },
  // true while the text still needs the owner's and counsel's sign-off; shown prominently to readers.
  isDraft: { type: Boolean, required: true },
  publishedAt: { type: Date, required: true },
  effectiveAt: { type: Date, required: true },
  // Existing users must take an affirmative action for this version (accept the terms / acknowledge the notice).
  requiresReacceptance: { type: Boolean, required: true },
  contentHash: { type: String, required: true },
}, { timestamps: { createdAt: true, updatedAt: false } })

policyVersionSchema.index({ policyType: 1, version: 1 }, { unique: true })
policyVersionSchema.index({ policyType: 1, effectiveAt: -1 })
appendOnly(policyVersionSchema)

export type PolicyVersionDocument = InferSchemaType<typeof policyVersionSchema>
export const PolicyVersionModel = model('PolicyVersion', policyVersionSchema)
