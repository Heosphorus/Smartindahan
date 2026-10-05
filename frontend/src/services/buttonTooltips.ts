function getButtonDescription(button: HTMLButtonElement): string {
  const accessibleLabel = button.getAttribute('aria-label')?.trim()
  const visibleLabel = (button.innerText || button.textContent || '').replace(/\s+/g, ' ').trim()
  const label = accessibleLabel || visibleLabel
  if (!label) return 'Button action'

  const normalizedLabel = label.toLowerCase()
  const formDialog = button.closest('[role="dialog"]')
  if (/^(close|close form|close policy)$/i.test(label)) {
    return formDialog ? 'Close this popup. Any unsaved form entries will be kept.' : `Close ${label.replace(/^close\s*/i, '').toLowerCase() || 'dialog'}.`
  }

  if (/^(cancel|cancel password change|hide password form)$/i.test(label)) {
    return formDialog ? 'Hide this popup without clearing the form entries.' : 'Cancel this action and return to the previous view.'
  }

  if (/^(edit|delete)$/i.test(label)) {
    const context = button.closest('.customer-card, .admin-user-card, .price-row')?.querySelector('h3, strong')?.textContent?.trim()
    if (context && normalizedLabel === 'edit') return `Edit ${context}.`
    if (context && normalizedLabel === 'delete') return `Archive ${context} from the active list.`
  }

  if (/^(save|save settings|save changes|update settings)$/i.test(label)) return 'Save your updated settings.'
  if (/^(add customer|add supplier|add expense|add product|bulk add)$/i.test(label)) {
    return `Open the ${normalizedLabel.replace(/^add /, '').replace('bulk add', 'bulk product entry')} form.`
  }
  if (/^(delete customer|delete supplier|delete expense|delete product)$/i.test(label)) return `Archive this ${normalizedLabel.replace('delete ', '')} from the active list.`
  if (/^(change password|update password)$/i.test(label)) return 'Submit the password change.'
  if (/^(change email)$/i.test(label)) return 'Submit the email address change.'
  if (/^(access account)$/i.test(label)) return 'Open a short-lived session for this account.'
  if (/^(complete checkout)$/i.test(label)) return 'Complete the sale and record the inventory changes.'
  if (/^(search product|scan product|scan)$/i.test(label)) return 'Look up a product using its barcode.'
  if (/^(use camera)$/i.test(label)) return 'Start scanning with the device camera.'
  if (/^(view products)$/i.test(label)) return 'Show the products available for sale.'
  if (/^(review adjustments)$/i.test(label)) return 'Review the inventory count differences before applying them.'
  if (/^(confirm stock-in)$/i.test(label)) return 'Add the entered quantities to inventory.'
  if (/^(confirm stock-out)$/i.test(label)) return 'Remove the entered quantity from inventory.'
  if (/^(send verification code)$/i.test(label)) return 'Send a verification code to your email address.'
  if (/^(verify email)$/i.test(label)) return 'Verify your email using the code you entered.'
  if (/^(resend code)( in \d+s)?$/i.test(label)) return label.includes(' in ') ? 'Wait until the countdown ends before requesting another code.' : 'Send a new verification code.'

  return label.replace(/^\+\s*/, '')
}

export function installButtonTooltips(root: ParentNode): () => void {
  const applyTooltip = (button: HTMLButtonElement) => {
    const description = getButtonDescription(button)
    if (!button.dataset.autoTooltip && button.hasAttribute('title')) return
    button.title = description
    button.dataset.autoTooltip = 'true'
  }

  const scan = (node: ParentNode) => {
    if (node instanceof HTMLButtonElement) applyTooltip(node)
    node.querySelectorAll?.('button').forEach((button) => applyTooltip(button))
  }

  scan(root)
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach((node) => {
        if (node instanceof HTMLElement) scan(node)
      })
      if (record.target instanceof HTMLButtonElement && record.type === 'childList') {
        applyTooltip(record.target)
      }
      if (record.type === 'characterData' && record.target.parentElement?.closest('button') instanceof HTMLButtonElement) {
        applyTooltip(record.target.parentElement.closest('button') as HTMLButtonElement)
      }
    }
  })
  observer.observe(root, { childList: true, characterData: true, subtree: true })
  return () => observer.disconnect()
}
