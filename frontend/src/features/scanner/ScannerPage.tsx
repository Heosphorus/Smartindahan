import { useEffect, useRef, useState } from 'react'
import { demoProducts } from '../../data/demoProducts'
import { createMockProductLookup, formatCurrency, parseDetectedBarcode, shouldIgnoreDuplicateScan } from './scannerUtils'
import type { ScanAction } from './scannerTypes'

const SCAN_COOLDOWN_MS = 1200

export function ScannerPage() {
  const [action, setAction] = useState<ScanAction>('sale')
  const [barcodeInput, setBarcodeInput] = useState('')
  const [lastScanned, setLastScanned] = useState('Coca-Cola 1.5L')
  const [detectedProduct, setDetectedProduct] = useState<typeof demoProducts[number] | null>(demoProducts[0])
  const [cameraStatus, setCameraStatus] = useState('Ready')
  const [permissionError, setPermissionError] = useState('')
  const [manualSearch, setManualSearch] = useState('')

  const lastScanRef = useRef({ value: '', time: 0 })
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    let cancelled = false

    const startCamera = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraStatus('Camera not supported in this browser')
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
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
        setCameraStatus('Camera active')
        setPermissionError('')
      } catch (error) {
        if (!cancelled) {
          setCameraStatus('Camera blocked')
          setPermissionError('Camera permission was denied. You can still enter a barcode manually.')
        }
      }
    }

    startCamera()

    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  const handleScan = (rawValue: string) => {
    const now = Date.now()
    const normalized = rawValue.trim()

    if (shouldIgnoreDuplicateScan(lastScanRef.current.value, normalized, SCAN_COOLDOWN_MS, lastScanRef.current.time, now)) {
      return
    }

    lastScanRef.current = { value: normalized, time: now }

    const result = parseDetectedBarcode(normalized, 'CODE_128')
    const matched = createMockProductLookup(result.rawValue)

    if (matched) {
      const product = demoProducts.find((item) => item.id === matched.productId) ?? null
      setDetectedProduct(product)
      setLastScanned(product?.name ?? 'Product found')
      setCameraStatus('Barcode detected')
      if (navigator.vibrate) navigator.vibrate(120)
      return
    }

    setDetectedProduct(null)
    setLastScanned('Barcode not registered')
    setCameraStatus('Barcode not registered')
    setBarcodeInput(normalized)
  }

  const handleManualLookup = () => {
    const value = (manualSearch || barcodeInput).trim()
    if (!value) return
    handleScan(value)
  }

  const renderProductCard = () => {
    if (!detectedProduct) {
      return (
        <div style={styles.card}>
          <h3 style={styles.title}>BARCODE NOT REGISTERED</h3>
          <p style={styles.label}>Barcode:</p>
          <p style={styles.value}>{barcodeInput || '4800012345678'}</p>
          <div style={styles.formBlock}>
            <label style={styles.label}>Product Name</label>
            <input value={barcodeInput || 'Canned Tuna'} style={styles.input} readOnly />
          </div>
          <div style={styles.formGrid}>
            <div>
              <label style={styles.label}>Category</label>
              <select style={styles.input} defaultValue="">
                <option value="">Select Category</option>
                <option>Beverages</option>
                <option>Snacks</option>
              </select>
            </div>
            <div>
              <label style={styles.label}>Brand</label>
              <input style={styles.input} placeholder="Brand" />
            </div>
          </div>
          <div style={styles.formGrid}>
            <div>
              <label style={styles.label}>Cost Price</label>
              <input style={styles.input} placeholder="₱0.00" />
            </div>
            <div>
              <label style={styles.label}>Selling Price</label>
              <input style={styles.input} placeholder="₱0.00" />
            </div>
          </div>
          <button style={styles.primaryButton}>Add Product</button>
        </div>
      )
    }

    return (
      <div style={styles.card}>
        <h3 style={styles.title}>BARCODE DETECTED</h3>
        <h2 style={styles.productName}>{detectedProduct.name}</h2>
        <p style={styles.label}>Barcode:</p>
        <p style={styles.value}>{detectedProduct.barcode}</p>
        <div style={styles.statsRow}>
          <div>
            <p style={styles.label}>Current Stock</p>
            <p style={styles.value}>{detectedProduct.currentStock} units</p>
          </div>
          <div>
            <p style={styles.label}>Selling Price</p>
            <p style={styles.value}>{formatCurrency(detectedProduct.sellingPrice)}</p>
          </div>
        </div>
        <div style={styles.statsRow}>
          <div>
            <p style={styles.label}>Cost Price</p>
            <p style={styles.value}>{formatCurrency(detectedProduct.costPrice)}</p>
          </div>
        </div>
        <div style={styles.actionGrid}>
          <button style={styles.primaryButton}>+ Add to Cart</button>
          <button style={styles.secondaryButton}>Stock In</button>
          <button style={styles.secondaryButton}>Stock Adjustment</button>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <button style={styles.backButton}>← Back</button>
      </div>

      <h1 style={styles.heading}>SCAN PRODUCT</h1>

      <div style={styles.scannerShell}>
        <video ref={videoRef} style={styles.video} muted playsInline />
        <div style={styles.scanFrame}>
          <div style={styles.scanGuideline} />
        </div>
      </div>

      <div style={styles.metaRow}>
        <span style={styles.statusPill}>{cameraStatus}</span>
        <button
          onClick={() => setAction('sale')}
          style={{ ...styles.modeButton, ...(action === 'sale' ? styles.modeButtonActive : {}) }}
        >
          POS
        </button>
        <button
          onClick={() => setAction('stock_in')}
          style={{ ...styles.modeButton, ...(action === 'stock_in' ? styles.modeButtonActive : {}) }}
        >
          Stock In
        </button>
      </div>

      <div style={styles.scanControls}>
        <button style={styles.primaryButton} onClick={() => handleScan('4800012345678')}>
          Simulate Scan
        </button>
        <button style={styles.secondaryButton}>Use Camera</button>
      </div>

      {permissionError ? <p style={styles.errorText}>{permissionError}</p> : null}

      <div style={styles.manualBlock}>
        <label style={styles.label}>Enter barcode manually</label>
        <input
          value={manualSearch}
          onChange={(e) => setManualSearch(e.target.value)}
          placeholder="4800012345678"
          style={styles.input}
        />
        <button style={styles.primaryButton} onClick={handleManualLookup}>Search Product</button>
      </div>

      {renderProductCard()}

      <p style={styles.footerText}>Last scanned: {lastScanned}</p>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    maxWidth: 500,
    margin: '0 auto',
    padding: '18px 16px 48px',
    background: '#f8fafc',
    minHeight: '100vh',
    fontFamily: 'Inter, Arial, sans-serif',
    color: '#111827',
  },
  header: {
    display: 'flex',
    justifyContent: 'flex-start',
  },
  backButton: {
    border: 'none',
    background: 'transparent',
    fontSize: 18,
    color: '#1f2937',
    cursor: 'pointer',
  },
  heading: {
    margin: '10px 0 14px',
    textAlign: 'center',
    fontSize: 26,
    letterSpacing: 0.6,
    fontWeight: 700,
  },
  scannerShell: {
    position: 'relative',
    height: 300,
    borderRadius: 22,
    overflow: 'hidden',
    background: '#0f172a',
    border: '1px solid #cbd5e1',
    boxShadow: '0 10px 30px rgba(15, 23, 42, 0.12)',
  },
  video: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
    background: '#111827',
  },
  scanFrame: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  scanGuideline: {
    width: 200,
    height: 160,
    border: '3px solid #22c55e',
    borderRadius: 18,
    boxShadow: 'inset 0 0 0 9999px rgba(15, 23, 42, 0.2)',
  },
  metaRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
    flexWrap: 'wrap',
  },
  statusPill: {
    background: '#dcfce7',
    color: '#166534',
    borderRadius: 999,
    padding: '6px 10px',
    fontSize: 12,
    fontWeight: 600,
  },
  modeButton: {
    border: '1px solid #d1d5db',
    background: '#fff',
    borderRadius: 999,
    padding: '8px 12px',
    cursor: 'pointer',
    color: '#374151',
  },
  modeButtonActive: {
    background: '#111827',
    color: '#fff',
    borderColor: '#111827',
  },
  scanControls: {
    display: 'flex',
    gap: 8,
    marginTop: 14,
    flexWrap: 'wrap',
  },
  primaryButton: {
    border: 'none',
    background: '#16a34a',
    color: '#fff',
    borderRadius: 12,
    padding: '12px 16px',
    fontWeight: 700,
    cursor: 'pointer',
    flex: 1,
  },
  secondaryButton: {
    border: '1px solid #d1d5db',
    background: '#fff',
    color: '#111827',
    borderRadius: 12,
    padding: '12px 16px',
    fontWeight: 600,
    cursor: 'pointer',
    flex: 1,
  },
  manualBlock: {
    marginTop: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: '#475569',
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid #cbd5e1',
    borderRadius: 10,
    padding: '12px 14px',
    fontSize: 14,
    background: '#fff',
  },
  errorText: {
    marginTop: 12,
    color: '#b91c1c',
    fontSize: 13,
  },
  card: {
    marginTop: 18,
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 18,
    padding: 18,
    boxShadow: '0 8px 24px rgba(15, 23, 42, 0.04)',
  },
  title: {
    margin: '0 0 8px',
    fontSize: 18,
    color: '#0f172a',
    fontWeight: 800,
  },
  productName: {
    margin: '0 0 14px',
    fontSize: 26,
    color: '#111827',
  },
  value: {
    margin: '4px 0 12px',
    fontSize: 16,
    fontWeight: 700,
    color: '#0f172a',
  },
  statsRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 12,
  },
  actionGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap: 10,
    marginTop: 18,
  },
  formBlock: {
    marginTop: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 12,
    marginTop: 12,
  },
  footerText: {
    marginTop: 18,
    fontSize: 14,
    color: '#475569',
    textAlign: 'center',
  },
}

export default ScannerPage
