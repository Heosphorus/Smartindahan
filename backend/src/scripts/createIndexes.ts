import mongoose from 'mongoose'

import { connectDatabase } from '../config/database.js'
import { AuditLogModel } from '../models/AuditLog.js'
import { ConsentRecordModel } from '../models/ConsentRecord.js'
import { CustomerModel } from '../models/Customer.js'
import { EmailVerificationModel } from '../models/EmailVerification.js'
import { ExpenseModel } from '../models/Expense.js'
import { InventoryTransactionModel } from '../models/InventoryTransaction.js'
import { PasswordResetModel } from '../models/PasswordReset.js'
import { PolicyVersionModel } from '../models/PolicyVersion.js'
import { PrivacyRequestModel } from '../models/PrivacyRequest.js'
import { ProductModel } from '../models/Product.js'
import { RevokedTokenModel } from '../models/RevokedToken.js'
import { SaleModel } from '../models/Sale.js'
import { SupplierModel } from '../models/Supplier.js'
import { UserModel } from '../models/User.js'

async function createDeclaredIndexes(): Promise<void> {
  try {
    await connectDatabase()
    await Promise.all([
      AuditLogModel.createIndexes(),
      ConsentRecordModel.createIndexes(),
      PolicyVersionModel.createIndexes(),
      PrivacyRequestModel.createIndexes(),
      RevokedTokenModel.createIndexes(),
      CustomerModel.createIndexes(),
      EmailVerificationModel.createIndexes(),
      ExpenseModel.createIndexes(),
      InventoryTransactionModel.createIndexes(),
      PasswordResetModel.createIndexes(),
      ProductModel.createIndexes(),
      SaleModel.createIndexes(),
      SupplierModel.createIndexes(),
      UserModel.createIndexes(),
    ])
    console.log('Declared MongoDB indexes are present.')
  } catch (error) {
    console.error('Unable to create declared MongoDB indexes:', error instanceof Error ? error.name : 'UnknownError')
    process.exitCode = 1
  } finally {
    await mongoose.disconnect()
  }
}

void createDeclaredIndexes()