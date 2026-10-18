import type { Request, Response } from 'express'

import { connectDatabase } from '../backend/src/config/database.js'
import { app } from '../backend/src/server.js'

let databasePromise: Promise<void> | undefined

function ensureDatabaseConnection(): Promise<void> {
  databasePromise ??= connectDatabase().catch((error: unknown) => {
    databasePromise = undefined
    throw error
  })
  return databasePromise
}

export default async function handler(req: Request, res: Response): Promise<void> {
  try {
    await ensureDatabaseConnection()
    app(req, res)
  } catch {
    res.status(503).json({ message: 'The API is temporarily unavailable.' })
  }
}
