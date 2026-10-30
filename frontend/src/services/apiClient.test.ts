import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, apiRequest, TOKEN_STORAGE_KEY } from './apiClient'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('apiRequest', () => {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('sends the stored session token and a JSON body', async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, 'abc')
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await apiRequest('/store/products', { body: { name: 'Soap' } })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/store/products')
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ name: 'Soap' }))
    expect(init.headers).toMatchObject({ Authorization: 'Bearer abc', 'Content-Type': 'application/json' })
  })

  it('does not attach a stale token to public requests', async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, 'stale')
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)

    await apiRequest('/auth/login', { body: { email: 'a@b.c' }, token: null })

    const init = fetchMock.mock.calls[0]![1] as RequestInit
    expect(init.headers).not.toHaveProperty('Authorization')
  })

  it('turns a network failure into a readable error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(apiRequest('/store/products')).rejects.toMatchObject({ status: 0, message: expect.stringContaining('Cannot reach the server') })
  })

  it('explains an HTML response instead of crashing on JSON.parse', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<!doctype html>', { status: 200, headers: { 'Content-Type': 'text/html' } })))
    const error = await apiRequest('/store/products').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).message).toMatch(/unexpected response/)
  })

  it('surfaces the server message and keeps the payload for callers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ message: 'Please verify your email.', userId: 'u1' }, 403)))
    const error = await apiRequest('/auth/login', { body: {}, token: null }).catch((caught: unknown) => caught) as ApiError
    expect(error.message).toBe('Please verify your email.')
    expect(error.status).toBe(403)
    expect(error.data).toMatchObject({ userId: 'u1' })
  })

  it('ends the session when an authenticated request is rejected with 401', async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, 'expired')
    const expired = vi.fn()
    window.addEventListener('sarismart:session-expired', expired)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ message: 'Session expired or invalid token.' }, 401)))

    await expect(apiRequest('/store/dashboard')).rejects.toMatchObject({ status: 401 })

    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull()
    expect(expired).toHaveBeenCalledTimes(1)
    window.removeEventListener('sarismart:session-expired', expired)
  })
})
