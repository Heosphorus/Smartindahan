import dotenv from 'dotenv'

dotenv.config()

export const env = {
  port: Number(process.env.PORT ?? 5000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  mongoUri: process.env.MONGODB_URI ?? '',
  jwtSecret: process.env.JWT_SECRET ?? 'development-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  emailMode: process.env.EMAIL_MODE ?? 'development',
  emailProvider: process.env.EMAIL_PROVIDER ?? 'resend',
  resendApiKey: process.env.RESEND_API_KEY ?? '',
  emailHost: process.env.EMAIL_HOST ?? '',
  emailPort: Number(process.env.EMAIL_PORT ?? 587),
  emailUser: process.env.EMAIL_USER ?? '',
  emailPassword: process.env.EMAIL_PASSWORD ?? '',
  emailFrom: process.env.EMAIL_FROM ?? 'no-reply@sarismart.local',
  otpLength: 6,
  otpExpiresMinutes: 5,
  otpMaxAttempts: 5,
}

export function validateEnvironment(): void {
  if (!Number.isInteger(env.port) || env.port < 1 || env.port > 65535) {
    throw new Error('PORT must be a valid TCP port number.')
  }

  if (env.nodeEnv === 'production') {
    const placeholderSecret = /^(development|replace|change|your|example|test)[-_ ]/i.test(env.jwtSecret)
    if (placeholderSecret || env.jwtSecret.length < 32) {
      throw new Error('JWT_SECRET must be a unique secret of at least 32 characters in production.')
    }
    if (!env.mongoUri.trim()) throw new Error('MONGODB_URI must be configured in production.')
  }
}
