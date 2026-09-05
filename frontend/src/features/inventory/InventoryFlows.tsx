import { useMemo, useState } from 'react'
import { demoProducts } from '../../data/demoProducts'
import { createMockProductLookup, formatCurrency } from '../scanner/scannerUtils'

export function StockInFlow() {
  const [supplier, setSupplier] = useState('ABC Distribution')
  const [items, setItems] = useState([
    { productId: 'prod-1', productName: 'Coca-Cola 1.5L', quantity: 24, cost: 60 },
    { productId: 'prod-2', productName: 'Lucky Me Pancit Canton', quantity: 30, cost: 12 },
  ])

  const total = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity * item.cost, 0),
    [items],
  )

  const handleScan = () => {
    const scanned = createMockProductLookup('4800012345678')
    const found = demoProducts.find((product) => product.id === scanned?.productId)
    if (!found) return

    setItems((current) => {
      const existing = current.find((item) => item.productId === found.id)
      if (existing) {
        return current.map((item) =>
          item.productId === found.id ? { ...item, quantity: item.quantity + 12 } : item,
        )
      }

      return [...current, { productId: found.id, productName: found.name, quantity: 12, cost: found.costPrice }]
    })
  }

  return (
    <div style={styles.card}>
      <p style={styles.kicker}>Supplier stock-in</p>
      <h3 style={styles.title}>{supplier}</h3>

      <label style={styles.label}>Supplier</label>
      <select value={supplier} onChange={(e) => setSupplier(e.target.value)} style={styles.input}>
        <option>ABC Distribution</option>
        <option>XYZ Foods</option>
        <option>Fresh Market</option>
      </select>

      <div style={styles.buttonRow}>
        <button style={styles.primaryButton} onClick={handleScan}>Scan Product</button>
        <button style={styles.secondaryButton}>Add manually</button>
      </div>

      <div style={styles.itemList}>
        {items.map((item) => (
          <div key={item.productId} style={styles.itemRow}>
            <div>
              <div style={styles.itemName}>{item.productName}</div>
              <div style={styles.metaText}>x{item.quantity}</div>
            </div>
            <div style={styles.amountText}>Cost: {formatCurrency(item.cost)}</div>
          </div>
        ))}
      </div>

      <div style={styles.totalRow}>
        <span>Total Purchase</span>
        <strong>{formatCurrency(total)}</strong>
      </div>

      <button style={styles.primaryButton}>Confirm Stock-In</button>
    </div>
  )
}

export function StockOutFlow() {
  const [quantity, setQuantity] = useState(2)
  const [reason, setReason] = useState('Damaged')
  const [product, setProduct] = useState(demoProducts[0])

  return (
    <div style={styles.card}>
      <p style={styles.kicker}>Stock-out</p>
      <h3 style={styles.title}>Manual removal</h3>

      <label style={styles.label}>Product</label>
      <select value={product.id} onChange={(e) => setProduct(demoProducts.find((item) => item.id === e.target.value) ?? demoProducts[0])} style={styles.input}>
        {demoProducts.map((item) => (
          <option key={item.id} value={item.id}>{item.name}</option>
        ))}
      </select>

      <div style={styles.inlineTwo}>
        <div style={styles.fieldWrap}>
          <label style={styles.label}>Quantity</label>
          <input type="number" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} style={styles.input} />
        </div>
        <div style={styles.fieldWrap}>
          <label style={styles.label}>Reason</label>
          <select value={reason} onChange={(e) => setReason(e.target.value)} style={styles.input}>
            <option>Damaged</option>
            <option>Expired</option>
            <option>Spoiled</option>
            <option>Lost</option>
            <option>Personal use</option>
            <option>Other</option>
          </select>
        </div>
      </div>

      <button style={styles.primaryButton}>Confirm Stock-Out</button>
    </div>
  )
}

type CountRecord = {
  productName: string
  scannedQty: number
  systemQty: number
}

export function InventoryCountFlow() {
  const [counts, setCounts] = useState<Record<string, CountRecord>>({
    'prod-1': { productName: 'Coca-Cola 1.5L', scannedQty: 3, systemQty: 4 },
    'prod-2': { productName: 'Lucky Me Pancit Canton', scannedQty: 1, systemQty: 1 },
  })

  const addScan = (productId: string) => {
    setCounts((current) => {
      const record = current[productId] ?? { productName: 'Unknown Product', scannedQty: 0, systemQty: 0 }

      return {
        ...current,
        [productId]: {
          ...record,
          scannedQty: record.scannedQty + 1,
        },
      }
    })
  }

  return (
    <div style={styles.card}>
      <p style={styles.kicker}>Inventory count</p>
      <h3 style={styles.title}>Live counting</h3>

      <div style={styles.buttonRow}>
        <button style={styles.primaryButton} onClick={() => addScan('prod-1')}>Scan Coca-Cola</button>
        <button style={styles.secondaryButton} onClick={() => addScan('prod-2')}>Scan Lucky Me</button>
      </div>

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th>Product</th>
              <th>Scanned</th>
              <th>System</th>
              <th>Difference</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(counts).map(([productId, record]) => (
              <tr key={productId}>
                <td>{record.productName}</td>
                <td>{record.scannedQty}</td>
                <td>{record.systemQty}</td>
                <td>{record.scannedQty - record.systemQty}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button style={styles.primaryButton}>Review Adjustments</button>
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
  kicker: {
    margin: 0,
    fontSize: 11,
    letterSpacing: 1,
    fontWeight: 700,
    color: '#64748b',
    textTransform: 'uppercase',
  },
  title: {
    margin: '4px 0 12px',
    fontSize: 24,
    color: '#0f172a',
  },
  label: {
    display: 'block',
    marginTop: 12,
    marginBottom: 6,
    fontSize: 11,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: '#64748b',
    fontWeight: 700,
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    borderRadius: 10,
    border: '1px solid #cbd5e1',
    padding: '10px 12px',
    fontSize: 14,
    background: '#fff',
  },
  primaryButton: {
    border: 'none',
    background: '#16a34a',
    color: '#fff',
    borderRadius: 12,
    padding: '12px 16px',
    fontWeight: 700,
    cursor: 'pointer',
    width: '100%',
    marginTop: 12,
  },
  secondaryButton: {
    border: '1px solid #d1d5db',
    background: '#fff',
    borderRadius: 12,
    padding: '12px 16px',
    fontWeight: 600,
    cursor: 'pointer',
    width: '100%',
    marginTop: 12,
  },
  buttonRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 10,
    marginTop: 8,
  },
  itemList: {
    marginTop: 14,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  itemRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 0',
    borderBottom: '1px solid #e2e8f0',
  },
  itemName: {
    fontWeight: 700,
    color: '#0f172a',
  },
  metaText: {
    marginTop: 2,
    fontSize: 12,
    color: '#64748b',
  },
  amountText: {
    fontWeight: 700,
    color: '#166534',
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
    marginTop: 16,
  },
  inlineTwo: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 12,
  },
  fieldWrap: {
    display: 'flex',
    flexDirection: 'column',
  },
  tableWrap: {
    marginTop: 16,
    overflowX: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 13,
  },
}

export default {
  StockInFlow,
  StockOutFlow,
  InventoryCountFlow,
}
