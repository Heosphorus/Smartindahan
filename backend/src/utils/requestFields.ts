export function pickRequestFields(fields: readonly string[], input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}

  const body = input as Record<string, unknown>
  return Object.fromEntries(fields
    .filter((field) => Object.prototype.hasOwnProperty.call(body, field))
    .map((field) => [field, body[field]]))
}