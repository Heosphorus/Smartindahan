import bcrypt from 'bcryptjs'
import { randomInt } from 'node:crypto'

export type PasswordValidationResult = {
  isValid: boolean
  message: string
}

export function generateOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0')
}

export function hashOtp(otp: string): string {
  return bcrypt.hashSync(otp, 10)
}

export function verifyOtpHash(otp: string, hash: string): boolean {
  return bcrypt.compareSync(otp, hash)
}

export function validateOtpCode(value: string): boolean {
  return /^\d{6}$/.test(value.trim())
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@')

  if (!domain || !local) {
    return email
  }

  const visibleLocal = local.slice(0, 1)
  return `${visibleLocal}***@${domain}`
}

export function validatePasswordStrength(password: string): PasswordValidationResult {
  if (password.length < 8) {
    return { isValid: false, message: 'Password must be at least 8 characters long.' }
  }

  if (!/[A-Z]/.test(password)) {
    return { isValid: false, message: 'Password must include at least one uppercase letter.' }
  }

  if (!/[a-z]/.test(password)) {
    return { isValid: false, message: 'Password must include at least one lowercase letter.' }
  }

  if (!/\d/.test(password)) {
    return { isValid: false, message: 'Password must include at least one number.' }
  }

  return { isValid: true, message: 'Password looks good.' }
}

export function sanitizeUserPayload<T extends Record<string, unknown>>(user: T): T {
  return user
}
