import { Schema, model, type InferSchemaType } from 'mongoose'

const purchaseItemSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  productName: { type: String, required: true },
  /** Quantity in the unit it was received in (for example 2 packs). */
  quantity: { type: Number, required: true, min: 0 },
  receivedUnit: { type: String, required: true },
  /** Selling units in one received unit (1 when received in the selling unit); frozen so later changes to the pack size do not rewrite history. */
  unitsPerReceivedUnit: { type: Number, required: true, min: 1 },
  /** Selling units added to stock. */
  baseQuantity: { type: Number, required: true, min: 1 },
  /** Price paid for one received unit, and the equivalent for one selling unit. */
  unitCost: { type: Number, required: true, min: 0 },
  costPerBaseUnit: { type: Number, required: true, min: 0 },
  lineTotal: { type: Number, required: true, min: 0 },
  previousStock: { type: Number, required: true, min: 0 },
  newStock: { type: Number, required: true, min: 0 },
}, { _id: false })

const purchaseSchema = new Schema({
  storeId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier' },
  supplierName: { type: String },
  items: { type: [purchaseItemSchema], required: true },
  total: { type: Number, required: true, min: 0 },
  note: { type: String },
  idempotencyKey: { type: String, required: true },
  /** Hash of the items, so a retry key reused for different items is refused rather than silently ignored. */
  fingerprint: { type: String, required: true },
}, { timestamps: { createdAt: true, updatedAt: false } })

purchaseSchema.index({ storeId: 1, createdAt: -1 })
purchaseSchema.index({ storeId: 1, idempotencyKey: 1 }, { unique: true })
export type PurchaseDocument = InferSchemaType<typeof purchaseSchema>
export const PurchaseModel = model('Purchase', purchaseSchema)
