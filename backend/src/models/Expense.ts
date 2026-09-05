import { Schema, model, type InferSchemaType } from 'mongoose'

const expenseSchema = new Schema({
  storeId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  category: { type: String, required: true, trim: true },
  description: { type: String, required: true, trim: true },
  amount: { type: Number, required: true, min: 0 },
  expenseDate: { type: Date, required: true, default: Date.now },
}, { timestamps: true })

expenseSchema.index({ storeId: 1, expenseDate: -1 })
export type ExpenseDocument = InferSchemaType<typeof expenseSchema>
export const ExpenseModel = model('Expense', expenseSchema)
