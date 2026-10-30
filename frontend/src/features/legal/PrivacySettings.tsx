import { useCallback, useEffect, useState, type FormEvent } from 'react'

import {
  privacyApi,
  privacyRequestTypes,
  type DeletionState,
  type PrivacyOverview,
  type PrivacyRequest,
  type PrivacyRequestType,
} from '../../services/legalApi'
import { CONSENT_CHANGED_EVENT, formatPolicyDate, legalPath } from './legalRoutes'
import './Legal.css'

const CONSENT_LABELS = { TERMS_OF_SERVICE: 'Terms of Service (accepted)', PRIVACY_NOTICE: 'Privacy Policy (acknowledged)' } as const
const STATUS_LABELS = { RECEIVED: 'Received', IN_PROGRESS: 'Being handled', COMPLETED: 'Completed', DECLINED: 'Declined' } as const
const MAX_MESSAGE_LENGTH = 1000

function Feedback({ kind, text }: { kind: 'ok' | 'error'; text: string }) {
  if (!text) return null
  return <p className={`privacy-feedback ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{text}</p>
}

function messageOf(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback
}

export function DataExportCard() {
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; text: string }>({ kind: 'ok', text: '' })

  async function download() {
    setBusy(true)
    setFeedback({ kind: 'ok', text: '' })
    try {
      const data = await privacyApi.exportData()
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `smartindahan-my-data-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      setFeedback({ kind: 'ok', text: 'Your file was downloaded. It contains your account details, agreement records, store records and security events. Keep it somewhere safe.' })
    } catch (caught) {
      setFeedback({ kind: 'error', text: messageOf(caught, 'We could not prepare your data. Please try again.') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="privacy-card" aria-labelledby="export-heading">
      <h4 id="export-heading">Download my data</h4>
      <p>Get a copy of the information smarTindahan stores for your account and your store as a JSON file. Passwords, codes and session tokens are never included.</p>
      <button type="button" className="btn-secondary" onClick={() => void download()} disabled={busy}>{busy ? 'Preparing…' : 'Download my data'}</button>
      <Feedback {...feedback} />
    </section>
  )
}

export function DeletionCard({ deletion, canDelete, onChanged }: { deletion: DeletionState; canDelete: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; text: string }>({ kind: 'ok', text: '' })

  async function schedule(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setFeedback({ kind: 'ok', text: '' })
    try {
      await privacyApi.requestDeletion(password, confirmation)
      setOpen(false)
      setPassword('')
      setConfirmation('')
      onChanged()
    } catch (caught) {
      setFeedback({ kind: 'error', text: messageOf(caught, 'We could not schedule the deletion. Please try again.') })
    } finally {
      setBusy(false)
    }
  }

  async function cancel() {
    setBusy(true)
    setFeedback({ kind: 'ok', text: '' })
    try {
      await privacyApi.cancelDeletion()
      onChanged()
    } catch (caught) {
      setFeedback({ kind: 'error', text: messageOf(caught, 'We could not cancel the deletion. Please try again.') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="privacy-card privacy-danger" aria-labelledby="delete-heading">
      <h4 id="delete-heading">Close my account and delete my data</h4>
      {!canDelete && <p>Administrator accounts cannot be closed here. Please contact the platform owner.</p>}
      {canDelete && (
        <>
          <p>What happens when you close your account:</p>
          <ul>
            <li>Nothing is deleted right away. Your deletion is scheduled and you can cancel until the date shown.</li>
            <li>When the waiting period ends, your account, products, sales, stock history, customers, suppliers, expenses and privacy requests are permanently deleted from our live system. This cannot be undone.</li>
            <li>Copies in database backups may remain until those backups expire. A limited record of what you agreed to and of security events is kept without your password or codes.</li>
            <li>You may need your sales and expense records for your own tax or business duties. Download your data first.</li>
          </ul>
          {deletion ? (
            <>
              <p><strong>Your account is scheduled to be deleted on {formatPolicyDate(deletion.scheduledFor)}.</strong> You can keep using it until then.</p>
              <button type="button" className="btn-secondary" onClick={() => void cancel()} disabled={busy}>{busy ? 'Working…' : 'Cancel deletion and keep my account'}</button>
            </>
          ) : !open ? (
            <button type="button" className="danger-button" onClick={() => setOpen(true)}>Close my account…</button>
          ) : (
            <form onSubmit={(event) => void schedule(event)}>
              <label htmlFor="delete-password">Your password</label>
              <input id="delete-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
              <label htmlFor="delete-confirm">Type DELETE to confirm <span className="hint">(capital letters)</span></label>
              <input id="delete-confirm" type="text" autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required />
              <div className="privacy-actions" style={{ marginTop: 14 }}>
                <button type="submit" className="danger-button" disabled={busy || confirmation !== 'DELETE' || !password}>{busy ? 'Working…' : 'Schedule deletion'}</button>
                <button type="button" className="btn-secondary" onClick={() => { setOpen(false); setPassword(''); setConfirmation(''); setFeedback({ kind: 'ok', text: '' }) }}>Keep my account</button>
              </div>
            </form>
          )}
        </>
      )}
      <Feedback {...feedback} />
    </section>
  )
}

function RequestsCard() {
  const [type, setType] = useState<PrivacyRequestType>('QUESTION')
  const [message, setMessage] = useState('')
  const [requests, setRequests] = useState<PrivacyRequest[]>([])
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; text: string }>({ kind: 'ok', text: '' })

  const load = useCallback(() => {
    privacyApi.requests().then((result) => setRequests(result.requests)).catch(() => undefined)
  }, [])
  useEffect(() => { load() }, [load])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setFeedback({ kind: 'ok', text: '' })
    try {
      const result = await privacyApi.submitRequest(type, message)
      setMessage('')
      setFeedback({ kind: 'ok', text: result.message })
      load()
    } catch (caught) {
      setFeedback({ kind: 'error', text: messageOf(caught, 'We could not send your request. Please try again.') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="privacy-card" aria-labelledby="requests-heading">
      <h4 id="requests-heading">Privacy requests and questions</h4>
      <p>Ask us to correct information (for example your email address, which cannot be changed in the app), ask a question, or make a complaint. We reply to the email address on your account.</p>
      <form onSubmit={(event) => void submit(event)}>
        <label htmlFor="request-type">What is your request about?</label>
        <select id="request-type" value={type} onChange={(event) => setType(event.target.value as PrivacyRequestType)}>
          {privacyRequestTypes.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <label htmlFor="request-message">Your message <span className="hint">({message.length}/{MAX_MESSAGE_LENGTH})</span></label>
        <textarea id="request-message" rows={4} maxLength={MAX_MESSAGE_LENGTH} data-long-text value={message} onChange={(event) => setMessage(event.target.value)} required />
        <div className="privacy-actions" style={{ marginTop: 12 }}>
          <button type="submit" className="btn-secondary" disabled={busy || !message.trim()}>{busy ? 'Sending…' : 'Send request'}</button>
        </div>
      </form>
      <Feedback {...feedback} />
      {requests.length > 0 && (
        <div className="privacy-table-wrap">
          <table className="privacy-table">
            <caption className="sr-only">Your privacy requests</caption>
            <thead><tr><th scope="col">Sent</th><th scope="col">About</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {requests.map((request) => (
                <tr key={request._id}>
                  <td>{formatPolicyDate(request.createdAt)}</td>
                  <td>{privacyRequestTypes.find((option) => option.value === request.type)?.label ?? request.type}</td>
                  <td>{STATUS_LABELS[request.status]}{request.resolutionNote ? ` — ${request.resolutionNote}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export function PrivacySettings() {
  const [overview, setOverview] = useState<PrivacyOverview | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    privacyApi.overview().then((result) => { setOverview(result); setError('') }).catch((caught: unknown) => setError(messageOf(caught, 'Privacy information could not be loaded.')))
  }, [])
  useEffect(() => {
    load()
    window.addEventListener(CONSENT_CHANGED_EVENT, load)
    return () => window.removeEventListener(CONSENT_CHANGED_EVENT, load)
  }, [load])

  return (
    <section className="privacy-settings" aria-labelledby="privacy-heading">
      <div className="settings-section-heading"><div><h3 id="privacy-heading">Privacy and security</h3><p>See what you agreed to, download or delete your data, and contact us about your information.</p></div></div>
      {error && <p className="privacy-feedback error" role="alert">{error} <button type="button" className="btn-secondary" onClick={load}>Try again</button></p>}

      <section className="privacy-card" aria-labelledby="agreements-heading">
        <h4 id="agreements-heading">Terms and privacy notice</h4>
        <p>
          Read the current <a href={legalPath('terms')} target="_blank" rel="noopener noreferrer">Terms of Service<span className="sr-only"> (opens in a new tab)</span></a> and{' '}
          <a href={legalPath('privacy')} target="_blank" rel="noopener noreferrer">Privacy Policy<span className="sr-only"> (opens in a new tab)</span></a>.
          {' '}We do not send marketing messages, so there are no marketing preferences to manage.
        </p>
        {overview && (overview.consents.length === 0
          ? <p>No agreement is on record for this account yet. You will be asked to review the current policies.</p>
          : (
            <div className="privacy-table-wrap">
              <table className="privacy-table">
                <caption className="sr-only">Your agreement history</caption>
                <thead><tr><th scope="col">Document</th><th scope="col">Version</th><th scope="col">Date</th></tr></thead>
                <tbody>
                  {overview.consents.map((entry) => (
                    <tr key={entry._id}>
                      <td>{CONSENT_LABELS[entry.consentType]}</td>
                      <td><a href={legalPath(entry.consentType === 'TERMS_OF_SERVICE' ? 'terms' : 'privacy', entry.policyVersion)} target="_blank" rel="noopener noreferrer">{entry.policyVersion}<span className="sr-only"> (opens in a new tab)</span></a></td>
                      <td>{formatPolicyDate(entry.acceptedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
      </section>

      <section className="privacy-card" aria-labelledby="my-info-heading">
        <h4 id="my-info-heading">Your information</h4>
        <p>You can change your name, contact number, store name and store address in the profile forms above, and your password with “Change password”. Your email address cannot be changed in the app; send a request below and we will help.</p>
      </section>

      <DataExportCard />
      <RequestsCard />
      <DeletionCard deletion={overview?.deletion ?? null} canDelete={overview?.canDeleteAccount ?? true} onChanged={load} />
    </section>
  )
}
