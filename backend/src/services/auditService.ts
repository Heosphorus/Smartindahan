import type { ClientSession, Types } from 'mongoose'

import { AuditLogModel, type AuditEvent } from '../models/AuditLog.js'

type AuditRecord = {
  storeId: Types.ObjectId
  userId: Types.ObjectId
  event: AuditEvent
  resourceType: string
  resourceId: Types.ObjectId
  metadata?: Record<string, string | number | boolean>
}

export async function recordAuditLog(record: AuditRecord, session?: ClientSession): Promise<void> {
  if (session) {
    await AuditLogModel.create([{ ...record }], { session })
    return
  }
  await AuditLogModel.create({ ...record })
}