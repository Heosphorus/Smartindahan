/**
 * True when a connection string is still the template from .env.example: it names the placeholder user or a <bracketed> value,
 * or points at example.com. The host is read out of the string and compared whole, so "example.com.evil.net" or a password
 * containing "example.com" are not mistaken for it (and a real host never merely contains the text).
 */
export function isPlaceholderMongoUri(uri: string): boolean {
  if (uri.includes('DATABASE_USER') || uri.includes('<')) return true
  const withoutScheme = uri.replace(/^[a-z+]+:\/\//i, '')
  const authority = withoutScheme.split(/[/?]/, 1)[0] ?? ''
  const hosts = authority.slice(authority.lastIndexOf('@') + 1).split(',')
  return hosts.some((entry) => {
    const host = entry.replace(/:\d+$/, '').toLowerCase()
    return host === 'example.com' || host.endsWith('.example.com')
  })
}
