import { Schema, model, type InferSchemaType } from 'mongoose'

const supplierSchema = new Schema({
  storeId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true },
  contactNumber: { type: String, trim: true },
  address: { type: String, trim: true },
  isDeleted: { type: Boolean, default: false, required: true },
  deletedAt: { type: Date },
  deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })

supplierSchema.index({ storeId: 1, name: 1 }, { unique: true })
export type SupplierDocument = InferSchemaType<typeof supplierSchema>
export const SupplierModel = model('Supplier', supplierSchema)
