import { apiRequest } from './apiClient'

export type PolicyType = 'terms' | 'privacy'
export type ConsentType = 'TERMS_OF_SERVICE' | 'PRIVACY_NOTICE'

export type PolicySection = { id: string; heading: string; paragraphs: string[]; bullets?: string[] }
export type PolicySummary = {
  policyType: PolicyType
  version: string
  title: string
  summary: string
  changeSummary: string
  isDraft: boolean
  publishedAt: string
  effectiveAt: string
  requiresReacceptance: boolean
  isCurrent: boolean
}
export type PolicyDocument = PolicySummary & { sections: PolicySection[] }

export type PendingReview = {
  policyType: PolicyType
  consentType: ConsentType
  version: string
  title: string
  isDraft: boolean
  blocking: boolean
  acceptedVersion: string | null
  changes: Array<{ version: string; changeSummary: string }>
}
export type DeletionState = { requestedAt: string | null; scheduledFor: string } | null
export type PrivacyStatus = { pending: PendingReview[]; blocking: boolean; deletion: DeletionState }

export type ConsentEntry = { _id: string; consentType: ConsentType; policyVersion: string; accepted: boolean; acceptedAt: string; source: string }
export type PrivacyOverview = {
  account: { firstName: string; lastName: string; email: string; mobileNumber: string; storeName: string; storeAddress: string }
  consents: ConsentEntry[]
  currentPolicies: Array<{ policyType: PolicyType; version: string; title: string; isDraft: boolean; effectiveAt: string }>
  deletion: DeletionState
  canDeleteAccount: boolean
}

export const privacyRequestTypes = [
  { value: 'ACCESS', label: 'Ask what information you hold about me' },
  { value: 'CORRECTION', label: 'Correct information about me' },
  { value: 'DELETION', label: 'Delete information about me' },
  { value: 'WITHDRAW_CONSENT', label: 'Withdraw a consent' },
  { value: 'QUESTION', label: 'Ask a question about my data' },
  { value: 'COMPLAINT', label: 'Make a privacy complaint' },
] as const
export type PrivacyRequestType = (typeof privacyRequestTypes)[number]['value']
export type PrivacyRequest = { _id: string; type: PrivacyRequestType; message: string; status: 'RECEIVED' | 'IN_PROGRESS' | 'COMPLETED' | 'DECLINED'; resolutionNote?: string; createdAt: string }

export const legalApi = {
  // Public: the policies must be readable before anyone registers, so these never send a session token.
  current: () => apiRequest<{ policies: PolicySummary[] }>('/legal/policies', { token: null }),
  policy: (type: PolicyType, version?: string) =>
    apiRequest<{ policy: PolicyDocument; versions: PolicySummary[] }>(`/legal/policies/${type}${version ? `?version=${encodeURIComponent(version)}` : ''}`, { token: null }),
}

export const privacyApi = {
  status: () => apiRequest<PrivacyStatus>('/privacy/status'),
  overview: () => apiRequest<PrivacyOverview>('/privacy/overview'),
  accept: (consentType: ConsentType, policyVersion: string, source: 'REVIEW_PROMPT' | 'SETTINGS' = 'REVIEW_PROMPT') =>
    apiRequest<{ message: string; pending: PendingReview[] }>('/privacy/consents', { body: { consentType, policyVersion, source } }),
  exportData: () => apiRequest<Record<string, unknown>>('/privacy/export'),
  requests: () => apiRequest<{ requests: PrivacyRequest[] }>('/privacy/requests'),
  submitRequest: (type: PrivacyRequestType, message: string) => apiRequest<{ message: string }>('/privacy/requests', { body: { type, message } }),
  requestDeletion: (password: string, confirmation: string) =>
    apiRequest<{ message: string; deletion: DeletionState }>('/privacy/deletion', { body: { password, confirmation } }),
  cancelDeletion: () => apiRequest<{ message: string }>('/privacy/deletion', { method: 'DELETE' }),
}
