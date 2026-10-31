import { Schema, model, type InferSchemaType } from 'mongoose'

const productSchema = new Schema({
  storeId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true },
  barcode: { type: String, trim: true },
  barcodeType: { type: String },
  sku: { type: String, trim: true },
  category: { type: String, required: true, trim: true },
  brand: { type: String, trim: true },
  supplier: { type: String, trim: true },
  costPrice: { type: Number, required: true, min: 0 },
  sellingPrice: { type: Number, required: true, min: 0 },
  currentStock: { type: Number, required: true, min: 0, default: 0 },
  minStock: { type: Number, required: true, min: 0, default: 0 },
  /** The unit the product is sold and counted in; stock is always kept in this unit. */
  unit: { type: String, required: true, default: 'piece' },
  /** Optional: the unit it is bought in (for example "pack") and how many selling units are in one. Both are set, or neither. */
  purchaseUnit: { type: String, trim: true },
  unitsPerPurchaseUnit: { type: Number, min: 2, max: 100000 },
  status: { type: String, enum: ['active', 'archived'], default: 'active' },
}, { timestamps: true })

productSchema.index({ storeId: 1, barcode: 1 }, { unique: true, partialFilterExpression: { barcode: { $type: 'string' } } })
productSchema.index({ storeId: 1, name: 1 })
productSchema.index({ storeId: 1, status: 1, currentStock: 1 })
productSchema.index({ storeId: 1, sku: 1 }, { partialFilterExpression: { sku: { $type: 'string' } } })

export type ProductDocument = InferSchemaType<typeof productSchema>
export const ProductModel = model('Product', productSchema)
