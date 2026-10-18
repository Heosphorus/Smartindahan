import { useEffect } from 'react'

const TEXTUAL_INPUT_TYPES = new Set(['text', 'email', 'password', 'search', 'tel', 'url'])
const MAX_INPUT_LENGTH = 64

function applyLengthLimit(root: ParentNode): void {
  const fields = Array.from(root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'))
  if (root instanceof HTMLInputElement || root instanceof HTMLTextAreaElement) fields.push(root)
  fields.forEach((field) => {
    if (field instanceof HTMLTextAreaElement || TEXTUAL_INPUT_TYPES.has(field.type)) {
      field.maxLength = MAX_INPUT_LENGTH
    }
  })
}

export default function InputLengthLimit() {
  useEffect(() => {
    applyLengthLimit(document)
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement) applyLengthLimit(node)
        })
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  return null
}
