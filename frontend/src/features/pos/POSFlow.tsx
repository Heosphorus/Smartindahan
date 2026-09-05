import { useEffect, useMemo, useRef, useState } from 'react'
import type { CartItem } from '../../types'
import { formatCurrency, shouldIgnoreDuplicateScan } from '../scanner/scannerUtils'
import { storeApi, type ProductRecord } from '../../services/storeApi'

export function POSFlow() {
  const [cart, setCart] = useState<CartItem[]>([])
  const [products, setProducts] = useState<ProductRecord[]>([])
  const [status, setStatus] = useState('Ready to scan')
  const [barcodeInput, setBarcodeInput] = useState('')
  const [lastBarcode, setLastBarcode] = useState('None')
  const lastScanRef = useRef({ value: '', time: 0 })

  useEffect(() => {
    storeApi.products().then((response) => setProducts(response.products)).catch((error: unknown) => setStatus(error instanceof Error ? error.message : 'Unable to load products'))
  }, [])

  const addToCart = (product: ProductRecord, quantity = 1) => {
    const productId = product._id ?? product.id
    if (!productId) return
    setCart((current) => {
      const existing = current.find((item) => item.productId === productId)

      if (existing) {
        return current.map((item) =>
          item.productId === productId
            ? { ...item, quantity: item.quantity + quantity }
            : item,
        )
      }

      return [
        ...current,
        {
          productId,
          productName: product.name,
          quantity,
          unitPrice: product.sellingPrice,
          costPrice: product.costPrice,
        },
      ]
    })
  }

  const handleScan = async (rawValue: string) => {
    const normalized = rawValue.trim()
    const now = Date.now()

    if (shouldIgnoreDuplicateScan(lastScanRef.current.value, normalized, 1200, lastScanRef.current.time, now)) {
      return
    }

    lastScanRef.current = { value: normalized, time: now }
    setLastBarcode(normalized)

    try {
      const response = await storeApi.lookupProduct(normalized)
      if (!response.product) {
        setStatus('Barcode not registered')
        return
      }
      addToCart(response.product, 1)
      setStatus(`${response.product.name} added to cart`)
      if (navigator.vibrate) navigator.vibrate(80)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to look up barcode')
    }
  }

  const completeCheckout = async () => {
    try {
      const response = await storeApi.checkout(cart.map((item) => ({ productId: item.productId, quantity: item.quantity })))
      setCart([])
      setStatus(`Checkout complete: ${response.sale.code}`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Checkout failed')
    }
  }

  const total = useMemo(
    () => cart.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0),
    [cart],
  )

  return (
    <div style={styles.card}>
      <div style={styles.headerRow}>
        <div>
          <p style={styles.kicker}>POS</p>
          <h3 style={styles.title}>Scan to cart</h3>
        </div>
        <button style={styles.primaryButton} onClick={() => void handleScan(barcodeInput || products[0]?.barcode || '')}>
          Scan
        </button>
      </div>

      <input aria-label="Barcode" placeholder="Enter barcode manually" value={barcodeInput} onChange={(event) => setBarcodeInput(event.target.value)} style={styles.barcodeInput} />

      <div style={styles.summaryBox}>
        <div>
          <p style={styles.label}>Last Scanned</p>
          <p style={styles.value}>{lastBarcode}</p>
        </div>
        <div>
          <p style={styles.label}>Status</p>
          <p style={styles.value}>{status}</p>
        </div>
      </div>

      <div style={styles.cartList}>
        {cart.map((item) => (
          <div key={item.productId} style={styles.itemRow}>
            <div>
              <p style={styles.itemName}>{item.productName}</p>
              <p style={styles.metaText}>x{item.quantity}</p>
            </div>
            <div style={styles.amountBox}>{formatCurrency(item.quantity * item.unitPrice)}</div>
          </div>
        ))}
      </div>

      <div style={styles.totalRow}>
        <span>TOTAL</span>
        <strong>{formatCurrency(total)}</strong>
      </div>

      <div style={styles.buttonRow}>
        <button style={styles.secondaryButton} onClick={() => setStatus(products.length ? `${products.length} products available for scanning` : 'No products registered yet')}>
          View products
        </button>
        <button style={styles.primaryButton} onClick={() => void completeCheckout()} disabled={!cart.length}>Complete Checkout</button>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 20,
    padding: 18,
    boxShadow: '0 8px 24px rgba(15, 23, 42, 0.06)',
  },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  kicker: {
    margin: 0,
    fontSize: 11,
    letterSpacing: 1,
    fontWeight: 700,
    color: '#64748b',
    textTransform: 'uppercase',
  },
  title: {
    margin: '4px 0 0',
    fontSize: 24,
    color: '#0f172a',
  },
  primaryButton: {
    border: 'none',
    background: '#16a34a',
    color: '#fff',
    borderRadius: 12,
    padding: '12px 16px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  secondaryButton: {
    border: '1px solid #d1d5db',
    background: '#fff',
    borderRadius: 12,
    padding: '12px 16px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  summaryBox: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 10,
    marginBottom: 14,
    padding: 12,
    borderRadius: 14,
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
  },
  label: {
    margin: 0,
    fontSize: 11,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: '#64748b',
    fontWeight: 700,
  },
  value: {
    margin: '6px 0 0',
    fontWeight: 700,
    color: '#0f172a',
  },
  cartList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    marginBottom: 14,
  },
  itemRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    borderBottom: '1px solid #e2e8f0',
    paddingBottom: 8,
  },
  itemName: {
    margin: 0,
    fontWeight: 700,
    color: '#0f172a',
  },
  metaText: {
    margin: '4px 0 0',
    fontSize: 12,
    color: '#64748b',
  },
  amountBox: {
    background: '#ecfdf5',
    color: '#166534',
    borderRadius: 8,
    padding: '6px 10px',
    fontWeight: 700,
  },
  totalRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    background: '#0f172a',
    color: '#fff',
    borderRadius: 12,
    padding: '12px 14px',
    fontWeight: 700,
    marginBottom: 14,
  },
  buttonRow: {
    display: 'flex',
    gap: 10,
  },
  barcodeInput: {
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid #cbd5e1',
    borderRadius: 10,
    padding: '10px 12px',
    marginBottom: 14,
  },
}

export default POSFlow
