import mongoose from 'mongoose'

import { env, validateEnvironment } from './env.js'

// Serverless instances multiply the pool, so keep it small there. Atlas free tiers allow 500 connections.
const isServerless = Boolean(process.env.VERCEL)

function poolSize(name: string, fallback: number): number {
  const parsed = Number(process.env[name])
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}

const mongoOptions: mongoose.ConnectOptions = {
  serverSelectionTimeoutMS: 15000,
  socketTimeoutMS: 45000,
  maxPoolSize: poolSize('MONGODB_MAX_POOL_SIZE', isServerless ? 5 : 20),
  minPoolSize: poolSize('MONGODB_MIN_POOL_SIZE', isServerless ? 0 : 2),
  retryWrites: true,
  retryReads: true,
}

/** Maps a driver error to a short, credential-free description that is safe to log and surface. */
export function describeConnectionFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/bad auth|authentication failed|not authorized/i.test(message)) return 'database authentication failed (check the username and password in MONGODB_URI)'
  if (/querySrv|ENOTFOUND|ENODATA|EAI_AGAIN/i.test(message)) return 'database DNS lookup failed (the mongodb+srv:// SRV record could not be resolved; use the standard mongodb:// connection string from Atlas or fix DNS)'
  if (/not whitelisted|ip.*(not|isn't).*allowed|could not connect to any servers|server selection timed out|timed out|timeout/i.test(message)) return 'database network access failed (add this host to the Atlas Network Access list and check that the cluster is running)'
  if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT/i.test(message)) return 'database connection was refused or reset'
  if (/invalid (scheme|connection string)|must be escaped|URI/i.test(message)) return 'MONGODB_URI is not a valid MongoDB connection string'
  return 'database connection failed'
}

let listenersRegistered = false

function registerConnectionListeners(): void {
  if (listenersRegistered) return
  listenersRegistered = true
  mongoose.connection.on('disconnected', () => console.warn('MongoDB disconnected; the driver will try to reconnect.'))
  mongoose.connection.on('reconnected', () => console.info('MongoDB reconnected.'))
  mongoose.connection.on('error', (error: unknown) => console.error(`MongoDB connection error: ${error instanceof Error ? error.name : 'UnknownError'}`))
}

export async function connectDatabase(): Promise<void> {
  const mongoUri = env.mongoUri.trim()

  if (!mongoUri || mongoUri.includes('DATABASE_USER') || mongoUri.includes('<') || mongoUri.includes('example.com')) {
    throw new Error('MONGODB_URI is missing or still contains a placeholder. Update backend/.env with the real Atlas connection string.')
  }

  mongoose.set('strictQuery', true)
  // Production schemas are indexed by `npm run create-indexes`, never implicitly on boot or on a cold start.
  mongoose.set('autoIndex', env.nodeEnv !== 'production')
  registerConnectionListeners()

  try {
    await mongoose.connect(mongoUri, mongoOptions)
    console.log('MongoDB connected successfully')
  } catch (error) {
    throw new Error(describeConnectionFailure(error))
  }
}

let connecting: Promise<void> | undefined

/**
 * Shared, lazy connection used by the serverless entry point. Concurrent requests await one attempt,
 * and a failed attempt is forgotten so the next request retries instead of caching the failure.
 */
export function ensureDatabaseConnection(): Promise<void> {
  if (mongoose.connection.readyState === 1) return Promise.resolve()
  connecting ??= (async () => {
    validateEnvironment()
    await connectDatabase()
  })().finally(() => { connecting = undefined })
  return connecting
}

export function databaseStatus(): 'connected' | 'connecting' | 'disconnected' {
  const state = mongoose.connection.readyState
  return state === 1 ? 'connected' : state === 2 ? 'connecting' : 'disconnected'
}
