import mongoose from 'mongoose'

import { AuditLogModel } from '../models/AuditLog.js'
import { CustomerModel } from '../models/Customer.js'
import { EmailVerificationModel } from '../models/EmailVerification.js'
import { ExpenseModel } from '../models/Expense.js'
import { InventoryTransactionModel } from '../models/InventoryTransaction.js'
import { PasswordResetModel } from '../models/PasswordReset.js'
import { PrivacyRequestModel } from '../models/PrivacyRequest.js'
import { ProductModel } from '../models/Product.js'
import { SaleModel } from '../models/Sale.js'
import { SupplierModel } from '../models/Supplier.js'
import { UserModel } from '../models/User.js'

/**
 * Permanently removes one account and the store records it owns, atomically. Consent records and audit logs are kept
 * on purpose (they hold no passwords or codes) so agreements and security events stay auditable; see the Privacy Policy.
 */
export async function purgeAccount(userId: mongoose.Types.ObjectId): Promise<boolean> {
  const session = await mongoose.startSession()
  try {
    let purged = false
    await session.withTransaction(async () => {
      const user = await UserModel.findOne({ _id: userId, role: { $ne: 'ADMIN' } }).session(session).lean()
      if (!user) return
      const storeId = user._id
      const removed = {
        products: (await ProductModel.deleteMany({ storeId }, { session })).deletedCount,
        sales: (await SaleModel.deleteMany({ storeId }, { session })).deletedCount,
        customers: (await CustomerModel.deleteMany({ storeId }, { session })).deletedCount,
        suppliers: (await SupplierModel.deleteMany({ storeId }, { session })).deletedCount,
        expenses: (await ExpenseModel.deleteMany({ storeId }, { session })).deletedCount,
        inventoryTransactions: (await InventoryTransactionModel.deleteMany({ storeId }, { session })).deletedCount,
      }
      await EmailVerificationModel.deleteMany({ userId }, { session })
      await PasswordResetModel.deleteMany({ userId }, { session })
      await PrivacyRequestModel.deleteMany({ userId }, { session })
      await UserModel.deleteOne({ _id: userId }, { session })
      await AuditLogModel.create([{ userId, event: 'ACCOUNT_DELETED', resourceType: 'User', resourceId: userId, metadata: removed }], { session })
      purged = true
    })
    return purged
  } finally {
    await session.endSession()
  }
}

/** Purges every account whose deletion waiting period has ended. Run on a schedule (see docs/privacy-and-consent.md). */
export async function purgeDueAccounts(now = new Date()): Promise<number> {
  const due = await UserModel.find({ deletionScheduledFor: { $lte: now }, role: { $ne: 'ADMIN' } }).select('_id').lean()
  let count = 0
  for (const user of due) if (await purgeAccount(user._id)) count += 1
  return count
}
