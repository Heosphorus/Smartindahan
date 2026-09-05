import { Schema, model, type InferSchemaType } from 'mongoose'

const emailVerificationSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  otpHash: { type: String, required: true, select: false },
  expiresAt: { type: Date, required: true },
  attempts: { type: Number, default: 0, required: true },
  verified: { type: Boolean, default: false, required: true },
  usedAt: { type: Date },
}, { timestamps: { createdAt: true, updatedAt: false } })

emailVerificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
export type EmailVerificationDocument = InferSchemaType<typeof emailVerificationSchema>
export const EmailVerificationModel = model('EmailVerification', emailVerificationSchema)
