import { Schema, model, type InferSchemaType } from 'mongoose'

const inventoryTransactionSchema = new Schema({
  storeId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  type: { type: String, enum: ['sale', 'stock_in', 'stock_out', 'inventory_count', 'adjustment'], required: true },
  quantity: { type: Number, required: true },
  previousStock: { type: Number, required: true, min: 0 },
  newStock: { type: Number, required: true, min: 0 },
  referenceId: { type: String },
  reason: { type: String },
  note: { type: String },
}, { timestamps: { createdAt: true, updatedAt: false } })

inventoryTransactionSchema.index({ storeId: 1, createdAt: -1 })
export type InventoryTransactionDocument = InferSchemaType<typeof inventoryTransactionSchema>
export const InventoryTransactionModel = model('InventoryTransaction', inventoryTransactionSchema)
