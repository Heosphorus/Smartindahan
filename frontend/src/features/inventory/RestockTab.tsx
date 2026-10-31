import { useEffect, useRef, useState } from 'react'

import { businessApi, type RestockSuggestion, type Supplier } from '../../services/businessApi'
import { inventoryApi, newRequestKey, type PurchaseResult } from '../../services/inventoryApi'
import type { ProductRecord } from '../../services/storeApi'
import { NewProductDialog } from './NewProductDialog'
import { ScanBox } from './ScanBox'
import { formatPeso, hasPack, plural, productId, unitWord } from './inventoryMath'
import { addToLines, checkLine, type RestockDraftLine } from './restockLines'
import { useProductMatches } from './useProductMatches'

type Step = 'edit' | 'review' | 'done'
type Need = { product: ProductRecord; quantity: number; reason: string }
const messageOf = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback

type Props = {
  lines: RestockDraftLine[]
  setLines: (update: (lines: RestockDraftLine[]) => RestockDraftLine[]) => void
  /** Called after a delivery was recorded, so the stock list can refresh. */
  onChanged: () => void
  onShowStock: () => void
}

/** Receive a delivery: pick or scan products, enter what arrived and what you paid, review, confirm. */
export function RestockTab({ lines, setLines, onChanged, onShowStock }: Props) {
  const [search, setSearch] = useState('')
  const [categories, setCategories] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [unknown, setUnknown] = useState<{ barcode: string; archived?: { id: string; name: string } } | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [supplierId, setSupplierId] = useState('')
  const [note, setNote] = useState('')
  const [updateCost, setUpdateCost] = useState(true)
  const [step, setStep] = useState<Step>('edit')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<PurchaseResult | null>(null)
  const [needs, setNeeds] = useState<{ items: Need[] } | { error: string } | null>(null)
  const [needsAttempt, setNeedsAttempt] = useState(0)
  // One key per delivery: a retry of the same submission reuses it, so the server records the delivery only once.
  const key = useRef(newRequestKey())
  const inFlight = useRef(false)
  const query = search.trim()
  const found = useProductMatches(query)

  useEffect(() => {
    let active = true
    businessApi.suppliers().then((result) => { if (active) setSuppliers(result.suppliers) }).catch(() => undefined)
    return () => { active = false }
  }, [])

  // Products that are out or low, with a suggested quantity from recent sales when there is enough history.
  useEffect(() => {
    let active = true
    Promise.all([inventoryApi.listProducts({ status: 'out', limit: 50 }), inventoryApi.listProducts({ status: 'low', limit: 50 }), businessApi.restockInsights().catch(() => null)])
      .then(([out, low, insights]) => {
        if (!active) return
        setCategories(out.categories)
        const bySuggestion = new Map<string, RestockSuggestion>((insights?.suggestions ?? []).map((entry) => [entry.productId, entry]))
        const items = [...out.products, ...low.products].map((product): Need => {
          const suggestion = bySuggestion.get(productId(product))
          if (suggestion && suggestion.suggestedOrderQuantity > 0) return { product, quantity: suggestion.suggestedOrderQuantity, reason: suggestion.reason }
          // Without enough sales history, the simple rule is to refill to double the alert level.
          const target = Math.max(product.minStock * 2, 1)
          return { product, quantity: Math.max(target - product.currentStock, 1), reason: product.currentStock <= 0 ? 'Out of stock.' : `At ${product.currentStock}, below your alert level of ${product.minStock}.` }
        })
        setNeeds({ items })
      })
      .catch((caught: unknown) => { if (active) setNeeds({ error: messageOf(caught, 'Low-stock products could not be loaded.') }) })
    return () => { active = false }
  }, [needsAttempt])

  const shownMatches = found.products
  const touch = () => { setError(''); setStep('edit') }
  const add = (product: ProductRecord, quantity = 1) => {
    setLines((current) => addToLines(current, product, quantity))
    setSearch('')
    setUnknown(null)
    setMessage(`${product.name} added.`)
    touch()
  }
  const update = (id: string, patch: Partial<RestockDraftLine>) => { setLines((current) => current.map((line) => productId(line.product) === id ? { ...line, ...patch } : line)); touch() }

  const handleScan = async (code: string) => {
    setMessage('')
    setUnknown(null)
    try {
      const lookup = await inventoryApi.lookupBarcode(code)
      if (lookup.found) add(lookup.product)
      else { setUnknown({ barcode: code, ...(lookup.archived ? { archived: lookup.archived } : {}) }); setMessage(lookup.message) }
    } catch (caught) {
      setMessage(messageOf(caught, 'The barcode could not be looked up. You can search by name instead.'))
    }
  }

  const checks = lines.map((line) => ({ line, check: checkLine(line) }))
  const firstProblem = checks.find((entry) => !entry.check.ok)
  const total = checks.reduce((sum, entry) => sum + (entry.check.ok ? entry.check.paid : 0), 0)
  const selectedSupplier = suppliers.find((supplier) => supplier._id === supplierId)

  const review = () => {
    if (!lines.length) { setError('Add at least one product first.'); return }
    if (firstProblem && !firstProblem.check.ok) { setError(`${firstProblem.line.product.name}: ${firstProblem.check.problem}`); return }
    setError('')
    setStep('review')
  }

  const confirm = async () => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError('')
    try {
      const items = checks.map(({ line, check }) => {
        if (!check.ok) throw new Error('Review the quantities and prices first.')
        return { productId: productId(line.product), quantity: check.quantity, unit: line.unit, unitCost: check.unitCost }
      })
      const saved = await inventoryApi.restock({ items, ...(supplierId ? { supplierId } : {}), ...(note.trim() ? { note: note.trim() } : {}), updateProductCost: updateCost, idempotencyKey: key.current })
      key.current = newRequestKey()
      setResult(saved)
      setStep('done')
      setLines(() => [])
      setNote('')
      onChanged()
      setNeedsAttempt((count) => count + 1)
    } catch (caught) {
      // The delivery and the form stay as they were, so the person can fix the problem or simply try again.
      setError(messageOf(caught, 'The delivery could not be recorded.'))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const startOver = () => { key.current = newRequestKey(); setResult(null); setStep('edit'); setError(''); setMessage(''); setLines(() => []) }

  if (step === 'done' && result) {
    return <div className="inv-restock">
      <div className="inv-done" role="status">
        <h3>{result.replayed ? 'This delivery was already recorded' : 'Delivery recorded'}</h3>
        <p>{plural(result.purchase.items.length, 'product')} updated{result.purchase.supplierName ? ` from ${result.purchase.supplierName}` : ''} · total paid {formatPeso(result.purchase.total)}</p>
        <ul>{result.purchase.items.map((item) => <li key={item.productId}><strong>{item.name}</strong><span>{item.previousStock} → {item.newStock}</span><span className="inv-plus">+{item.added}</span></li>)}</ul>
        <div className="inv-quick-actions"><button type="button" className="price-secondary" onClick={onShowStock}>View stock</button><button type="button" className="price-primary" onClick={startOver}>Receive another delivery</button></div>
      </div>
    </div>
  }

  return <div className="inv-restock">
    {step === 'edit' && <>
      <ScanBox label="Add a product to this delivery" value={search} onChange={(value) => { setSearch(value); setUnknown(null) }} onScan={(code) => void handleScan(code)} onSubmitText={() => { if (shownMatches.length === 1) add(shownMatches[0]!) }} placeholder="Scan, or search by name, SKU or barcode" hint="Scan the same product again to add one more." />
      {shownMatches.length > 0 && <ul className="inv-results" aria-label="Matching products">{shownMatches.map((product) => <li key={productId(product)}><span><strong>{product.name}</strong><small>{product.category} · {plural(product.currentStock, product.unit || 'piece', unitWord(product.unit, 2))} in stock</small></span><button type="button" className="price-secondary" onClick={() => add(product)} aria-label={`Add ${product.name} to delivery`}>Add</button></li>)}</ul>}
      {found.loaded && !found.failed && shownMatches.length === 0 && <p className="inv-hint">No product matches “{query}”. <button type="button" className="inv-link" onClick={() => setAdding('')}>Add a new product</button></p>}
      <div className="inv-live" role="status" aria-live="polite">{message && <p className="inv-hint">{message}</p>}</div>
      {unknown && <div className="inv-scan-result" role="alert"><p>{unknown.archived ? `“${unknown.archived.name}” was archived.` : `No product has barcode ${unknown.barcode}.`}</p><div className="inv-quick-actions">{unknown.archived ? <button type="button" className="price-primary" onClick={() => void inventoryApi.restoreProduct(unknown.archived!.id).then(() => handleScan(unknown.barcode)).catch((caught: unknown) => setMessage(messageOf(caught, 'The product could not be restored.')))}>Restore it</button> : <button type="button" className="price-primary" onClick={() => setAdding(unknown.barcode)}>Add a product with this barcode</button>}</div></div>}

      {needs && 'items' in needs && needs.items.length > 0 && <details className="inv-needs" open={lines.length === 0}>
        <summary>{plural(needs.items.length, 'product')} to restock</summary>
        <ul>{needs.items.slice(0, 12).map(({ product, quantity, reason }) => <li key={productId(product)}><span><strong>{product.name}</strong><small>{reason} Suggested: {plural(quantity, product.unit || 'piece', unitWord(product.unit, 2))}.</small></span><button type="button" className="price-secondary" onClick={() => add(product, quantity)} aria-label={`Add ${product.name}, suggested quantity ${quantity}`}>Add</button></li>)}</ul>
        <p className="inv-hint">Suggestions use your sales from the last 30 days when there is enough history, otherwise they refill to double your alert level. Adjust them to what you know.</p>
      </details>}
      {needs && 'error' in needs && <p className="inv-hint" role="status">{needs.error} <button type="button" className="inv-link" onClick={() => { setNeeds(null); setNeedsAttempt((count) => count + 1) }}>Try again</button></p>}

      {lines.length === 0 ? <div className="inv-empty"><p><strong>No products in this delivery yet.</strong></p><p>Scan or search for a product above, or add one from the restock suggestions.</p></div>
        : <ul className="inv-lines" aria-label="Products in this delivery">{checks.map(({ line, check }) => {
          const id = productId(line.product)
          const selling = line.product.unit || 'piece'
          return <li key={id} className="inv-line">
            <div className="inv-line-head"><strong>{line.product.name}</strong><span className="inv-meta">{plural(line.product.currentStock, selling, unitWord(selling, 2))} in stock now</span><button type="button" className="inv-link" onClick={() => { setLines((current) => current.filter((entry) => productId(entry.product) !== id)); touch() }} aria-label={`Remove ${line.product.name} from delivery`}>Remove</button></div>
            <div className="inv-line-fields">
              <label>Quantity received<input inputMode="decimal" autoComplete="off" value={line.quantity} onChange={(event) => update(id, { quantity: event.target.value })} aria-label={`Quantity received of ${line.product.name}`} /></label>
              {hasPack(line.product) ? <label>Received as<select value={line.unit} onChange={(event) => { const unit = event.target.value as 'base' | 'purchase'; update(id, { unit, unitCost: String(Math.round(line.product.costPrice * (unit === 'purchase' ? line.product.unitsPerPurchaseUnit! : 1) * 100) / 100) }) }} aria-label={`Unit received for ${line.product.name}`}><option value="purchase">{unitWord(line.product.purchaseUnit, 2)} ({line.product.unitsPerPurchaseUnit} {unitWord(selling, 2)} each)</option><option value="base">{unitWord(selling, 2)}</option></select></label> : <span className="inv-unit-label">{unitWord(selling, 2)}</span>}
              <label>Price paid per {line.unit === 'purchase' ? line.product.purchaseUnit : selling} (₱)<input inputMode="decimal" autoComplete="off" value={line.unitCost} onChange={(event) => update(id, { unitCost: event.target.value })} aria-label={`Price paid for ${line.product.name}`} /></label>
            </div>
            {check.ok ? <p className="inv-line-result" role="status">Adds <strong>{plural(check.added, selling, unitWord(selling, 2))}</strong> · stock becomes {check.newStock} · {formatPeso(check.paid)} total{line.unit === 'purchase' ? ` · ${formatPeso(check.costPerUnit)} each` : ''}</p> : <p className="price-form-error" role="alert">{check.problem}</p>}
          </li>
        })}</ul>}

      {lines.length > 0 && <div className="inv-delivery">
        <label>Supplier (optional)<select value={supplierId} onChange={(event) => { setSupplierId(event.target.value); touch() }}><option value="">No supplier</option>{suppliers.map((supplier) => <option key={supplier._id} value={supplier._id}>{supplier.name}</option>)}</select></label>
        {suppliers.length === 0 && <p className="inv-hint">Add your suppliers on the Suppliers page to pick one here.</p>}
        <label>Note (optional)<input value={note} maxLength={200} onChange={(event) => { setNote(event.target.value); touch() }} /></label>
        <label className="inv-check"><input type="checkbox" checked={updateCost} onChange={(event) => setUpdateCost(event.target.checked)} /> Update each product’s cost to this price</label>
        <p className="inv-total">Total paid <strong>{formatPeso(total)}</strong></p>
      </div>}
      {error && <p className="price-form-error" role="alert">{error}</p>}
      {lines.length > 0 && <div className="inv-quick-actions"><button type="button" className="price-secondary" onClick={() => { setLines(() => []); setError('') }}>Clear all</button><button type="button" className="price-primary" onClick={review}>Review delivery</button></div>}
    </>}

    {step === 'review' && <section className="inv-review" aria-label="Review delivery">
      <h3>Review before confirming</h3>
      <p className="inv-hint">Confirming adds this stock and cannot be undone here. If you made a mistake afterwards, correct it with a stock count or a removal; both stay in the history.</p>
      <table className="inv-table"><thead><tr><th>Product</th><th>Adds</th><th>Stock</th><th>Paid</th></tr></thead><tbody>
        {checks.map(({ line, check }) => check.ok && <tr key={productId(line.product)}>
          <td>{line.product.name}{updateCost && Math.abs(check.costPerUnit - line.product.costPrice) > 0.005 && <small>cost per {line.product.unit || 'piece'}: {formatPeso(line.product.costPrice)} → {formatPeso(check.costPerUnit)}</small>}</td>
          <td className="inv-plus">+{check.added}</td><td>{line.product.currentStock} → {check.newStock}</td><td>{formatPeso(check.paid)}</td>
        </tr>)}
      </tbody><tfoot><tr><th colSpan={3}>Total{selectedSupplier ? ` · ${selectedSupplier.name}` : ''}</th><th>{formatPeso(total)}</th></tr></tfoot></table>
      {error && <p className="price-form-error" role="alert">{error}</p>}
      <div className="inv-quick-actions"><button type="button" className="price-secondary" onClick={() => { setStep('edit'); setError('') }} disabled={busy}>Back</button><button type="button" className="price-primary" onClick={() => void confirm()} disabled={busy}>{busy ? 'Saving…' : 'Confirm and update stock'}</button></div>
    </section>}

    {adding !== null && <NewProductDialog barcode={adding} categories={categories} onCancel={() => setAdding(null)} onCreated={(product) => { setAdding(null); add(product) }} />}
  </div>
}
