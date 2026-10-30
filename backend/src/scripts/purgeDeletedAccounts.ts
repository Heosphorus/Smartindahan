import mongoose from 'mongoose'

import { connectDatabase } from '../config/database.js'
import { purgeDueAccounts } from '../services/accountDeletionService.js'

// Permanently deletes accounts whose deletion waiting period has ended. Schedule this to run daily
// (see docs/privacy-and-consent.md); it is safe to run repeatedly.
async function run(): Promise<void> {
  try {
    await connectDatabase()
    const purged = await purgeDueAccounts()
    console.log(`Accounts permanently deleted: ${purged}`)
  } catch (error) {
    console.error('Unable to purge deleted accounts:', error instanceof Error ? error.name : 'UnknownError')
    process.exitCode = 1
  } finally {
    await mongoose.disconnect()
  }
}

void run()
