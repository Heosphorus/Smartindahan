import { useEffect, useRef, useState } from 'react'

import { inventoryApi, newRequestKey, type Movement } from '../../services/inventoryApi'
import { storeApi, type ProductRecord } from '../../services/storeApi'
import { formatPeso, hasPack, MOVEMENT_LABEL, parseMoney, parseWhole, plural, productId, STOCK_OUT_REASONS, unitWord, unitsPerReceived, wholeUnits } from './inventoryMath'

type ActionProps = {
  product: ProductRecord
  /** Called after a change was saved, with a message to show the person. */
  onDone: (message: string) => void
  onClose: () => void
}

const messageOf = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback

/** Adds stock to one product right from its row. Receiving a delivery with a supplier and cost is done in Restock. */
export function QuickAdd({ product, onDone, onClose }: ActionProps) {
  const pack = hasPack(product)
  const [unit, setUnit] = useState<'base' | 'purchase'>('base')
  const [quantity, setQuantity] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // The same key is reused if the request is retried, so a double tap or a dropped connection cannot add the stock twice.
  const key = useRef(newRequestKey())
  const selling = product.unit || 'piece'
  const added = quantity.trim() ? wholeUnits(Number(quantity), unitsPerReceived(product, unit)) : null

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (added === null) { setError(`Enter a quantity that makes a whole number of ${unitWord(selling, 2)}.`); return }
    setBusy(true)
    setError('')
    try {
      await inventoryApi.stockIn(productId(product), added, key.current)
      key.current = newRequestKey()
      setQuantity('')
      onDone(`Added ${plural(added, selling, unitWord(selling, 2))} to ${product.name}.`)
    } catch (caught) {
      setError(messageOf(caught, 'Stock could not be added.'))
    } finally {
      setBusy(false)
    }
  }

  return <form className="inv-quick" onSubmit={(event) => void submit(event)} aria-label={`Add stock to ${product.name}`} noValidate>
    <label>Quantity to add<input autoFocus inputMode="decimal" autoComplete="off" value={quantity} onChange={(event) => { setQuantity(event.target.value); setError('') }} placeholder="e.g. 12" /></label>
    {pack && <label>In<select value={unit} onChange={(event) => { setUnit(event.target.value as 'base' | 'purchase'); setError('') }}><option value="base">{unitWord(selling, 2)}</option><option value="purchase">{unitWord(product.purchaseUnit, 2)} ({product.unitsPerPurchaseUnit} {unitWord(selling, 2)} each)</option></select></label>}
    {added !== null && unit === 'purchase' && <p className="inv-hint" role="status">That adds {plural(added, selling, unitWord(selling, 2))}.</p>}
    {error && <p className="price-form-error" role="alert">{error}</p>}
    <div className="inv-quick-actions">
      <button type="button" className="price-secondary" onClick={onClose}>Cancel</button>
      <button type="submit" className="price-primary" disabled={busy}>{busy ? 'Adding…' : added !== null ? `Add ${plural(added, selling, unitWord(selling, 2))}` : 'Add stock'}</button>
    </div>
  </form>
}

/** Removes stock for a reason. Asks to confirm first, because it lowers what can be sold. */
export function QuickRemove({ product, onDone, onClose }: ActionProps) {
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState<string>(STOCK_OUT_REASONS[0])
  const [note, setNote] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const key = useRef(newRequestKey())
  const selling = product.unit || 'piece'
  const amount = parseWhole(quantity)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (amount === null || amount < 1) { setError('Enter how many to remove, as a whole number.'); return }
    if (amount > product.currentStock) { setError(`Only ${plural(product.currentStock, selling, unitWord(selling, 2))} in stock.`); return }
    if (!confirming) { setConfirming(true); return }
    setBusy(true)
    setError('')
    try {
      await inventoryApi.stockOut(productId(product), amount, reason, key.current, note.trim() || undefined)
      key.current = newRequestKey()
      onDone(`Removed ${plural(amount, selling, unitWord(selling, 2))} of ${product.name} (${reason.toLowerCase()}).`)
    } catch (caught) {
      setError(messageOf(caught, 'Stock could not be removed.'))
      setConfirming(false)
    } finally {
      setBusy(false)
    }
  }

  return <form className="inv-quick" onSubmit={(event) => void submit(event)} aria-label={`Remove stock from ${product.name}`} noValidate>
    <label>Quantity to remove<input autoFocus inputMode="numeric" autoComplete="off" value={quantity} onChange={(event) => { setQuantity(event.target.value); setConfirming(false); setError('') }} placeholder="e.g. 2" /></label>
    <label>Reason<select value={reason} onChange={(event) => { setReason(event.target.value); setConfirming(false) }}>{STOCK_OUT_REASONS.map((item) => <option key={item}>{item}</option>)}</select></label>
    <label className="inv-wide">Note (optional)<input value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} /></label>
    {confirming && amount !== null && <p className="price-review-note" role="alert">Stock will go from {product.currentStock} to {product.currentStock - amount}. This is recorded as “{reason}”. Confirm to continue.</p>}
    {error && <p className="price-form-error" role="alert">{error}</p>}
    <div className="inv-quick-actions">
      <button type="button" className="price-secondary" onClick={onClose}>Cancel</button>
      <button type="submit" className="price-delete confirm" disabled={busy}>{busy ? 'Removing…' : confirming ? 'Confirm removal' : 'Remove stock'}</button>
    </div>
  </form>
}

