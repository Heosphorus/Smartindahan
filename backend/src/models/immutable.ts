import type { Schema } from 'mongoose'

const blockedQueryOperations = [
  'updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'replaceOne',
  'deleteOne', 'deleteMany', 'findOneAndDelete',
] as const

const updateOperations: readonly string[] = ['updateOne', 'updateMany', 'findOneAndUpdate']

/**
 * Makes a collection append-only through Mongoose: records can be created and read, never edited or removed by
 * application code. Used for policy versions, consent records and audit logs so history stays auditable.
 * (Database administrators can still change data directly; TTL indexes are enforced by MongoDB itself.)
 */
export function appendOnly(schema: Schema): void {
  for (const operation of blockedQueryOperations) {
    schema.pre(operation, function () {
      throw new Error(`This record is append-only and cannot be changed or deleted (${updateOperations.includes(operation) ? 'update' : 'delete'}).`)
    })
  }
  schema.pre('save', function () {
    if (!this.isNew) throw new Error('This record is append-only and cannot be modified.')
  })
}
