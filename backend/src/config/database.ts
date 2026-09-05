import mongoose from 'mongoose'

import { env } from './env.js'
import { ProductModel } from '../models/Product.js'

export async function connectDatabase(): Promise<void> {
  if (!env.mongoUri || env.mongoUri.includes('DATABASE_USER')) {
    throw new Error('MONGODB_URI must contain the real Atlas connection string.')
  }

  await mongoose.connect(env.mongoUri)
  try {
    await ProductModel.collection.dropIndex('storeId_1_barcode_1')
  } catch {}
  await ProductModel.syncIndexes()
  console.log('MongoDB connected successfully')
}