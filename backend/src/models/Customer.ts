import { Schema, model, type InferSchemaType } from 'mongoose'

const customerSchema = new Schema({
  storeId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true },
  mobileNumber: { type: String, trim: true },
  address: { type: String, trim: true },
  creditLimit: { type: Number, min: 0, default: 0 },
  outstandingBalance: { type: Number, min: 0, default: 0 },
  utangRequestedAt: { type: Date },
  utangPaidAt: { type: Date },
}, { timestamps: true })

customerSchema.index({ storeId: 1, name: 1 })
export type CustomerDocument = InferSchemaType<typeof customerSchema>
export const CustomerModel = model('Customer', customerSchema)
