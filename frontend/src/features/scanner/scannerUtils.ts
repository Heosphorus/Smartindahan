import type { BarcodeFormat, ScannerResult } from './scannerTypes'

const normalizeBarcode = (value: string) => value.trim().replace(/\s+/g, '')

export const parseDetectedBarcode = (value: string, format?: string): ScannerResult => {
  const normalized = normalizeBarcode(value)

  const inferredFormat = (format ?? 'CODE_128') as BarcodeFormat

  return {
    rawValue: normalized,
    format: inferredFormat,
    isRegistered: false,
    status: 'ready',
  }
}

export const shouldIgnoreDuplicateScan = (
  lastValue: string,
  currentValue: string,
  cooldownMs: number,
  lastTimestamp: number,
  now: number,
) => {
  if (!lastValue || !currentValue) return false
  if (lastValue !== currentValue) return false
  return now - lastTimestamp < cooldownMs
}

export const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
  }).format(value)

export const createMockProductLookup = (barcode: string) => {
  const catalog = [
    { barcode: '4800012345678', name: 'Coca-Cola 1.5L', productId: 'prod-1' },
    { barcode: '4800098765432', name: 'Lucky Me Pancit Canton', productId: 'prod-2' },
    { barcode: '4800055512345', name: 'Kopiko Brown', productId: 'prod-3' },
  ]

  return catalog.find((item) => item.barcode === barcode)
}
