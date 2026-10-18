import { useEffect, useRef, useState } from 'react'
import type { IScannerControls } from '@zxing/browser'
import { useEscapeKey } from '../../hooks/useEscapeKey'

type NativeBarcode = { rawValue: string }
type NativeDetector = { detect: (source: HTMLVideoElement) => Promise<NativeBarcode[]> }
type NativeDetectorConstructor = {
  new (options?: { formats?: string[] }): NativeDetector
  getSupportedFormats?: () => Promise<string[]>
}

const RETAIL_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'codabar']

function cameraErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'Camera permission is blocked. Allow camera access in your browser, then try again.'
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') return 'No camera was found. Connect a camera or enter the barcode manually.'
    if (error.name === 'NotReadableError' || error.name === 'TrackStartError') return 'The camera is busy in another app. Close that app and try again.'
  }
  return error instanceof Error ? error.message : 'Unable to start barcode scanning. Enter the barcode manually instead.'
}

export function BarcodeCameraScanner({ onDetected, onClose }: { onDetected: (barcode: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const detectedRef = useRef(false)
  const [error, setError] = useState('')
  const [scanStatus, setScanStatus] = useState('Requesting camera access…')
  useEscapeKey(true, onClose)

  useEffect(() => {
    let cancelled = false
    let nativeTimer: number | undefined
    let fallbackTimer: number | undefined

    const startZxing = async (stream: MediaStream) => {
      if (cancelled || detectedRef.current) return
      if (nativeTimer !== undefined) window.clearTimeout(nativeTimer)
      setScanStatus('Starting barcode reader…')
      try {
        const { BarcodeFormat, BrowserMultiFormatReader } = await import('@zxing/browser')
        const { DecodeHintType } = await import('@zxing/library')
        if (cancelled || detectedRef.current) return
        const hints = new Map([[DecodeHintType.TRY_HARDER, true]])
        const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 250, delayBetweenScanSuccess: 400 })
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
        const controls = await reader.decodeFromStream(stream, videoRef.current ?? undefined, (result) => {
          if (!result || detectedRef.current) return
          detectedRef.current = true
          setScanStatus('Barcode detected. Looking it up…')
          onDetected(result.getText())
        })
        if (cancelled || detectedRef.current) controls.stop()
        else {
          controlsRef.current = controls
          setScanStatus('Scanner ready. Center the barcode and hold it still.')
        }
      } catch (scanError) {
        if (!cancelled && !detectedRef.current) setError(cameraErrorMessage(scanError))
      }
    }

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Camera access requires HTTPS or localhost. You can still enter the barcode manually.')
        return
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        const video = videoRef.current
        if (!video) throw new Error('Camera preview could not be initialized. Close the scanner and try again.')
        video.srcObject = stream
        await video.play()
        if (cancelled) return

        const detectorConstructor = (window as Window & { BarcodeDetector?: NativeDetectorConstructor }).BarcodeDetector
        if (detectorConstructor) {
          try {
            const supported = await detectorConstructor.getSupportedFormats?.()
            const formats = supported?.filter((format) => RETAIL_FORMATS.includes(format)) ?? []
            if (formats.length) {
              const detector = new detectorConstructor({ formats })
              setScanStatus('Looking for a product barcode…')
              const detectFrame = async () => {
                if (cancelled || detectedRef.current) return
                try {
                  const results = await detector.detect(video)
                  const rawValue = results.find((result) => result.rawValue.trim())?.rawValue.trim()
                  if (rawValue) {
                    detectedRef.current = true
                    setScanStatus('Barcode detected. Looking it up…')
                    onDetected(rawValue)
                    return
                  }
                } catch {
                  // Fall through to ZXing if the browser detector cannot process this frame.
                  if (nativeTimer !== undefined) window.clearTimeout(nativeTimer)
                  void startZxing(stream)
                  return
                }
                nativeTimer = window.setTimeout(() => void detectFrame(), 120)
              }
              void detectFrame()
              fallbackTimer = window.setTimeout(() => {
                if (!cancelled && !detectedRef.current) {
                  setScanStatus('Trying compatibility scanner…')
                  void startZxing(stream)
                }
              }, 2500)
              return
            }
          } catch {
            // Native support probing can fail in some browsers; ZXing remains available.
          }
        }
        await startZxing(stream)
      } catch (cameraError) {
        if (!cancelled) setError(cameraErrorMessage(cameraError))
      }
    }

    void start()
    return () => {
      cancelled = true
      if (nativeTimer !== undefined) window.clearTimeout(nativeTimer)
      if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer)
      controlsRef.current?.stop()
      controlsRef.current = null
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [onDetected])

  return <div className="pos-camera-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="pos-camera-dialog" role="dialog" aria-modal="true" aria-labelledby="pos-camera-title">
      <header className="pos-camera-heading"><div><h3 id="pos-camera-title">Scan product barcode</h3><p>Center the bars in the guide. Move closer, hold still, and use good lighting.</p></div><button type="button" onClick={onClose} aria-label="Close camera scanner">×</button></header>
      <div className="pos-camera-view"><video ref={videoRef} muted playsInline aria-label="Live camera barcode view" /><span aria-hidden="true" /></div>
      {error ? <p className="pos-camera-error" role="alert">{error}</p> : <p className="pos-camera-hint" role="status">{scanStatus}</p>}
      <button type="button" className="pos-camera-close" onClick={onClose}>Close scanner</button>
    </section>
  </div>
}
