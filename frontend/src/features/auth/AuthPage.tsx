import { useEffect, useRef, useState } from 'react'

import { authApi } from '../../services/authApi'
import './AuthPage.css'

type AuthMode = 'login' | 'register' | 'verify' | 'forgot' | 'reset'

const initialRegistration = {
  firstName: '', lastName: '', email: '', mobileNumber: '', password: '', confirmPassword: '', storeName: '', storeAddress: '',
}

export function AuthPage({ onAuthenticated }: { onAuthenticated: (token: string) => void }) {
  const [mode, setMode] = useState<AuthMode>('login')
  const [form, setForm] = useState(initialRegistration)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [userId, setUserId] = useState('')
  const [otp, setOtp] = useState('')
  const [maskedEmail, setMaskedEmail] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const otpInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (cooldown <= 0) return undefined
    const timer = window.setInterval(() => setCooldown((current) => Math.max(0, current - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [cooldown])

  function clearFeedback() {
    setError('')
    setMessage('')
  }

  function changeMode(nextMode: AuthMode) {
    clearFeedback()
    setMode(nextMode)
    setOtp('')
  }

  function updateField(field: keyof typeof initialRegistration, value: string) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function submit(action: () => Promise<void>) {
    clearFeedback()
    setBusy(true)
    try {
      await action()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function register() {
    await submit(async () => {
      const response = await authApi.register(form)
      setUserId(response.user?.id ?? '')
      setMaskedEmail(response.user?.maskedEmail ?? '')
      setMode('verify')
      setCooldown(60)
      setMessage(response.message ?? 'Check your email for a verification code.')
    })
  }

  async function verifyEmail(code = otp) {
    await submit(async () => {
      const response = await authApi.verifyEmail(userId, code)
      setMode('login')
      setEmail(response.user?.email ?? form.email)
      setOtp('')
      setMessage('Email verified. You can now sign in.')
    })
  }

  async function resend() {
    if (cooldown > 0) return
    await submit(async () => {
      const response = await authApi.resendOtp(userId)
      setMaskedEmail(response.maskedEmail ?? maskedEmail)
      setCooldown(60)
      setMessage(response.message ?? 'A new code has been sent.')
    })
  }

  async function login() {
    await submit(async () => {
      const response = await authApi.login(email, password)
      if (!response.token) throw new Error('The server did not return a session token.')
      localStorage.setItem('sarismart_token', response.token)
      onAuthenticated(response.token)
    })
  }

  async function requestReset() {
    await submit(async () => {
      const response = await authApi.forgotPassword(email)
      setUserId(response.userId ?? '')
      setMaskedEmail(response.maskedEmail ?? '')
      setMode('reset')
      setCooldown(60)
      setMessage(response.message ?? 'Check your email for a reset code.')
    })
  }

  async function reset(code = otp) {
    await submit(async () => {
      await authApi.verifyResetOtp(userId, code)
      await authApi.resetPassword(userId, password, confirmPassword)
      setMode('login')
      setPassword('')
      setConfirmPassword('')
      setOtp('')
      setMessage('Your password has been successfully changed.')
    })
  }

  function handleOtpChange(value: string) {
    const next = value.replace(/\D/g, '').slice(0, 6)
    setOtp(next)
    if (next.length === 6) void (mode === 'verify' ? verifyEmail(next) : reset(next))
  }

  const isCodeMode = mode === 'verify' || mode === 'reset'
  const title = mode === 'register' ? 'Create your SariSmart account' : mode === 'verify' ? 'Verify your email' : mode === 'forgot' ? 'Forgot your password?' : mode === 'reset' ? 'Reset your password' : 'Welcome back to SariSmart'

  return (
    <main className="auth-page">
      <section className="auth-brand-panel">
        <div className="auth-brand-mark">S</div>
        <p className="auth-eyebrow">SARISMART / STORE OS</p>
        <h1>Smarter tools for your tindahan.</h1>
        <p>Keep every sale, shelf, and stock movement in one clear place.</p>
        <div className="auth-brand-footer">Built for everyday store owners.</div>
      </section>
      <section className="auth-form-panel">
        <div className="auth-form-wrap">
          <div className="auth-mobile-brand"><span className="auth-brand-mark">S</span><strong>SariSmart</strong></div>
          <p className="auth-kicker">SECURE STORE ACCESS</p>
          <h2>{title}</h2>
          {mode === 'verify' && <p className="auth-helper">We sent a 6-digit code to <strong>{maskedEmail}</strong></p>}
          {isCodeMode && <p className="auth-helper">Enter the code sent to <strong>{maskedEmail}</strong></p>}
          {message && <div className="auth-message">{message}</div>}
          {error && <div className="auth-error">{error}</div>}

          {mode === 'login' && <form onSubmit={(event) => { event.preventDefault(); void login() }}>
            <label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
            <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
            <button className="auth-primary" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
            <button className="auth-link auth-forgot" type="button" onClick={() => changeMode('forgot')}>Forgot password?</button>
          </form>}

          {mode === 'register' && <form className="auth-register-form" onSubmit={(event) => { event.preventDefault(); void register() }}>
            <div className="auth-two-col"><label>First name<input value={form.firstName} onChange={(event) => updateField('firstName', event.target.value)} required /></label><label>Last name<input value={form.lastName} onChange={(event) => updateField('lastName', event.target.value)} required /></label></div>
            <label>Email address<input type="email" value={form.email} onChange={(event) => updateField('email', event.target.value)} required /></label>
            <label>Mobile number<input value={form.mobileNumber} onChange={(event) => updateField('mobileNumber', event.target.value)} required /></label>
            <div className="auth-two-col"><label>Password<input type="password" value={form.password} onChange={(event) => updateField('password', event.target.value)} required /></label><label>Confirm password<input type="password" value={form.confirmPassword} onChange={(event) => updateField('confirmPassword', event.target.value)} required /></label></div>
            <label>Store name<input value={form.storeName} onChange={(event) => updateField('storeName', event.target.value)} required /></label>
            <label>Store address<input value={form.storeAddress} onChange={(event) => updateField('storeAddress', event.target.value)} required /></label>
            <button className="auth-primary" disabled={busy}>{busy ? 'Creating account...' : 'Create account'}</button>
          </form>}

          {isCodeMode && <form onSubmit={(event) => { event.preventDefault(); void (mode === 'verify' ? verifyEmail() : reset()) }}>
            <label>Verification code<input ref={otpInput} className="auth-otp-input" inputMode="numeric" autoComplete="one-time-code" value={otp} onChange={(event) => handleOtpChange(event.target.value)} placeholder="000000" maxLength={6} required /></label>
            {mode === 'reset' && <><label>New password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label><label>Confirm password<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label></>}
            <button className="auth-primary" disabled={busy || otp.length !== 6}>{busy ? 'Checking...' : mode === 'verify' ? 'Verify email' : 'Reset password'}</button>
            <button className="auth-link" type="button" disabled={cooldown > 0 || busy} onClick={() => void resend()}>{cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}</button>
          </form>}

          {mode === 'forgot' && <form onSubmit={(event) => { event.preventDefault(); void requestReset() }}><label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><button className="auth-primary" disabled={busy}>{busy ? 'Sending code...' : 'Send verification code'}</button></form>}

          <div className="auth-switch">{mode === 'login' ? <>Don't have an account? <button className="auth-link" type="button" onClick={() => changeMode('register')}>Create one</button></> : <button className="auth-link" type="button" onClick={() => changeMode('login')}>Back to sign in</button>}</div>
        </div>
      </section>
    </main>
  )
}
