import { Schema, model, type InferSchemaType } from 'mongoose'

const countItemSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  productName: { type: String, required: true },
  unit: { type: String, required: true },
  /** What the system said was in stock when this quantity was counted. Sales and restocking after that moment are kept on top of the count. */
  expectedQuantity: { type: Number, required: true, min: 0 },
  countedQuantity: { type: Number, required: true, min: 0 },
  reason: { type: String },
}, { _id: false })

const inventoryCountSchema = new Schema({
  storeId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  status: { type: String, enum: ['open', 'applied', 'discarded'], default: 'open', required: true },
  items: { type: [countItemSchema], default: [] },
  appliedAt: { type: Date },
  appliedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })

inventoryCountSchema.index({ storeId: 1, status: 1, updatedAt: -1 })
export type InventoryCountDocument = InferSchemaType<typeof inventoryCountSchema>
export const InventoryCountModel = model('InventoryCount', inventoryCountSchema)
