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
