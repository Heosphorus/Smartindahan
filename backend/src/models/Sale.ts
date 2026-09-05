import { Schema, model, type InferSchemaType } from 'mongoose'

const saleItemSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  productName: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1 },
  unitPrice: { type: Number, required: true, min: 0 },
  costPrice: { type: Number, required: true, min: 0 },
  lineTotal: { type: Number, required: true, min: 0 },
}, { _id: false })

const saleSchema = new Schema({
  storeId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  cashierId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  transactionCode: { type: String, required: true, unique: true },
  items: { type: [saleItemSchema], required: true },
  subtotal: { type: Number, required: true, min: 0 },
  total: { type: Number, required: true, min: 0 },
  estimatedProfit: { type: Number, required: true },
  paymentMethod: { type: String, enum: ['Cash', 'Maya', 'GCash', 'Utang'], default: 'Cash' },
  customerName: { type: String, trim: true },
}, { timestamps: true })

saleSchema.index({ storeId: 1, createdAt: -1 })
export type SaleDocument = InferSchemaType<typeof saleSchema>
export const SaleModel = model('Sale', saleSchema)
