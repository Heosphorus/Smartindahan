import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { privacyApi, type PendingReview, type PrivacyStatus } from '../../services/legalApi'
import { DataExportCard, DeletionCard } from './PrivacySettings'
import { CONSENT_CHANGED_EVENT, formatPolicyDate, legalPath } from './legalRoutes'
import './Legal.css'

type Props = { children: ReactNode; onSignOut: () => void }

function ReviewScreen({ review, deletion, onAccepted, onSignOut, onDeletionChanged }: { review: PendingReview; deletion: PrivacyStatus['deletion']; onAccepted: (pending: PendingReview[]) => void; onSignOut: () => void; onDeletionChanged: () => void }) {
  const [agreed, setAgreed] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLInputElement>(null)

  async function accept() {
    if (!agreed) {
      setError('Please tick the box to confirm you have read and accept the updated Terms of Service.')
      box.current?.focus()
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await privacyApi.accept(review.consentType, review.version)
      onAccepted(result.pending)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not record your choice. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="policy-review" aria-labelledby="review-heading">
      <h1 id="review-heading">{review.acceptedVersion ? 'We updated our Terms of Service' : 'Please review our Terms of Service'}</h1>
      <p>
        {review.acceptedVersion
          ? 'To keep using your store features, please read the updated Terms and tell us whether you accept them. Using the app is not treated as acceptance.'
          : 'We do not have a record of you accepting the current Terms of Service. To keep using your store features, please read them and accept.'}
      </p>
      {review.changes.length > 0 && (
        <>
          <h2>What changed</h2>
          <ul>{review.changes.map((change) => <li key={change.version}><strong>Version {change.version}:</strong> {change.changeSummary}</li>)}</ul>
        </>
      )}
      <p><a href={legalPath('terms', review.version)} target="_blank" rel="noopener noreferrer">Read the full Terms of Service, version {review.version}<span className="sr-only"> (opens in a new tab)</span></a></p>
      <div className="consent-box">
        <label className="consent-label" htmlFor="accept-updated-terms">
          <input id="accept-updated-terms" ref={box} type="checkbox" checked={agreed} aria-invalid={Boolean(error)} aria-describedby={error ? 'review-error' : undefined}
            onChange={(event) => { setAgreed(event.target.checked); if (event.target.checked) setError('') }} />
          <span>I have read and accept the Terms of Service, version {review.version}.</span>
        </label>
        {error && <p id="review-error" className="consent-error" role="alert">{error}</p>}
      </div>
      <div className="policy-review-actions">
        <button type="button" className="btn-primary" onClick={() => void accept()} disabled={busy}>{busy ? 'Saving…' : 'Accept and continue'}</button>
        <button type="button" className="btn-secondary" onClick={onSignOut}>Sign out without accepting</button>
      </div>
      <details>
        <summary>If you do not want to accept</summary>
        <p>You are not required to accept. You can sign out, download a copy of your data, or close your account.</p>
        <DataExportCard />
        <DeletionCard deletion={deletion} canDelete onChanged={onDeletionChanged} />
      </details>
    </main>
  )
}

/** Wraps the signed-in app: asks for renewed acceptance of changed Terms, and shows non-blocking notices. */
export function PolicyGate({ children, onSignOut }: Props) {
  const [status, setStatus] = useState<PrivacyStatus | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [bannerError, setBannerError] = useState('')

  const load = useCallback(() => {
    privacyApi.status().then((result) => { setStatus(result); setLoadFailed(false) }).catch(() => setLoadFailed(true))
  }, [])
  useEffect(() => { load() }, [load])

  // If the status cannot be loaded the server still enforces the rules; do not lock people out of their own app.
  if (!status && !loadFailed) return <p role="status" style={{ padding: 24 }}>Loading…</p>

  const blocking = status?.pending.find((review) => review.blocking)
  if (blocking && status) {
    return <ReviewScreen review={blocking} deletion={status.deletion} onSignOut={onSignOut} onDeletionChanged={load} onAccepted={(pending) => setStatus({ ...status, pending, blocking: pending.some((review) => review.blocking) })} />
  }

  const notices = status?.pending.filter((review) => !review.blocking) ?? []

  async function acknowledge(review: PendingReview) {
    setBusy(true)
    setBannerError('')
    try {
      const result = await privacyApi.accept(review.consentType, review.version)
      setStatus((current) => current ? { ...current, pending: result.pending } : current)
      window.dispatchEvent(new Event(CONSENT_CHANGED_EVENT))
    } catch (caught) {
      setBannerError(caught instanceof Error ? caught.message : 'We could not record your choice. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function cancelDeletion() {
    setBusy(true)
    try {
      await privacyApi.cancelDeletion()
      load()
    } catch (caught) {
      setBannerError(caught instanceof Error ? caught.message : 'We could not cancel the deletion. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {notices.map((review) => (
        <div key={review.policyType} className="policy-banner" role="region" aria-label="Privacy Policy notice">
          <p>
            {review.acceptedVersion ? 'We updated our Privacy Policy.' : 'Please review our Privacy Policy.'}{' '}
            <a href={legalPath('privacy', review.version)} target="_blank" rel="noopener noreferrer">Read version {review.version}<span className="sr-only"> (opens in a new tab)</span></a>.
            {' '}This notice explains how we handle your information; acknowledging it does not give us any new permission.
          </p>
          <button type="button" className="btn-secondary" onClick={() => void acknowledge(review)} disabled={busy}>I have read the Privacy Policy</button>
        </div>
      ))}
      {status?.deletion && (
        <div className="policy-banner warning" role="region" aria-label="Account deletion scheduled">
          <p><strong>Your account is scheduled to be deleted on {formatPolicyDate(status.deletion.scheduledFor)}.</strong> Until then you can download your data or cancel the deletion.</p>
          <button type="button" className="btn-secondary" onClick={() => void cancelDeletion()} disabled={busy}>Cancel deletion</button>
        </div>
      )}
      {bannerError && <p className="privacy-feedback error" role="alert">{bannerError}</p>}
      {children}
    </>
  )
}
