import { Schema, model, type InferSchemaType } from 'mongoose'

const passwordResetSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  otpHash: { type: String, required: true, select: false },
  expiresAt: { type: Date, required: true },
  attempts: { type: Number, default: 0, required: true },
  verified: { type: Boolean, default: false, required: true },
  usedAt: { type: Date },
}, { timestamps: { createdAt: true, updatedAt: false } })

passwordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
export type PasswordResetDocument = InferSchemaType<typeof passwordResetSchema>
export const PasswordResetModel = model('PasswordReset', passwordResetSchema)
