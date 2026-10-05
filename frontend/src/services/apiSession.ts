export function handleAuthenticatedUnauthorized(status: number, sentToken: boolean): void {
  if (status !== 401 || !sentToken) return
  localStorage.removeItem('sarismart_token')
  window.dispatchEvent(new Event('sarismart:session-expired'))
}