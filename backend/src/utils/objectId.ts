import mongoose from 'mongoose'

export function parseObjectId(value: unknown): mongoose.Types.ObjectId | null {
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) return null
  return new mongoose.Types.ObjectId(value)
}