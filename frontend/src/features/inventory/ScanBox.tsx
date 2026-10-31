import { useCallback, useEffect, useId, useRef, useState } from 'react'

import { BarcodeCameraScanner } from '../pos/BarcodeCameraScanner'
import { looksLikeBarcode } from './inventoryMath'
import './Inventory.css'

type Props = {
  label: string
  value: string
  onChange: (value: string) => void
  /** A barcode: typed or pasted then Enter (a USB scanner does exactly this), or read by the camera. */
  onScan: (code: string) => void
  /** Enter on text that does not look like a barcode (for example to pick the only search result). */
  onSubmitText?: (text: string) => void
  placeholder?: string
  autoFocus?: boolean
  /** Keep the camera open after each read, for counting item by item. */
  continuous?: boolean
  hint?: string
}

/**
 * One box for finding a product: type to search, type or scan a barcode, or use the camera. Keyboard scanners and manual
 * entry both end with Enter; the camera and the manual fallback are always one tap away.
 */
export function ScanBox({ label, value, onChange, onScan, onSubmitText, placeholder, autoFocus, continuous = false, hint }: Props) {
  const id = useId()
  const [cameraOpen, setCameraOpen] = useState(false)
  const onScanRef = useRef(onScan)
  useEffect(() => { onScanRef.current = onScan })

  // The camera restarts whenever this callback changes, so it must stay the same function between renders.
  const handleDetected = useCallback((code: string) => {
    if (!continuous) setCameraOpen(false)
    onScanRef.current(code)
  }, [continuous])
  const closeCamera = useCallback(() => setCameraOpen(false), [])

  const submit = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    const text = value.trim()
    if (!text) return
    if (looksLikeBarcode(text)) onScan(text)
    else onSubmitText?.(text)
  }

  return <div className="inv-scan">
    <label className="inv-scan-label" htmlFor={id}>{label}</label>
    <div className="inv-scan-row">
      <input id={id} type="search" inputMode="search" autoComplete="off" autoCapitalize="off" spellCheck={false} maxLength={64} autoFocus={autoFocus} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} onKeyDown={submit} />
      <button type="button" className="price-secondary inv-scan-camera" onClick={() => setCameraOpen(true)} aria-label="Scan a barcode with the camera">Scan</button>
    </div>
    {hint && <p className="inv-hint">{hint}</p>}
    {cameraOpen && <BarcodeCameraScanner continuous={continuous} onDetected={handleDetected} onClose={closeCamera} />}
  </div>
}
