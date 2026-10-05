import { Schema, model, type InferSchemaType } from 'mongoose'

export const auditEvents = [
  'USER_REGISTERED', 'EMAIL_VERIFICATION_REQUESTED', 'EMAIL_VERIFIED',
  'LOGIN_SUCCESSFUL', 'LOGIN_FAILED', 'OTP_REQUESTED', 'OTP_VERIFICATION_FAILED',
  'PASSWORD_RESET_REQUESTED', 'PASSWORD_CHANGED', 'LOGOUT',
  'ADMIN_IMPERSONATION', 'ADMIN_PASSWORD_CHANGED', 'ADMIN_EMAIL_CHANGED',
  'PRODUCT_CREATED', 'PRODUCT_UPDATED', 'PRODUCT_ARCHIVED', 'SALE_CREATED',
  'INVENTORY_STOCK_IN', 'INVENTORY_STOCK_OUT', 'INVENTORY_COUNT',
  'CUSTOMER_CREATED', 'CUSTOMER_UPDATED', 'CUSTOMER_ARCHIVED',
  'SUPPLIER_CREATED', 'SUPPLIER_UPDATED', 'SUPPLIER_ARCHIVED',
  'EXPENSE_CREATED', 'EXPENSE_UPDATED', 'EXPENSE_ARCHIVED',
] as const
export type AuditEvent = (typeof auditEvents)[number]

const auditLogSchema = new Schema({
  storeId: { type: Schema.Types.ObjectId, ref: 'User' },
  userId: { type: Schema.Types.ObjectId, ref: 'User' },
  event: { type: String, enum: auditEvents, required: true },
  resourceType: { type: String, maxlength: 80 },
  resourceId: { type: Schema.Types.ObjectId },
  ipAddress: { type: String },
  userAgent: { type: String, maxlength: 500 },
  metadata: { type: Schema.Types.Mixed },
}, { timestamps: { createdAt: true, updatedAt: false } })

auditLogSchema.index({ storeId: 1, createdAt: -1 })
auditLogSchema.index({ userId: 1, createdAt: -1 })

export type AuditLogDocument = InferSchemaType<typeof auditLogSchema>
export const AuditLogModel = model('AuditLog', auditLogSchema)
