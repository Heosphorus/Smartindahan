import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { legalApi, privacyApi, type PendingReview, type PolicyDocument } from '../../services/legalApi'
import { LegalPage } from './LegalPage'
import { PolicyGate } from './PolicyGate'
import { DataExportCard, DeletionCard } from './PrivacySettings'

const termsDocument: PolicyDocument = {
  policyType: 'terms', version: '1.0-draft', title: 'Terms of Service', summary: 'Plain summary.', changeSummary: 'First version.', isDraft: true,
  publishedAt: '2026-01-01T00:00:00Z', effectiveAt: '2026-01-01T00:00:00Z', requiresReacceptance: true, isCurrent: true,
  sections: [
    { id: 'what-it-is', heading: '1. What it does', paragraphs: ['Operated by [operator legal name — to be provided by the owner].'] },
    { id: 'acceptable-use', heading: '4. Acceptable use', paragraphs: ['You agree not to:'], bullets: ['abuse the service'] },
  ],
}

const termsReview = (overrides: Partial<PendingReview> = {}): PendingReview => ({
  policyType: 'terms', consentType: 'TERMS_OF_SERVICE', version: '2.0', title: 'Terms of Service', isDraft: false, blocking: true,
  acceptedVersion: '1.0-draft', changes: [{ version: '2.0', changeSummary: 'We clarified how deletion works.' }], ...overrides,
})

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('legal page', () => {
  it('shows the draft notice, highlighted placeholders and section navigation', async () => {
    vi.spyOn(legalApi, 'policy').mockResolvedValue({ policy: termsDocument, versions: [termsDocument] })
    const { container } = render(<LegalPage type="terms" />)

    expect(await screen.findByRole('heading', { level: 1, name: 'Terms of Service' })).toBeTruthy()
    expect(screen.getByRole('note').textContent).toMatch(/not yet been reviewed/)
    expect(container.querySelector('mark.policy-placeholder')?.textContent).toBe('[operator legal name — to be provided by the owner]')
    const toc = screen.getByRole('navigation', { name: 'Terms of Service sections' })
    expect(toc.querySelector('a[href="#acceptable-use"]')?.textContent).toBe('4. Acceptable use')
    const privacyLinks = screen.getAllByRole('link', { name: 'Privacy Policy' })
    expect(privacyLinks.length).toBeGreaterThanOrEqual(2)
    expect(privacyLinks.every((link) => /\/privacy$/.test(link.getAttribute('href') ?? ''))).toBe(true)
  })

  it('explains a load failure and can retry', async () => {
    const policy = vi.spyOn(legalApi, 'policy').mockRejectedValueOnce(new Error('Cannot reach the server.')).mockResolvedValue({ policy: termsDocument, versions: [termsDocument] })
    render(<LegalPage type="terms" />)
    expect((await screen.findByRole('alert')).textContent).toMatch(/Cannot reach the server/)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Terms of Service' })).toBeTruthy()
    expect(policy).toHaveBeenCalledTimes(2)
  })
})

