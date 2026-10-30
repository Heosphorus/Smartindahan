import dotenv from 'dotenv'

dotenv.config()

const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1', '::1', '[::1]']

/**
 * FRONTEND_URL accepts one or more comma-separated browser origins, for example
 * "https://app.vercel.app,https://owner.github.io". Paths and trailing slashes are
 * ignored because the browser `Origin` header never contains them.
 */
export function parseAllowedOrigins(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      try {
        return new URL(entry).origin
      } catch {
        return entry
      }
    })
}

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

export function allowedFrontendOrigins(): string[] {
  return parseAllowedOrigins(env.frontendUrl)
}

export type EnvironmentConfig = typeof env

export function validateEnvironment(config: EnvironmentConfig = env): void {
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error('PORT must be a valid TCP port number.')
  }

  if (config.nodeEnv === 'production') {
    const placeholderSecret = /^(development|replace|change|your|example|test)[-_ ]/i.test(config.jwtSecret)
    if (placeholderSecret || config.jwtSecret.length < 32) {
      throw new Error('JWT_SECRET must be a unique secret of at least 32 characters in production.')
    }
    if (!config.mongoUri.trim()) throw new Error('MONGODB_URI must be configured in production.')

    const origins = parseAllowedOrigins(config.frontendUrl)
    if (!origins.length) throw new Error('FRONTEND_URL must be configured with the production frontend origin.')
    for (const origin of origins) {
      let parsed: URL
      try {
        parsed = new URL(origin)
      } catch {
        throw new Error('FRONTEND_URL must contain valid origins separated by commas.')
      }
      if (parsed.protocol !== 'https:' || LOCAL_HOSTNAMES.includes(parsed.hostname)) {
        throw new Error('FRONTEND_URL must use public HTTPS production frontend origins.')
      }
    }

    if (config.emailMode === 'development') {
      throw new Error('EMAIL_MODE=development never delivers verification codes; set EMAIL_MODE=production.')
    }
    if (config.emailProvider === 'resend' && !config.resendApiKey) {
      throw new Error('RESEND_API_KEY must be configured when EMAIL_PROVIDER=resend.')
    }
  }
}
