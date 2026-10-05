import mongoose from 'mongoose'

import { env } from './env.js'

const mongoOptions: mongoose.ConnectOptions = {
  serverSelectionTimeoutMS: 15000,
  socketTimeoutMS: 45000,
  maxPoolSize: 20,
  minPoolSize: 2,
  retryWrites: true,
  retryReads: true,
}

export async function connectDatabase(): Promise<void> {
  const mongoUri = env.mongoUri.trim()

  if (!mongoUri || mongoUri.includes('DATABASE_USER') || mongoUri.includes('<') || mongoUri.includes('example.com')) {
    throw new Error('MONGODB_URI is missing or still contains a placeholder. Update backend/.env with the real Atlas connection string.')
  }

  mongoose.set('strictQuery', true)
  mongoose.set('autoIndex', env.nodeEnv !== 'production')

  try {
    await mongoose.connect(mongoUri, mongoOptions)
    console.log('MongoDB connected successfully')
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const hint = /bad auth|authentication failed|not authorized|not whitelisted|econnrefused|timed out|timeout/i.test(errorMessage)
      ? 'Verify the MongoDB Atlas username/password in backend/.env and ensure the current IP is whitelisted in Atlas.'
      : 'Check the MongoDB URI, cluster status, and network access configuration.'

    throw new Error(`${errorMessage} | ${hint}`)
  }
}