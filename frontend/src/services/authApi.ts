const API_URL = import.meta.env.VITE_API_URL ?? '/api'

type ApiResponse = {
  message?: string
  token?: string
  user?: { id?: string; email?: string; maskedEmail?: string; status?: string }
  maskedEmail?: string
  userId?: string
  remainingAttempts?: number
  users?: Array<{
    _id: string
    email: string
    maskedEmail?: string
    status: string
    createdAt: string
    storeName?: string
  }>
  stats?: {
    totalUsers: number
    activeUsers: number
    pendingUsers: number
  }
}

async function request(path: string, body?: unknown, token?: string): Promise<ApiResponse> {
  const response = await fetch(`${API_URL}/auth${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    throw new Error(`The authentication API returned an unexpected response from ${response.url}. Restart the backend and reload the frontend.`)
  }

  const data = await response.json() as ApiResponse
  if (!response.ok) {
    throw new Error(data.message ?? 'Something went wrong. Please try again.')
  }
  return data
}

export const authApi = {
  register: (payload: Record<string, string>) => request('/register', payload),
  verifyEmail: (userId: string, otp: string) => request('/verify-email', { userId, otp }),
  resendOtp: (userId: string) => request('/resend-otp', { userId }),
  login: (email: string, password: string) => request('/login', { email, password }),
  forgotPassword: (email: string) => request('/forgot-password', { email }),
  verifyResetOtp: (userId: string, otp: string) => request('/verify-reset-otp', { userId, otp }),
  resetPassword: (userId: string, password: string, confirmPassword: string) => request('/reset-password', { userId, password, confirmPassword }),
  changePassword: (token: string, currentPassword: string, newPassword: string, confirmPassword: string) => request('/change-password', { currentPassword, newPassword, confirmPassword }, token),
  logout: (token: string) => request('/logout', undefined, token),
  // Admin endpoints
  adminGetUsers: (token: string) => request('/admin/users', undefined, token),
  adminGetStats: (token: string) => request('/admin/stats', undefined, token),
  adminChangeUserPassword: (token: string, userId: string, newPassword: string) => request('/admin/users/password', { userId, newPassword }, token),
  adminChangeUserEmail: (token: string, userId: string, newEmail: string) => request('/admin/users/email', { userId, newEmail }, token),
  adminImpersonateUser: (token: string, userId: string) => request('/admin/users/impersonate', { userId }, token),
}
