import { useEffect, useRef, useState } from 'react'
import type { IScannerControls } from '@zxing/browser'
import { useEscapeKey } from '../../hooks/useEscapeKey'

export function BarcodeCameraScanner({ onDetected, onClose }: { onDetected: (barcode: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const detectedRef = useRef(false)
  const [error, setError] = useState('')
  useEscapeKey(true, onClose)

  useEffect(() => {
    let cancelled = false
    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Camera access is unavailable. Use HTTPS or enter the barcode manually.')
        return
      }
      try {
        const { BarcodeFormat, BrowserMultiFormatReader } = await import('@zxing/browser')
        if (cancelled) return
        const reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 180, delayBetweenScanSuccess: 400 })
        reader.possibleFormats = [
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
          BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39,
          BarcodeFormat.ITF,
          BarcodeFormat.CODABAR,
        ]
        const controls = await reader.decodeFromConstraints({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        }, videoRef.current ?? undefined, (result) => {
          if (!result || detectedRef.current) return
          detectedRef.current = true
          onDetected(result.getText())
        })
        if (cancelled) controls.stop()
        else controlsRef.current = controls
      } catch (scanError) {
        if (!cancelled) setError(scanError instanceof Error ? scanError.message : 'Unable to start the camera. Check camera permission and try again.')
      }
    }
    void start()
    return () => {
      cancelled = true
      controlsRef.current?.stop()
      controlsRef.current = null
    }
  }, [onDetected])

  return <div className="pos-camera-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="pos-camera-dialog" role="dialog" aria-modal="true" aria-labelledby="pos-camera-title">
      <header className="pos-camera-heading"><div><h3 id="pos-camera-title">Scan product barcode</h3><p>Hold the barcode inside the camera view.</p></div><button type="button" onClick={onClose} aria-label="Close camera scanner">×</button></header>
      <div className="pos-camera-view"><video ref={videoRef} muted playsInline aria-label="Live camera barcode view" /><span aria-hidden="true" /></div>
      {error ? <p className="pos-camera-error" role="alert">{error}</p> : <p className="pos-camera-hint" role="status">Camera is on. Scanning stays on this device.</p>}
      <button type="button" className="pos-camera-close" onClick={onClose}>Close scanner</button>
    </section>
  </div>
}
