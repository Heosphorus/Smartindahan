import { API_BASE_URL } from './apiBase'
import { handleAuthenticatedUnauthorized } from './apiSession'

export const TOKEN_STORAGE_KEY = 'sarismart_token'

export class ApiError extends Error {
  status: number
  data: unknown

  constructor(message: string, status: number, data?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data
  }
}

type ApiRequestOptions = {
  method?: string
  body?: unknown
  /** Omit to use the stored session token; pass `null` to send the request without authentication. */
  token?: string | null
  fallbackMessage?: string
}

/**
 * Single entry point for talking to the backend, so every screen reports network failures,
 * HTML (misrouted) responses and API errors the same way.
 */
export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const token = options.token === undefined ? localStorage.getItem(TOKEN_STORAGE_KEY) : options.token
  const hasBody = options.body !== undefined
  const method = options.method ?? (hasBody ? 'POST' : 'GET')

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
    })
  } catch {
    throw new ApiError('Cannot reach the server. Check your internet connection and try again.', 0)
  }

  handleAuthenticatedUnauthorized(response.status, Boolean(token))

  const isJson = (response.headers.get('content-type') ?? '').includes('application/json')
  if (!isJson) {
    throw new ApiError(
      response.ok
        ? 'The server sent an unexpected response. Please try again, or contact support if this keeps happening.'
        : `The server could not process the request (error ${response.status}). Please try again.`,
      response.status,
    )
  }

  const data = await response.json().catch(() => null) as (T & { message?: string }) | null
  if (!response.ok) {
    throw new ApiError(data?.message ?? options.fallbackMessage ?? 'Something went wrong. Please try again.', response.status, data)
  }
  return data as T
}
