import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '../../services/apiClient'
import { authApi } from '../../services/authApi'
import { legalApi, type PolicySummary } from '../../services/legalApi'
import { AuthPage } from './AuthPage'

const policy = (policyType: 'terms' | 'privacy'): PolicySummary => ({
  policyType, version: '1.0-draft', title: policyType === 'terms' ? 'Terms of Service' : 'Privacy Policy', summary: 's', changeSummary: 'c',
  isDraft: true, publishedAt: '2026-01-01T00:00:00Z', effectiveAt: '2026-01-01T00:00:00Z', requiresReacceptance: true, isCurrent: true,
})

async function openRegistration() {
  render(<AuthPage onAuthenticated={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Create one' }))
  await waitFor(() => expect(legalApi.current).toHaveBeenCalled())
  return screen.getByRole('checkbox', { name: /I have read and agree to the Terms of Service/ }) as HTMLInputElement
}

function fillRegistration() {
  const fields: Array<[RegExp | string, string]> = [['First name', 'Ana'], ['Last name', 'Cruz'], ['Email address', 'ana@example.com'], ['Mobile number', '09171234567'], ['Store name', 'Ana Store'], ['Store address', 'Quezon City']]
  for (const [label, value] of fields) fireEvent.change(screen.getByLabelText(label), { target: { value } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Passw0rdTest' } })
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'Passw0rdTest' } })
}

describe('registration agreement', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.spyOn(legalApi, 'current').mockResolvedValue({ policies: [policy('terms'), policy('privacy')] })
  })
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('starts unchecked and is never checked for the user', async () => {
    const box = await openRegistration()
    expect(box.checked).toBe(false)
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
    expect(screen.queryByText(/marketing/i, { selector: 'label *' })).toBeNull()
  })

  it('links to both policies in a new tab so the form data is not lost, and the links are keyboard reachable', async () => {
    await openRegistration()
    const terms = screen.getAllByRole('link', { name: /Terms of Service/ }).find((link) => link.getAttribute('href')?.includes('version='))
    const privacy = screen.getAllByRole('link', { name: /Privacy Policy/ }).find((link) => link.getAttribute('href')?.includes('version='))
    expect(terms?.getAttribute('href')).toMatch(/\/terms\?version=1\.0-draft$/)
    expect(privacy?.getAttribute('href')).toMatch(/\/privacy\?version=1\.0-draft$/)
    for (const link of [terms!, privacy!]) {
      expect(link.getAttribute('target')).toBe('_blank')
      expect(link.getAttribute('rel')).toContain('noopener')
      link.focus()
      expect(document.activeElement).toBe(link)
    }
  })

  it('explains the problem and does not submit when the box is not ticked', async () => {
    const register = vi.spyOn(authApi, 'register')
    const box = await openRegistration()
    fillRegistration()
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    const alert = await screen.findByText(/Please tick the box to confirm you have read and agree/)
    expect(alert.getAttribute('role')).toBe('alert')
    expect(register).not.toHaveBeenCalled()
    expect(box.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(box)
    expect((screen.getByLabelText('Email address') as HTMLInputElement).value).toBe('ana@example.com')
  })

  it('sends the agreement and the exact policy versions that were shown', async () => {
    const register = vi.spyOn(authApi, 'register').mockResolvedValue({ user: { id: 'u1', maskedEmail: 'a***@example.com' } })
    const box = await openRegistration()
    fillRegistration()
    fireEvent.click(box)
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => expect(register).toHaveBeenCalledTimes(1))
    expect(register.mock.calls[0]![0]).toMatchObject({ termsAccepted: true, privacyPolicyAccepted: true, termsVersion: '1.0-draft', privacyVersion: '1.0-draft', email: 'ana@example.com' })
    expect(await screen.findByText('Verify your email')).toBeTruthy()
  })

  it('asks again when the policies changed while the form was open', async () => {
    vi.spyOn(authApi, 'register').mockRejectedValue(new ApiError('The Terms of Service or Privacy Policy were updated.', 409, { code: 'POLICY_VERSION_MISMATCH' }))
    const box = await openRegistration()
    fillRegistration()
    fireEvent.click(box)
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByText(/were updated/)).toBeTruthy()
    await waitFor(() => expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false))
    expect(vi.mocked(legalApi.current).mock.calls.length).toBeGreaterThan(1)
  })

  it('does not let anyone register when the policies cannot be loaded', async () => {
    vi.mocked(legalApi.current).mockRejectedValue(new Error('offline'))
    const register = vi.spyOn(authApi, 'register')
    const box = await openRegistration()
    expect(await screen.findByText(/could not load the current policies/i)).toBeTruthy()
    fillRegistration()
    fireEvent.click(box)
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByText(/could not be loaded/i)).toBeTruthy()
    expect(register).not.toHaveBeenCalled()
  })
})
