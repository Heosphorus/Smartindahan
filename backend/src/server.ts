import cors from 'cors'
import express from 'express'
import { pathToFileURL } from 'node:url'
import mongoose from 'mongoose'

import { connectDatabase } from './config/database.js'
import { env, validateEnvironment } from './config/env.js'
import authRoutes from './routes/authRoutes.js'
import storeRoutes from './routes/storeRoutes.js'
import businessRoutes from './routes/businessRoutes.js'
import adminRoutes from './routes/adminRoutes.js'

export const app = express()

app.disable('x-powered-by')

const developmentOrigins = env.nodeEnv === 'production' ? [] : ['http://localhost:5173', 'http://localhost:5174']

app.use(cors({
  origin: (origin, callback) => {
    const allowedOrigins = [env.frontendUrl, ...developmentOrigins]
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true)
      return
    }
    callback(new Error('Origin is not allowed by CORS'))
  },
  credentials: true,
}))

app.use(express.json({ limit: '1mb' }))
const MAX_INPUT_LENGTH = 64

function containsOverlongString(value: unknown): boolean {
  if (typeof value === 'string') return value.length > MAX_INPUT_LENGTH
  if (Array.isArray(value)) return value.some(containsOverlongString)
  if (value && typeof value === 'object') return Object.values(value).some(containsOverlongString)
  return false
}

app.use((req, res, next) => {
  if (containsOverlongString(req.body) || containsOverlongString(req.query)) {
    res.status(400).json({ message: `Each text input must be ${MAX_INPUT_LENGTH} characters or fewer.` })
    return
  }
  next()
})

app.use((_, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-XSS-Protection', '1; mode=block')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  const developmentConnectSources = env.nodeEnv === 'production' ? '' : ' http://localhost:5173 http://localhost:5174'
  res.setHeader('Content-Security-Policy', `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self'; connect-src 'self'${developmentConnectSources}; frame-ancestors 'none'`)
  if (env.nodeEnv === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
  next()
})

app.use('/api/auth', authRoutes)
app.use('/api/store', storeRoutes)
app.use('/api/business', businessRoutes)
app.use('/api/auth/admin', adminRoutes)

app.get('/health', (_, res) => {
  res.json({ status: 'ok' })
})

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const errorCode = error && typeof error === 'object' && 'code' in error ? error.code : undefined
  const status = error instanceof mongoose.Error.ValidationError || error instanceof mongoose.Error.CastError
    ? 400
    : errorCode === 11000
      ? 409
      : error instanceof SyntaxError && 'status' in error && error.status === 400
        ? 400
        : 500
  const message = error instanceof mongoose.Error.ValidationError
    ? 'The submitted data is invalid.'
    : error instanceof mongoose.Error.CastError
      ? 'A resource identifier is invalid.'
      : errorCode === 11000
        ? 'A record with these details already exists.'
        : status === 400
          ? 'The request body is invalid.'
          : 'The server could not complete that request.'
  const errorName = error instanceof Error ? error.name : 'UnknownError'
  console.error(`API request failed (${status}): ${errorName}`)
  res.status(status).json({ message })
})

async function startServer(): Promise<void> {
  validateEnvironment()
  await connectDatabase()
  const server = app.listen(env.port, () => {
    console.log(`smarTindahan backend running on port ${env.port}`)
  })

  let shuttingDown = false
  const shutdown = (signal: string): void => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`Received ${signal}; closing smarTindahan backend`)
    server.close((error) => {
      if (error) process.exitCode = 1
      void mongoose.disconnect().catch(() => { process.exitCode = 1 })
    })
  }
  process.once('SIGINT', () => shutdown('SIGINT'))
  process.once('SIGTERM', () => shutdown('SIGTERM'))
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  startServer().catch((error: unknown) => {
    console.error('Unable to start smarTindahan backend:', error instanceof Error ? error.message : 'Unknown startup error')
    process.exitCode = 1
  })
}
