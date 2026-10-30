import { useEffect, useState } from 'react'

import { legalApi, type PolicyDocument, type PolicySummary, type PolicyType } from '../../services/legalApi'
import { formatPolicyDate, legalPath } from './legalRoutes'
import './Legal.css'

/** Bracketed text is a placeholder or an open decision for the owner; make it impossible to miss. */
function withPlaceholders(text: string) {
  return text.split(/(\[[^\]]+\])/g).map((part, index) =>
    part.startsWith('[') && part.endsWith(']')
      ? <mark key={index} className="policy-placeholder">{part}</mark>
      : <span key={index}>{part}</span>,
  )
}

function PolicyText({ policy }: { policy: PolicyDocument }) {
  return (
    <>
      <nav className="policy-toc" aria-label={`${policy.title} sections`}>
        <h2>On this page</h2>
        <ol>
          {policy.sections.map((section) => <li key={section.id}><a href={`#${section.id}`}>{section.heading}</a></li>)}
        </ol>
      </nav>
      {policy.sections.map((section) => (
        <section key={section.id} id={section.id} className="policy-section" aria-labelledby={`${section.id}-heading`}>
          <h2 id={`${section.id}-heading`}>{section.heading}</h2>
          {section.paragraphs.map((paragraph, index) => <p key={index}>{withPlaceholders(paragraph)}</p>)}
          {section.bullets && section.bullets.length > 0 && <ul>{section.bullets.map((bullet, index) => <li key={index}>{withPlaceholders(bullet)}</li>)}</ul>}
        </section>
      ))}
    </>
  )
}

export function LegalPage({ type }: { type: PolicyType }) {
  const requestedVersion = new URLSearchParams(window.location.search).get('version') ?? undefined
  const [policy, setPolicy] = useState<PolicyDocument | null>(null)
  const [versions, setVersions] = useState<PolicySummary[]>([])
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    legalApi.policy(type, requestedVersion).then((result) => {
      if (!active) return
      setPolicy(result.policy)
      setVersions(result.versions)
      setError('')
      document.title = `${result.policy.title} — smarTindahan`
    }).catch((caught: unknown) => {
      if (active) setError(caught instanceof Error ? caught.message : 'The policy could not be loaded.')
    })
    return () => { active = false }
  }, [type, requestedVersion, attempt])

  const otherType: PolicyType = type === 'terms' ? 'privacy' : 'terms'

  return (
    <div className="legal-page">
      <header className="legal-header">
        <a className="legal-brand" href={import.meta.env.BASE_URL}><span aria-hidden="true">S</span> smarTindahan</a>
        <nav aria-label="Legal pages">
          <a href={legalPath('terms')} aria-current={type === 'terms' ? 'page' : undefined}>Terms of Service</a>
          <a href={legalPath('privacy')} aria-current={type === 'privacy' ? 'page' : undefined}>Privacy Policy</a>
        </nav>
      </header>
      <main className="legal-main" id="main">
        {!policy && !error && <p role="status">Loading…</p>}
        {error && (
          <div className="legal-error" role="alert">
            <p>{error}</p>
            <button type="button" onClick={() => { setError(''); setAttempt((count) => count + 1) }}>Try again</button>
          </div>
        )}
        {policy && (
          <article>
            <h1>{policy.title}</h1>
            <p className="policy-meta">
              Version <strong>{policy.version}</strong> · Effective {formatPolicyDate(policy.effectiveAt)}
              {!policy.isCurrent && <> · <strong>This is an earlier version.</strong> <a href={legalPath(type)}>Read the current version</a></>}
            </p>
            {policy.isDraft && (
              <p className="policy-draft" role="note">
                <strong>Draft.</strong> This text has not yet been reviewed by the platform owner or by Philippine legal counsel. Highlighted items in [square brackets] are still to be filled in.
              </p>
            )}
            <p className="policy-summary-text">{policy.summary}</p>
            <PolicyText policy={policy} />
            {versions.length > 1 && (
              <section className="policy-section" aria-labelledby="versions-heading">
                <h2 id="versions-heading">Version history</h2>
                <ul>
                  {versions.map((entry) => (
                    <li key={entry.version}>
                      <a href={legalPath(type, entry.version)}>Version {entry.version}</a> — effective {formatPolicyDate(entry.effectiveAt)}{entry.isCurrent ? ' (current)' : ''}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </article>
        )}
      </main>
      <footer className="legal-footer">
        <a href={legalPath(otherType)}>{otherType === 'terms' ? 'Terms of Service' : 'Privacy Policy'}</a>
        <a href={import.meta.env.BASE_URL}>Back to smarTindahan</a>
      </footer>
    </div>
  )
}
