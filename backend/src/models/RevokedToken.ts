import { Schema, model } from 'mongoose'

// Session tokens carry a unique id (jti). Logging out stores it here until the token would have expired anyway.
const revokedTokenSchema = new Schema({
  jti: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
}, { timestamps: { createdAt: true, updatedAt: false } })

revokedTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export const RevokedTokenModel = model('RevokedToken', revokedTokenSchema)
