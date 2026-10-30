import { Schema, model, type InferSchemaType } from 'mongoose'

export const privacyRequestTypes = ['ACCESS', 'CORRECTION', 'DELETION', 'WITHDRAW_CONSENT', 'QUESTION', 'COMPLAINT'] as const
export const privacyRequestStatuses = ['RECEIVED', 'IN_PROGRESS', 'COMPLETED', 'DECLINED'] as const

const privacyRequestSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  requestType: { type: String, enum: privacyRequestTypes, required: true },
  message: { type: String, required: true, maxlength: 1000 },
  status: { type: String, enum: privacyRequestStatuses, default: 'RECEIVED', required: true },
  resolutionNote: { type: String, maxlength: 1000 },
  resolvedAt: { type: Date },
}, { timestamps: true })

privacyRequestSchema.index({ status: 1, createdAt: 1 })

export type PrivacyRequestDocument = InferSchemaType<typeof privacyRequestSchema>
export const PrivacyRequestModel = model('PrivacyRequest', privacyRequestSchema)
