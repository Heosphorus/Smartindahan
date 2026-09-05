import test from 'node:test'
import assert from 'node:assert/strict'

import {
  generateOtp,
  hashOtp,
  maskEmail,
  validatePasswordStrength,
  validateOtpCode,
} from '../src/services/authService.js'

test('generateOtp creates a 6-digit numeric code', () => {
  const otp = generateOtp()

  assert.equal(typeof otp, 'string')
  assert.match(otp, /^\d{6}$/)
})

test('hashOtp returns a different hash than the original value', () => {
  const otp = '482913'
  const hash = hashOtp(otp)

  assert.notEqual(hash, otp)
  assert.match(hash, /^\$2[aby]\$/)
})

test('maskEmail hides the local part but keeps domain visible', () => {
  assert.equal(maskEmail('juan@gmail.com'), 'j***@gmail.com')
})

test('password validation enforces strength requirements', () => {
  assert.equal(validatePasswordStrength('weak').isValid, false)
  assert.equal(validatePasswordStrength('StrongPass1').isValid, true)
})

test('otp validation accepts a 6-digit token and rejects malformed values', () => {
  assert.equal(validateOtpCode('482913'), true)
  assert.equal(validateOtpCode('48291'), false)
  assert.equal(validateOtpCode('abcd12'), false)
})