/** Edits the selling price, the cost, and the low-stock alert level of one product. */
export function QuickPrices({ product, onDone, onClose }: ActionProps) {
  const [selling, setSelling] = useState(String(product.sellingPrice))
  const [cost, setCost] = useState(String(product.costPrice))
  const [alert, setAlert] = useState(String(product.minStock))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const nextSelling = parseMoney(selling)
  const nextCost = parseMoney(cost)
  const nextAlert = parseWhole(alert)
  const margin = nextSelling !== null && nextCost !== null ? nextSelling - nextCost : null

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (nextSelling === null || nextCost === null) { setError('Enter prices as numbers of zero or more, such as 25 or 12.50.'); return }
    if (nextAlert === null) { setError('The low-stock alert must be a whole number of zero or more.'); return }
    const changes: Record<string, number> = {}
    if (nextSelling !== product.sellingPrice) changes.sellingPrice = nextSelling
    if (nextCost !== product.costPrice) changes.costPrice = nextCost
    if (nextAlert !== product.minStock) changes.minStock = nextAlert
    if (!Object.keys(changes).length) { setError('Nothing was changed.'); return }
    setBusy(true)
    setError('')
    try {
      await storeApi.updateProduct(productId(product), changes)
      onDone(`Saved changes to ${product.name}.`)
    } catch (caught) {
      setError(messageOf(caught, 'The changes could not be saved.'))
    } finally {
      setBusy(false)
    }
  }

  return <form className="inv-quick" onSubmit={(event) => void submit(event)} aria-label={`Edit prices for ${product.name}`} noValidate>
    <label>Selling price (₱)<input autoFocus inputMode="decimal" autoComplete="off" value={selling} onChange={(event) => { setSelling(event.target.value); setError('') }} /></label>
    <label>Cost per {product.unit || 'piece'} (₱)<input inputMode="decimal" autoComplete="off" value={cost} onChange={(event) => { setCost(event.target.value); setError('') }} /></label>
    <label className="inv-wide">Alert me when stock is at or below<input inputMode="numeric" autoComplete="off" value={alert} onChange={(event) => { setAlert(event.target.value); setError('') }} /></label>
    {margin !== null && <p className={margin < 0 ? 'price-review-note' : 'inv-hint'} role="status">{margin < 0 ? `Selling below cost: you lose ${formatPeso(-margin)} on each one.` : `Profit of ${formatPeso(margin)} on each one.`}</p>}
    {error && <p className="price-form-error" role="alert">{error}</p>}
    <div className="inv-quick-actions">
      <button type="button" className="price-secondary" onClick={onClose}>Cancel</button>
      <button type="submit" className="price-primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
    </div>
  </form>
}

/** The most recent stock changes for a product, so any quantity can be traced to a sale, delivery, count or removal. */
export function StockHistory({ product, onClose }: { product: ProductRecord; onClose: () => void }) {
  const id = productId(product)
  const [state, setState] = useState<{ id: string; movements?: Movement[]; error?: string } | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    inventoryApi.movements(id)
      .then((result) => { if (active) setState({ id, movements: result.movements }) })
      .catch((caught: unknown) => { if (active) setState({ id, error: messageOf(caught, 'History could not be loaded.') }) })
    return () => { active = false }
  }, [id, attempt])

  const ready = state?.id === id ? state : null
  return <div className="inv-history" aria-label={`Stock history for ${product.name}`}>
    {!ready && <p className="inv-hint" role="status">Loading history…</p>}
    {ready?.error && <p className="price-form-error" role="alert">{ready.error} <button type="button" className="price-secondary" onClick={() => { setState(null); setAttempt((count) => count + 1) }}>Try again</button></p>}
    {ready?.movements && !ready.movements.length && <p className="inv-hint">No stock changes recorded yet.</p>}
    {ready?.movements && ready.movements.length > 0 && <ul>
      {ready.movements.map((movement) => <li key={movement.id}>
        <span className="inv-history-when">{new Date(movement.createdAt).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
        <span>{MOVEMENT_LABEL[movement.type] ?? movement.type}{movement.reason ? ` · ${movement.reason}` : ''}{movement.unitCost !== undefined ? ` · cost ${formatPeso(movement.unitCost)}` : ''}</span>
        <strong className={movement.quantity < 0 ? 'inv-minus' : 'inv-plus'}>{movement.quantity > 0 ? '+' : ''}{movement.quantity}</strong>
        <span className="inv-history-after">now {movement.newStock}</span>
      </li>)}
    </ul>}
    <button type="button" className="price-secondary" onClick={onClose}>Close history</button>
  </div>
}
