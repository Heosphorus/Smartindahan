import { Schema, model, type InferSchemaType } from 'mongoose'

export const auditEvents = [
  'USER_REGISTERED', 'EMAIL_VERIFICATION_REQUESTED', 'EMAIL_VERIFIED',
  'LOGIN_SUCCESSFUL', 'LOGIN_FAILED', 'OTP_REQUESTED', 'OTP_VERIFICATION_FAILED',
  'PASSWORD_RESET_REQUESTED', 'PASSWORD_CHANGED', 'LOGOUT',
] as const
export type AuditEvent = (typeof auditEvents)[number]

const auditLogSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User' },
  event: { type: String, enum: auditEvents, required: true },
  ipAddress: { type: String },
  userAgent: { type: String },
  metadata: { type: Schema.Types.Mixed },
}, { timestamps: { createdAt: true, updatedAt: false } })

export type AuditLogDocument = InferSchemaType<typeof auditLogSchema>
export const AuditLogModel = model('AuditLog', auditLogSchema)
