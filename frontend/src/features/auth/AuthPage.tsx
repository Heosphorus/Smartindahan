import { useEffect, useRef, useState } from 'react'

import { ApiError } from '../../services/apiClient'
import { authApi } from '../../services/authApi'
import { legalApi, type PolicySummary } from '../../services/legalApi'
import { legalPath } from '../legal/legalRoutes'
import '../legal/Legal.css'
import './AuthPage.css'

type AuthMode = 'login' | 'register' | 'verify' | 'forgot' | 'reset'

function PasswordEye({ visible }: { visible: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
      {!visible && <path d="m3 3 18 18" />}
    </svg>
  )
}

const initialRegistration = {
  firstName: '', lastName: '', email: '', mobileNumber: '', password: '', confirmPassword: '', storeName: '', storeAddress: '',
} as const

export function AuthPage({ onAuthenticated }: { onAuthenticated: (token: string) => void }) {
  const [mode, setMode] = useState<AuthMode>('login')
  const [form, setForm] = useState(initialRegistration)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showLoginPassword, setShowLoginPassword] = useState(false)
  const [showRegistrationPassword, setShowRegistrationPassword] = useState(false)
  const [showConfirmRegistrationPassword, setShowConfirmRegistrationPassword] = useState(false)
  const [confirmPassword, setConfirmPassword] = useState('')
  const [userId, setUserId] = useState('')
  const [otp, setOtp] = useState('')
  const [maskedEmail, setMaskedEmail] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  // The agreement box starts unchecked and is never checked for the user.
  const [agreed, setAgreed] = useState(false)
  const [agreementError, setAgreementError] = useState('')
  const [policies, setPolicies] = useState<{ terms: PolicySummary; privacy: PolicySummary } | null>(null)
  const [policiesFailed, setPoliciesFailed] = useState(false)
  const agreementBox = useRef<HTMLInputElement>(null)
  const otpInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (cooldown <= 0) return undefined
    const timer = window.setInterval(() => setCooldown((current) => Math.max(0, current - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [cooldown])

  const [policyAttempt, setPolicyAttempt] = useState(0)

  // Fetch the policy versions the user is about to agree to; the server checks the same versions on submit.
  useEffect(() => {
    if (mode !== 'register' || policies) return undefined
    let active = true
    legalApi.current().then(({ policies: list }) => {
      if (!active) return
      const terms = list.find((policy) => policy.policyType === 'terms')
      const privacy = list.find((policy) => policy.policyType === 'privacy')
      if (terms && privacy) setPolicies({ terms, privacy })
      else setPoliciesFailed(true)
    }).catch(() => { if (active) setPoliciesFailed(true) })
    return () => { active = false }
  }, [mode, policies, policyAttempt])

  function reloadPolicies() {
    setPoliciesFailed(false)
    setPolicies(null)
    setPolicyAttempt((count) => count + 1)
  }

  function clearFeedback() {
    setError('')
    setMessage('')
    setAgreementError('')
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
      if (!agreed) {
        setAgreementError('Please tick the box to confirm you have read and agree to the Terms of Service and acknowledge the Privacy Policy.')
        agreementBox.current?.focus()
        return
      }
      if (!policies) {
        throw new Error('The Terms of Service and Privacy Policy could not be loaded. Please check your connection and try again.')
      }
      let response
      try {
        response = await authApi.register({
          ...form,
          termsAccepted: true,
          privacyPolicyAccepted: true,
          termsVersion: policies.terms.version,
          privacyVersion: policies.privacy.version,
        })
      } catch (caught) {
        // The policies changed while the form was open: show the new versions and ask again.
        if (caught instanceof ApiError && caught.status === 409 && (caught.data as { code?: string } | null)?.code === 'POLICY_VERSION_MISMATCH') {
          setAgreed(false)
          reloadPolicies()
        }
        throw caught
      }
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
      let response
      try {
        response = await authApi.login(email, password)
      } catch (caught) {
        // A correct password on an unverified account sends the owner to the code screen instead of a dead end.
        const pending = caught instanceof ApiError && caught.status === 403 ? caught.data as { status?: string; userId?: string; maskedEmail?: string } | null : null
        if (pending?.status === 'EMAIL_VERIFICATION_REQUIRED' && pending.userId) {
          setUserId(pending.userId)
          setMaskedEmail(pending.maskedEmail ?? '')
          setCooldown(0)
          setMode('verify')
          setMessage('Your email is not verified yet. Enter the code we sent you, or request a new one.')
          return
        }
        throw caught
      }
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
  const title = mode === 'register' ? 'Create your smarTindahan account' : mode === 'verify' ? 'Verify your email' : mode === 'forgot' ? 'Forgot your password?' : mode === 'reset' ? 'Reset your password' : 'Welcome back to smarTindahan'

  return (
    <main className="auth-page">
      <section className="auth-brand-panel">
        <div className="auth-brand-mark">S</div>
        <p className="auth-eyebrow">SMARTINDAHAN / STORE OS</p>
        <h1>Smarter tools for your tindahan.</h1>
        <p>Keep every sale, shelf, and stock movement in one clear place.</p>
        <div className="auth-brand-footer">Built for everyday store owners.</div>
      </section>
      <section className="auth-form-panel">
        <div className="auth-form-wrap">
          <div className="auth-mobile-brand"><span className="auth-brand-mark">S</span><strong>smarTindahan</strong></div>
          <p className="auth-kicker">SECURE STORE ACCESS</p>
          <h2>{title}</h2>
          {mode === 'verify' && <p className="auth-helper">We sent a 6-digit code to <strong>{maskedEmail}</strong></p>}
          {isCodeMode && <p className="auth-helper">Enter the code sent to <strong>{maskedEmail}</strong></p>}
          {message && <div className="auth-message">{message}</div>}
          {error && <div className="auth-error">{error}</div>}

          {mode === 'login' && <form onSubmit={(event) => { event.preventDefault(); void login() }}>
            <label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
            <label>Password<div className="auth-password-field"><input type={showLoginPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /><button className="auth-password-toggle" type="button" aria-label={showLoginPassword ? 'Hide password' : 'Show password'} aria-pressed={showLoginPassword} onClick={() => setShowLoginPassword((visible) => !visible)}><PasswordEye visible={showLoginPassword} /></button></div></label>
            <button className="auth-primary" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
            <button className="auth-link auth-forgot" type="button" onClick={() => changeMode('forgot')}>Forgot password?</button>
          </form>}

          {mode === 'register' && <form className="auth-register-form" onSubmit={(event) => { event.preventDefault(); void register() }}>
            <div className="auth-two-col"><label>First name<input value={form.firstName} onChange={(event) => updateField('firstName', event.target.value)} required /></label><label>Last name<input value={form.lastName} onChange={(event) => updateField('lastName', event.target.value)} required /></label></div>
            <label>Email address<input type="email" value={form.email} onChange={(event) => updateField('email', event.target.value)} required /></label>
            <label>Mobile number<input type="text" inputMode="numeric" autoComplete="tel" maxLength={15} pattern="[0-9]{1,15}" title="Enter up to 15 digits." value={form.mobileNumber} onChange={(event) => updateField('mobileNumber', event.target.value.replace(/\D/g, '').slice(0, 15))} required /></label>
            <div className="auth-two-col"><label>Password<div className="auth-password-field"><input type={showRegistrationPassword ? 'text' : 'password'} value={form.password} onChange={(event) => updateField('password', event.target.value)} autoComplete="new-password" required /><button className="auth-password-toggle" type="button" aria-label={showRegistrationPassword ? 'Hide password' : 'Show password'} aria-pressed={showRegistrationPassword} onClick={() => setShowRegistrationPassword((visible) => !visible)}><PasswordEye visible={showRegistrationPassword} /></button></div></label><label>Confirm password<div className="auth-password-field"><input type={showConfirmRegistrationPassword ? 'text' : 'password'} value={form.confirmPassword} onChange={(event) => updateField('confirmPassword', event.target.value)} autoComplete="new-password" required /><button className="auth-password-toggle" type="button" aria-label={showConfirmRegistrationPassword ? 'Hide confirm password' : 'Show confirm password'} aria-pressed={showConfirmRegistrationPassword} onClick={() => setShowConfirmRegistrationPassword((visible) => !visible)}><PasswordEye visible={showConfirmRegistrationPassword} /></button></div></label></div>
            <label>Store name<input value={form.storeName} onChange={(event) => updateField('storeName', event.target.value)} required /></label>
            <label>Store address<input value={form.storeAddress} onChange={(event) => updateField('storeAddress', event.target.value)} required /></label>
            <div className="consent-box">
              <label className="consent-label" htmlFor="agree-terms">
                <input id="agree-terms" ref={agreementBox} type="checkbox" checked={agreed} aria-invalid={Boolean(agreementError)} aria-describedby={agreementError ? 'agree-error agree-note' : 'agree-note'}
                  onChange={(event) => { setAgreed(event.target.checked); if (event.target.checked) setAgreementError('') }} />
                <span>I have read and agree to the <a href={legalPath('terms', policies?.terms.version)} target="_blank" rel="noopener noreferrer">Terms of Service<span className="sr-only"> (opens in a new tab)</span></a> and acknowledge the <a href={legalPath('privacy', policies?.privacy.version)} target="_blank" rel="noopener noreferrer">Privacy Policy<span className="sr-only"> (opens in a new tab)</span></a>.</span>
              </label>
              <p id="agree-note" className="consent-note">The links open in a new tab, so what you typed here is kept. We send no marketing messages.</p>
              {agreementError && <p id="agree-error" className="consent-error" role="alert">{agreementError}</p>}
              {policiesFailed && <p className="consent-error" role="alert">We could not load the current policies. <button type="button" className="auth-link" onClick={reloadPolicies}>Try again</button></p>}
            </div>
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
          <div className="auth-legal-links">
            <a href={legalPath('terms')} target="_blank" rel="noopener noreferrer">Terms of Service<span className="sr-only"> (opens in a new tab)</span></a>
            <a href={legalPath('privacy')} target="_blank" rel="noopener noreferrer">Privacy Policy<span className="sr-only"> (opens in a new tab)</span></a>
          </div>
        </div>
      </section>
    </main>
  )
}
