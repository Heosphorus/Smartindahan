import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '../../services/apiClient'
import { authApi } from '../../services/authApi'
import { AuthPage } from './AuthPage'

describe('AuthPage login', () => {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => { cleanup() })

  function fillLogin(email = 'owner@example.com', password = 'Passw0rdTest') {
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: email } })
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: password } })
  }

  const submitButton = () => screen.getByRole('button', { name: /^(sign in|log in|login)$/i })

  it('shows the API error and keeps what the user typed', async () => {
    vi.spyOn(authApi, 'login').mockRejectedValue(new ApiError('Invalid email or password.', 401))
    render(<AuthPage onAuthenticated={vi.fn()} />)
    fillLogin()
    fireEvent.click(submitButton())

    expect(await screen.findByText('Invalid email or password.')).toBeTruthy()
    expect((screen.getByLabelText(/email/i) as HTMLInputElement).value).toBe('owner@example.com')
    expect((screen.getByLabelText(/^password/i) as HTMLInputElement).value).toBe('Passw0rdTest')
  })

  it('stores the session token on success', async () => {
    vi.spyOn(authApi, 'login').mockResolvedValue({ token: 'jwt-token' })
    const onAuthenticated = vi.fn()
    render(<AuthPage onAuthenticated={onAuthenticated} />)
    fillLogin()
    fireEvent.click(submitButton())

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith('jwt-token'))
    expect(localStorage.getItem('sarismart_token')).toBe('jwt-token')
  })

  it('sends an unverified owner to the verification screen instead of a dead end', async () => {
    vi.spyOn(authApi, 'login').mockRejectedValue(new ApiError('Please verify your email before logging in.', 403, { status: 'EMAIL_VERIFICATION_REQUIRED', userId: 'u1', maskedEmail: 'o***@example.com' }))
    render(<AuthPage onAuthenticated={vi.fn()} />)
    fillLogin()
    fireEvent.click(submitButton())

    expect(await screen.findByText(/Your email is not verified yet/)).toBeTruthy()
  })
})
