import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CartItem } from '../../types'
import { formatCurrency, shouldIgnoreDuplicateScan } from '../scanner/scannerUtils'
import { storeApi, type ProductRecord } from '../../services/storeApi'
import { lookupPublicProduct, type PublicProductDetails } from '../../services/openFoodFacts'
import { BarcodeCameraScanner } from './BarcodeCameraScanner'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import './POSFlow.css'

type NewProductForm = { name: string; brand: string; category: string; barcode: string; costPrice: string; sellingPrice: string; initialStock: string; minStock: string; unit: string }
const emptyNewProduct = (barcode: string): NewProductForm => ({ name: '', brand: '', category: '', barcode, costPrice: '', sellingPrice: '', initialStock: '0', minStock: '0', unit: 'piece' })

export function POSFlow() {
  const [cart, setCart] = useState<CartItem[]>([])
  const [products, setProducts] = useState<ProductRecord[]>([])
  const [status, setStatus] = useState('Ready to scan')
  const [barcodeInput, setBarcodeInput] = useState('')
  const [lastBarcode, setLastBarcode] = useState('None')
  const [cameraOpen, setCameraOpen] = useState(false)
  const [unknownBarcode, setUnknownBarcode] = useState('')
  const [publicDetails, setPublicDetails] = useState<PublicProductDetails | null>(null)
  const [publicLookupStatus, setPublicLookupStatus] = useState('')
  const [newProductForm, setNewProductForm] = useState<NewProductForm>(emptyNewProduct(''))
  const [isCreatingProduct, setIsCreatingProduct] = useState(false)
  const closeUnknownProduct = useCallback(() => setUnknownBarcode(''), [])
  useEscapeKey(Boolean(unknownBarcode) && !cameraOpen, closeUnknownProduct)
  const lastScanRef = useRef({ value: '', time: 0 })

  useEffect(() => {
    storeApi.products().then((response) => setProducts(response.products)).catch((error: unknown) => setStatus(error instanceof Error ? error.message : 'Unable to load products'))
  }, [])

  const addToCart = useCallback((product: ProductRecord, quantity = 1) => {
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
  }, [])

  const handleScan = useCallback(async (rawValue: string) => {
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
        setUnknownBarcode(normalized)
        setNewProductForm(emptyNewProduct(normalized))
        setPublicDetails(null)
        setPublicLookupStatus('')
        return
      }
      setUnknownBarcode('')
      addToCart(response.product, 1)
      setStatus(`${response.product.name} added to cart`)
      if (navigator.vibrate) navigator.vibrate(80)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to look up barcode')
    }
  }, [addToCart])

  const handlePublicLookup = async () => {
    if (!unknownBarcode) return
    setPublicLookupStatus('Looking up product details…')
    try {
      const details = await lookupPublicProduct(unknownBarcode)
      if (!details) {
        setPublicLookupStatus('No public details were found. You can enter the product information manually.')
        return
      }
      setPublicDetails(details)
      setNewProductForm((current) => ({ ...current, name: details.name || current.name, brand: details.brand || current.brand, category: details.category || current.category }))
      setPublicLookupStatus('Details found. Review them and add your store prices and stock.')
    } catch (error) {
      setPublicLookupStatus(error instanceof Error ? error.message : 'Could not look up public product details.')
    }
  }

  const handleCreateProduct = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const costPrice = Number(newProductForm.costPrice)
    const sellingPrice = Number(newProductForm.sellingPrice)
    const initialStock = Number(newProductForm.initialStock)
    const minStock = Number(newProductForm.minStock)
    if (!Number.isFinite(costPrice) || costPrice < 0 || !Number.isFinite(sellingPrice) || sellingPrice < 0 || !Number.isInteger(initialStock) || initialStock < 0) {
      setPublicLookupStatus('Enter valid non-negative prices and a whole, non-negative starting stock quantity.')
      return
    }
    if (!Number.isInteger(minStock) || minStock < 0 || !newProductForm.unit.trim()) {
      setPublicLookupStatus('Enter a whole, non-negative low stock alert and a unit.')
      return
    }
    setIsCreatingProduct(true)
    try {
      const { product } = await storeApi.addProduct({ ...newProductForm, costPrice, sellingPrice, initialStock, minStock, unit: newProductForm.unit.trim() })
      setProducts((current) => [...current, product])
      setUnknownBarcode('')
      setBarcodeInput('')
      setPublicLookupStatus('Product added to your catalog. Prices and stock were saved to your store.')
      setStatus(`${product.name} added to catalog`)
    } catch (error) {
      setPublicLookupStatus(error instanceof Error ? error.message : 'Could not add this product.')
    } finally {
      setIsCreatingProduct(false)
    }
  }

  const handleCameraDetected = useCallback((barcode: string) => {
    setCameraOpen(false)
    void handleScan(barcode)
  }, [handleScan])

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
    <>
    <div className="theme-inline-panel" style={styles.card}>
      <div style={styles.headerRow}>
        <div>
          <p style={styles.kicker}>POS</p>
          <h3 style={styles.title}>Scan to cart</h3>
        </div>
        <button className="pos-primary" type="button" onClick={() => setCameraOpen(true)}>Scan with camera</button>
      </div>

      <div className="pos-manual-scan"><label htmlFor="pos-barcode">Or enter barcode manually</label><div><input id="pos-barcode" aria-label="Barcode" placeholder="Enter barcode manually" value={barcodeInput} onChange={(event) => setBarcodeInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void handleScan(barcodeInput) } }} maxLength={64} /><button className="pos-secondary" type="button" onClick={() => void handleScan(barcodeInput)} disabled={!barcodeInput.trim()}>Look up</button></div></div>

      {unknownBarcode && <div className="pos-add-product-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !isCreatingProduct) closeUnknownProduct() }}><section className="pos-enrichment pos-add-product-dialog" role="dialog" aria-modal="true" aria-labelledby="pos-enrichment-title">
        <div className="pos-enrichment-heading"><div><p className="pos-modal-eyebrow">BARCODE NOT IN CATALOG</p><h4 id="pos-enrichment-title">Add this product?</h4><p>Scanned barcode: <strong>{unknownBarcode}</strong></p></div><div className="pos-enrichment-actions"><button type="button" className="pos-secondary" onClick={() => void handlePublicLookup()} disabled={publicLookupStatus.startsWith('Looking up') || isCreatingProduct}>Look up details</button><button type="button" className="pos-enrichment-dismiss" onClick={closeUnknownProduct} disabled={isCreatingProduct}>Cancel</button></div></div>
        {publicLookupStatus && <p className="pos-lookup-status" role="status">{publicLookupStatus}</p>}
        {publicDetails && <p className="pos-public-source">Community-sourced name, brand, and category from <a href="https://world.openfoodfacts.org" target="_blank" rel="noreferrer">Open Food Facts</a>. Review before saving. Prices and stock are entered by you.</p>}
        <form onSubmit={(event) => void handleCreateProduct(event)} className="pos-new-product-form">
          <label>Product name<input value={newProductForm.name} maxLength={64} required onChange={(event) => setNewProductForm((current) => ({ ...current, name: event.target.value }))} /></label>
          <label>Brand<input value={newProductForm.brand} maxLength={64} onChange={(event) => setNewProductForm((current) => ({ ...current, brand: event.target.value }))} /></label>
          <label>Category<input value={newProductForm.category} maxLength={64} required onChange={(event) => setNewProductForm((current) => ({ ...current, category: event.target.value }))} /></label>
          <label>Cost per unit (PHP)<input type="number" min="0" step="0.01" value={newProductForm.costPrice} required onChange={(event) => setNewProductForm((current) => ({ ...current, costPrice: event.target.value }))} /></label>
          <label>Selling price (PHP)<input type="number" min="0" step="0.01" value={newProductForm.sellingPrice} required onChange={(event) => setNewProductForm((current) => ({ ...current, sellingPrice: event.target.value }))} /></label>
          <label>Starting stock (pieces)<input type="number" min="0" step="1" value={newProductForm.initialStock} required onChange={(event) => setNewProductForm((current) => ({ ...current, initialStock: event.target.value }))} /></label>
          <label>Low stock alert at<input type="number" min="0" step="1" value={newProductForm.minStock} required onChange={(event) => setNewProductForm((current) => ({ ...current, minStock: event.target.value }))} /></label>
          <label>Unit<input value={newProductForm.unit} maxLength={64} required onChange={(event) => setNewProductForm((current) => ({ ...current, unit: event.target.value }))} /></label>
          <button type="submit" className="pos-primary" disabled={isCreatingProduct}>{isCreatingProduct ? 'Adding…' : 'Add to catalog'}</button>
        </form>
      </section></div>}

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
    {cameraOpen && <BarcodeCameraScanner onDetected={handleCameraDetected} onClose={() => setCameraOpen(false)} />}
    </>
  )
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: 'var(--app-surface)',
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
    color: 'var(--app-muted)',
    textTransform: 'uppercase',
  },
  title: {
    margin: '4px 0 0',
    fontSize: 24,
    color: 'var(--app-text)',
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
    background: 'var(--app-surface)',
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
    background: 'var(--app-page)',
    border: '1px solid #e2e8f0',
  },
  label: {
    margin: 0,
    fontSize: 11,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: 'var(--app-muted)',
    fontWeight: 700,
  },
  value: {
    margin: '6px 0 0',
    fontWeight: 700,
    color: 'var(--app-text)',
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
    color: 'var(--app-text)',
  },
  metaText: {
    margin: '4px 0 0',
    fontSize: 12,
    color: 'var(--app-muted)',
  },
  amountBox: {
    background: 'var(--app-accent-soft)',
    color: 'var(--app-accent-readable, var(--app-accent))',
    borderRadius: 8,
    padding: '6px 10px',
    fontWeight: 700,
  },
  totalRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    background: 'var(--app-inverse-surface, #173039)',
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
    background: 'var(--app-surface)',
    color: 'var(--app-text)',
  },
}

export default POSFlow
