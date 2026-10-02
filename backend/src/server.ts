import cors from 'cors'
import express from 'express'

import { connectDatabase } from './config/database.js'
import { env } from './config/env.js'
import authRoutes from './routes/authRoutes.js'
import storeRoutes from './routes/storeRoutes.js'
import businessRoutes from './routes/businessRoutes.js'
import adminRoutes from './routes/adminRoutes.js'

const app = express()

app.disable('x-powered-by')

app.use(cors({
  origin: (origin, callback) => {
    const allowedOrigins = [env.frontendUrl, 'http://localhost:5173', 'http://localhost:5174']
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true)
      return
    }
    callback(new Error('Origin is not allowed by CORS'))
  },
  credentials: true,
}))

app.use(express.json())
app.use((_, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-XSS-Protection', '1; mode=block')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self'; connect-src 'self' http://localhost:5173 http://localhost:5174; frame-ancestors 'none'")
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
  console.error('Unhandled API error:', error)
  const message = env.nodeEnv === 'development' && error instanceof Error
    ? error.message
    : 'The server could not complete that request.'
  res.status(500).json({ message })
})

async function startServer(): Promise<void> {
  await connectDatabase()
  app.listen(env.port, () => {
    console.log(`SariSmart backend running on port ${env.port}`)
  })
}

startServer().catch((error: unknown) => {
  console.error('Unable to start SariSmart backend:', error)
  process.exitCode = 1
})
