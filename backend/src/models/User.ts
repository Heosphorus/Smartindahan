import { Schema, model, type InferSchemaType } from 'mongoose'

export const userRoles = ['ADMIN', 'STORE_OWNER', 'STORE_MANAGER', 'CASHIER'] as const
export type UserRole = (typeof userRoles)[number]

const userSchema = new Schema({
  firstName: { type: String, required: true, trim: true },
  lastName: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  mobileNumber: { type: String, required: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  storeName: { type: String, required: true, trim: true },
  storeAddress: { type: String, required: true, trim: true },
  role: { type: String, enum: userRoles, default: 'STORE_OWNER', required: true },
  isEmailVerified: { type: Boolean, default: false, required: true },
  isActive: { type: Boolean, default: true, required: true },
  failedLoginAttempts: { type: Number, default: 0, required: true },
  lockedUntil: { type: Date },
  lastLoginAt: { type: Date },
}, { timestamps: true })

export type UserDocument = InferSchemaType<typeof userSchema>
export const UserModel = model('User', userSchema)
