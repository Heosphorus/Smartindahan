import { apiRequest } from './apiClient'

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

function request(path: string, body?: unknown, token?: string, method?: string): Promise<ApiResponse> {
  return apiRequest<ApiResponse>(`/auth${path}`, {
    ...(body !== undefined ? { body } : {}),
    ...(method ? { method } : {}),
    // Public endpoints (login, register, reset...) must never carry a stale session token.
    token: token ?? null,
  })
}

export const authApi = {
  register: (payload: Record<string, string | boolean>) => request('/register', payload),
  verifyEmail: (userId: string, otp: string) => request('/verify-email', { userId, otp }),
  resendOtp: (userId: string) => request('/resend-otp', { userId }),
  login: (email: string, password: string) => request('/login', { email, password }),
  forgotPassword: (email: string) => request('/forgot-password', { email }),
  verifyResetOtp: (userId: string, otp: string) => request('/verify-reset-otp', { userId, otp }),
  resetPassword: (userId: string, password: string, confirmPassword: string) => request('/reset-password', { userId, password, confirmPassword }),
  changePassword: (token: string, currentPassword: string, newPassword: string, confirmPassword: string) => request('/change-password', { currentPassword, newPassword, confirmPassword }, token),
  logout: (token: string) => request('/logout', {}, token),
  // Admin endpoints
  adminGetUsers: (token: string) => request('/admin/users', undefined, token),
  adminGetStats: (token: string) => request('/admin/stats', undefined, token),
  adminChangeUserPassword: (token: string, userId: string, newPassword: string) => request('/admin/users/password', { userId, newPassword }, token),
  adminChangeUserEmail: (token: string, userId: string, newEmail: string) => request('/admin/users/email', { userId, newEmail }, token),
  adminImpersonateUser: (token: string, userId: string) => request('/admin/users/impersonate', { userId }, token),
}