describe('policy gate', () => {
  it('stops store features until updated Terms are explicitly accepted', async () => {
    vi.spyOn(privacyApi, 'status').mockResolvedValue({ pending: [termsReview()], blocking: true, deletion: null })
    const accept = vi.spyOn(privacyApi, 'accept').mockResolvedValue({ message: 'ok', pending: [] })
    render(<PolicyGate onSignOut={vi.fn()}><p>Store dashboard</p></PolicyGate>)

    expect(await screen.findByRole('heading', { name: 'We updated our Terms of Service' })).toBeTruthy()
    expect(screen.queryByText('Store dashboard')).toBeNull()
    expect(screen.getByText(/We clarified how deletion works/)).toBeTruthy()
    expect(screen.getByRole('link', { name: /Read the full Terms of Service, version 2\.0/ }).getAttribute('href')).toMatch(/\/terms\?version=2\.0$/)
    const box = screen.getByRole('checkbox') as HTMLInputElement
    expect(box.checked).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Accept and continue' }))
    expect(await screen.findByText(/Please tick the box/)).toBeTruthy()
    expect(accept).not.toHaveBeenCalled()

    fireEvent.click(box)
    fireEvent.click(screen.getByRole('button', { name: 'Accept and continue' }))
    await waitFor(() => expect(accept).toHaveBeenCalledWith('TERMS_OF_SERVICE', '2.0'))
    expect(await screen.findByText('Store dashboard')).toBeTruthy()
  })

  it('lets someone who does not accept sign out, export or delete instead', async () => {
    vi.spyOn(privacyApi, 'status').mockResolvedValue({ pending: [termsReview()], blocking: true, deletion: null })
    const signOut = vi.fn()
    render(<PolicyGate onSignOut={signOut}><p>Store dashboard</p></PolicyGate>)
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out without accepting' }))
    expect(signOut).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Download my data' })).toBeTruthy()
  })

  it('shows an updated Privacy Policy as a notice that never blocks the app', async () => {
    const privacy: PendingReview = { ...termsReview(), policyType: 'privacy', consentType: 'PRIVACY_NOTICE', title: 'Privacy Policy', blocking: false }
    vi.spyOn(privacyApi, 'status').mockResolvedValue({ pending: [privacy], blocking: false, deletion: null })
    const accept = vi.spyOn(privacyApi, 'accept').mockResolvedValue({ message: 'ok', pending: [] })
    render(<PolicyGate onSignOut={vi.fn()}><p>Store dashboard</p></PolicyGate>)

    expect(await screen.findByText('Store dashboard')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Privacy Policy notice' }).textContent).toMatch(/acknowledging it does not give us any new permission/)
    expect(accept).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'I have read the Privacy Policy' }))
    await waitFor(() => expect(accept).toHaveBeenCalledWith('PRIVACY_NOTICE', '2.0'))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Privacy Policy notice' })).toBeNull())
  })

  it('renders the app untouched when nothing needs review and warns about a scheduled deletion', async () => {
    vi.spyOn(privacyApi, 'status').mockResolvedValue({ pending: [], blocking: false, deletion: { requestedAt: '2026-02-01T00:00:00Z', scheduledFor: '2026-02-15T00:00:00Z' } })
    const cancel = vi.spyOn(privacyApi, 'cancelDeletion').mockResolvedValue({ message: 'ok' })
    render(<PolicyGate onSignOut={vi.fn()}><p>Store dashboard</p></PolicyGate>)
    expect(await screen.findByText('Store dashboard')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Privacy Policy notice' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Account deletion scheduled' }).textContent).toMatch(/scheduled to be deleted/)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel deletion' }))
    await waitFor(() => expect(cancel).toHaveBeenCalled())
  })
})

describe('privacy actions', () => {
  it('downloads the export as a file', async () => {
    vi.spyOn(privacyApi, 'exportData').mockResolvedValue({ account: { email: 'a@example.com' } })
    const createObjectURL = vi.fn(() => 'blob:export')
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    render(<DataExportCard />)
    fireEvent.click(screen.getByRole('button', { name: 'Download my data' }))
    expect(await screen.findByRole('status')).toBeTruthy()
    expect(createObjectURL).toHaveBeenCalled()
    expect(click).toHaveBeenCalled()
  })

  it('needs the password and the typed word DELETE before it schedules anything', async () => {
    const request = vi.spyOn(privacyApi, 'requestDeletion').mockResolvedValue({ message: 'ok', deletion: { requestedAt: null, scheduledFor: '2026-02-15T00:00:00Z' } })
    const changed = vi.fn()
    render(<DeletionCard deletion={null} canDelete onChanged={changed} />)
    expect(screen.getByText(/Nothing is deleted right away/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close my account…' }))

    const submit = screen.getByRole('button', { name: 'Schedule deletion' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'Passw0rdTest' } })
    fireEvent.change(screen.getByLabelText(/Type DELETE to confirm/), { target: { value: 'delete' } })
    expect(submit.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(/Type DELETE to confirm/), { target: { value: 'DELETE' } })
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)
    await waitFor(() => expect(request).toHaveBeenCalledWith('Passw0rdTest', 'DELETE'))
    expect(changed).toHaveBeenCalled()
  })

  it('shows the wrong-password message and does not claim success', async () => {
    const { ApiError } = await import('../../services/apiClient')
    vi.spyOn(privacyApi, 'requestDeletion').mockRejectedValue(new ApiError('Your password is incorrect.', 400))
    render(<DeletionCard deletion={null} canDelete onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close my account…' }))
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'nope' } })
    fireEvent.change(screen.getByLabelText(/Type DELETE to confirm/), { target: { value: 'DELETE' } })
    fireEvent.click(screen.getByRole('button', { name: 'Schedule deletion' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Your password is incorrect.')
  })

  it('does not offer deletion to administrator accounts', () => {
    render(<DeletionCard deletion={null} canDelete={false} onChanged={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Close my account…' })).toBeNull()
  })
})
