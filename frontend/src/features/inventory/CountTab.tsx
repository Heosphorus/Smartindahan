import { useEffect, useRef, useState } from 'react'

import { useEscapeKey } from '../../hooks/useEscapeKey'
import { inventoryApi, type CountInput, type CountSummary, type StockCount } from '../../services/inventoryApi'
import type { ProductRecord } from '../../services/storeApi'
import { ScanBox } from './ScanBox'
import { COUNT_REASONS, parseWhole, plural, productId, unitWord } from './inventoryMath'
import { useProductMatches } from './useProductMatches'

type Mode = 'list' | 'count' | 'review' | 'done'
/** A product being counted. `counted` stays text while typing; `expected` is the system quantity when it was added or last saved. */
type Row = { id: string; name: string; unit: string; expected: number; counted: string; reason: string; stockNow?: number | null; moved?: number | null }

const MAX_ROWS = 500
const messageOf = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback
const toRow = (product: ProductRecord, counted: string): Row => ({ id: productId(product), name: product.name, unit: product.unit || 'piece', expected: product.currentStock, counted, reason: '' })
const fromCount = (count: StockCount): Row[] => count.items.map((item) => ({ id: item.productId, name: item.name, unit: item.unit, expected: item.expectedQuantity, counted: String(item.countedQuantity), reason: item.reason, stockNow: item.stockNow ?? null, moved: item.movedSinceCount ?? null }))
const difference = (row: Row) => { const counted = parseWhole(row.counted); return counted === null ? null : counted - row.expected }
/** After applying, would this product's stock go below zero? (The server refuses that, so the review points it out first.) */
const wouldGoNegative = (row: Row) => { const diff = difference(row); return diff !== null && row.stockNow != null && row.stockNow + diff < 0 }

/** Count what is really on the shelf, review the differences with the system, and only then adjust stock. */
export function CountTab({ onChanged }: { onChanged: () => void }) {
  const [mode, setMode] = useState<Mode>('list')
  const [lists, setLists] = useState<{ open: CountSummary[]; applied: CountSummary[] } | { error: string } | null>(null)
  const [listAttempt, setListAttempt] = useState(0)
  const [countId, setCountId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [categories, setCategories] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [lastAdded, setLastAdded] = useState('')
  const [onlyDifferences, setOnlyDifferences] = useState(true)
  const [confirmApply, setConfirmApply] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  // True while there are changes that have not been saved yet.
  const [dirty, setDirty] = useState(false)
  const [done, setDone] = useState('')
  const inFlight = useRef(false)
  const query = search.trim()
  const found = useProductMatches(query)

  useEffect(() => {
    let active = true
    Promise.all([inventoryApi.listCounts('open'), inventoryApi.listCounts('applied'), inventoryApi.listProducts({ limit: 1 })])
      .then(([open, applied, page]) => { if (active) { setLists({ open: open.counts, applied: applied.counts.slice(0, 5) }); setCategories(page.categories) } })
      .catch((caught: unknown) => { if (active) setLists({ error: messageOf(caught, 'Your counts could not be loaded.') }) })
    return () => { active = false }
  }, [listAttempt])

  const reloadList = () => { setLists(null); setListAttempt((count) => count + 1) }

  // --- adding products to the count
  const addProduct = (product: ProductRecord, fromScan: boolean) => {
    const id = productId(product)
    setSearch('')
    setError('')
    setDirty(true)
    setRows((current) => {
      const existing = current.find((row) => row.id === id)
      if (existing) return current.map((row) => row === existing ? { ...row, counted: String((parseWhole(row.counted) ?? 0) + (fromScan ? 1 : 0)) } : row)
      if (current.length >= MAX_ROWS) return current
      return [...current, toRow(product, fromScan ? '1' : '')]
    })
    setLastAdded(id)
    setMessage(fromScan ? `${product.name}: counted +1.` : `${product.name} added. Enter how many you see.`)
  }

  const handleScan = async (code: string) => {
    setMessage('')
    try {
      const lookup = await inventoryApi.lookupBarcode(code)
      if (lookup.found) addProduct(lookup.product, true)
      else setMessage(lookup.archived ? `“${lookup.archived.name}” uses this barcode but was archived. Restore it in the Stock tab to count it.` : `No product has barcode ${code}. Add it in the Stock tab, then count it.`)
    } catch (caught) {
      setMessage(messageOf(caught, 'The barcode could not be looked up. You can search by name instead.'))
    }
  }

  const addCategory = async () => {
    if (!category || busy) return
    setBusy(true)
    setError('')
    try {
      const added: ProductRecord[] = []
      for (let page = 1; page <= 5; page += 1) {
        const result = await inventoryApi.listProducts({ category, page, limit: 100 })
        added.push(...result.products)
        if (page * 100 >= result.pagination.total) break
      }
      let skipped = 0
      setDirty(true)
      setRows((current) => {
        const known = new Set(current.map((row) => row.id))
        const fresh = added.filter((product) => !known.has(productId(product)))
        const room = Math.max(0, MAX_ROWS - current.length)
        skipped = Math.max(0, fresh.length - room)
        return [...current, ...fresh.slice(0, room).map((product) => toRow(product, ''))]
      })
      setMessage(`Added the products in ${category}.${skipped ? ` ${skipped} did not fit (a count holds up to ${MAX_ROWS} products).` : ''}`)
      setCategory('')
    } catch (caught) {
      setError(messageOf(caught, 'That category could not be loaded.'))
    } finally {
      setBusy(false)
    }
  }

  const change = (id: string, patch: Partial<Row>) => { setDirty(true); setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row)); setError('') }

  // --- saving, reviewing, applying
  const payload = (): CountInput[] | string => {
    const items: CountInput[] = []
    for (const row of rows) {
      if (row.counted.trim() === '') continue
      const counted = parseWhole(row.counted)
      if (counted === null) return `${row.name}: the counted quantity must be a whole number of zero or more.`
      items.push({ productId: row.id, countedQuantity: counted, ...(row.reason && counted !== row.expected ? { reason: row.reason } : {}) })
    }
    return items
  }

  const save = async (): Promise<StockCount | null> => {
    if (inFlight.current) return null
    const items = payload()
    if (typeof items === 'string') { setError(items); return null }
    inFlight.current = true
    setBusy(true)
    setError('')
    try {
      const response = countId ? await inventoryApi.saveCount(countId, items, name.trim() || undefined) : await inventoryApi.createCount(items, name.trim() || undefined)
      setCountId(response.count.id)
      setName(response.count.name)
      setDirty(false)
      // Products without a counted number yet stay on screen; saved ones take the server's figures.
      const saved = new Map(fromCount(response.count).map((row) => [row.id, row]))
      setRows((current) => current.map((row) => saved.get(row.id) ?? row))
      return response.count
    } catch (caught) {
      setError(messageOf(caught, 'The count could not be saved.'))
      return null
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const saveProgress = async () => {
    const saved = await save()
    if (saved) { setMessage(`Saved ${plural(saved.items.length, 'product')}. Stock has not changed yet.`); onChanged() }
  }

  const review = async () => {
    const items = payload()
    if (typeof items !== 'string' && items.length === 0) { setError('Enter a counted quantity for at least one product.'); return }
    const saved = await save()
    if (saved) { setMode('review'); setMessage('') }
  }

  const apply = async () => {
    if (!countId || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setConfirmApply(false)
    setError('')
    try {
      const response = await inventoryApi.applyCount(countId)
      setDone(response.message)
      setMode('done')
      onChanged()
      reloadList()
    } catch (caught) {
      // Nothing was changed. The count stays open so it can be corrected and applied again.
      setError(messageOf(caught, 'The count could not be applied.'))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const discard = async () => {
    if (!countId) { backToList(); return }
    setBusy(true)
    try { await inventoryApi.discardCount(countId); setConfirmDiscard(false); backToList() } catch (caught) { setError(messageOf(caught, 'The count could not be discarded.')); setConfirmDiscard(false) } finally { setBusy(false) }
  }

  const backToList = () => { setDirty(false); setConfirmLeave(false); setMode('list'); setCountId(null); setRows([]); setName(''); setMessage(''); setError(''); setDone(''); reloadList() }
  const startNew = () => { setDirty(false); setCountId(null); setRows([]); setName(''); setMessage(''); setError(''); setMode('count') }
  const open = async (id: string) => {
    setBusy(true)
    setError('')
    try {
      const { count } = await inventoryApi.getCount(id)
      setCountId(count.id); setName(count.name); setRows(fromCount(count)); setDirty(false); setMessage(''); setMode('count')
    } catch (caught) {
      setError(messageOf(caught, 'That count could not be opened.'))
    } finally {
      setBusy(false)
    }
  }

  // --- views
  if (mode === 'list') {
    return <div className="inv-count">
      <div className="inv-count-head"><div><h3>Stock counts</h3><p className="inv-hint">Count what is on the shelf, review the differences, then apply them. Saving a count never changes stock by itself.</p></div><button type="button" className="price-primary" onClick={startNew}>Start a new count</button></div>
      {error && <p className="price-form-error" role="alert">{error}</p>}
      {!lists && <p className="inv-empty" role="status">Loading counts…</p>}
      {lists && 'error' in lists && <div className="price-error" role="alert">{lists.error} <button type="button" className="price-secondary" onClick={reloadList}>Try again</button></div>}
      {lists && 'open' in lists && <>
        <h4>In progress</h4>
        {lists.open.length === 0 ? <p className="inv-empty">No counts in progress.</p> : <ul className="inv-counts">{lists.open.map((count) => <li key={count.id}><span><strong>{count.name}</strong><small>{plural(count.itemCount, 'product')} counted · {plural(count.discrepancies, 'difference')} · saved {new Date(count.updatedAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}</small></span><button type="button" className="price-secondary" onClick={() => void open(count.id)} disabled={busy} aria-label={`Continue ${count.name}`}>Continue</button></li>)}</ul>}
        {lists.applied.length > 0 && <><h4>Recently applied</h4><ul className="inv-counts">{lists.applied.map((count) => <li key={count.id}><span><strong>{count.name}</strong><small>{plural(count.itemCount, 'product')} · {plural(count.discrepancies, 'difference')} · applied {count.appliedAt ? new Date(count.appliedAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) : ''}</small></span></li>)}</ul></>}
      </>}
    </div>
  }

  if (mode === 'done') {
    return <div className="inv-count"><div className="inv-done" role="status"><h3>Count applied</h3><p>{done}</p><div className="inv-quick-actions"><button type="button" className="price-primary" onClick={backToList}>Back to counts</button></div></div></div>
  }

  const counted = rows.filter((row) => row.counted.trim() !== '')
  const withDifference = counted.filter((row) => difference(row) !== 0)

  if (mode === 'review') {
    const shortage = withDifference.reduce((sum, row) => sum + Math.max(0, -(difference(row) ?? 0)), 0)
    const surplus = withDifference.reduce((sum, row) => sum + Math.max(0, difference(row) ?? 0), 0)
    const moved = counted.filter((row) => row.moved)
    const blocked = counted.filter(wouldGoNegative)
    const shown = onlyDifferences ? withDifference : counted
    return <div className="inv-count">
      <section aria-label="Review count">
        <h3>Review {name}</h3>
        <div className="inv-summary"><span><strong>{counted.length}</strong> counted</span><span><strong>{counted.length - withDifference.length}</strong> match</span><span className="inv-minus"><strong>{shortage}</strong> short</span><span className="inv-plus"><strong>{surplus}</strong> extra</span></div>
        {moved.length > 0 && <p className="price-review-note" role="status">{plural(moved.length, 'product')} had sales or deliveries since {moved.length === 1 ? 'it was' : 'they were'} counted. The difference is added to today’s stock, so those changes are kept, not overwritten.</p>}
        {blocked.length > 0 && <p className="price-form-error" role="alert">{blocked.map((row) => row.name).join(', ')} would go below zero. Go back and recount {blocked.length === 1 ? 'it' : 'them'} before applying.</p>}
        <label className="inv-check"><input type="checkbox" checked={onlyDifferences} onChange={(event) => setOnlyDifferences(event.target.checked)} /> Show only differences</label>
        {shown.length === 0 ? <p className="inv-empty">{withDifference.length === 0 ? 'Everything you counted matches the system. Applying will not change any stock.' : 'Nothing to show.'}</p>
          : <table className="inv-table"><thead><tr><th>Product</th><th>System</th><th>Counted</th><th>Difference</th><th>Stock now</th><th>Reason</th></tr></thead><tbody>
            {shown.map((row) => { const diff = difference(row) ?? 0; return <tr key={row.id} className={wouldGoNegative(row) ? 'inv-bad' : ''}>
              <td>{row.name}</td><td>{row.expected}</td><td>{row.counted}</td>
              <td className={diff < 0 ? 'inv-minus' : diff > 0 ? 'inv-plus' : ''}>{diff > 0 ? '+' : ''}{diff}</td>
              <td>{row.stockNow ?? '—'}{row.moved ? <small>{row.moved > 0 ? '+' : ''}{row.moved} since counted</small> : null}</td>
              <td>{diff !== 0 ? row.reason || '—' : ''}</td>
            </tr> })}
          </tbody></table>}
        {error && <p className="price-form-error" role="alert">{error}</p>}
        <div className="inv-quick-actions">
          <button type="button" className="price-secondary" onClick={() => { setMode('count'); setError('') }} disabled={busy}>Back to counting</button>
          <button type="button" className="price-primary" onClick={() => setConfirmApply(true)} disabled={busy || blocked.length > 0}>{withDifference.length ? `Apply ${plural(withDifference.length, 'adjustment')}` : 'Finish count'}</button>
        </div>
      </section>
      {confirmApply && <ConfirmDialog title="Apply this count?" confirmLabel={busy ? 'Applying…' : withDifference.length ? `Apply ${plural(withDifference.length, 'adjustment')}` : 'Finish count'} busy={busy} onCancel={() => setConfirmApply(false)} onConfirm={() => void apply()}>
        <p>{withDifference.length ? `Stock will change for ${plural(withDifference.length, 'product')}: ${shortage} removed and ${surplus} added. Each change is written to the stock history, and you can correct a mistake with another count.` : 'No stock will change. The count will be closed.'}</p>
      </ConfirmDialog>}
    </div>
  }

  return <div className="inv-count">
    <div className="inv-count-head"><label className="inv-count-name">Count name<input value={name} maxLength={80} onChange={(event) => { setName(event.target.value); setDirty(true) }} placeholder="e.g. Back shelf" /></label><button type="button" className="price-secondary" onClick={() => { if (dirty) setConfirmLeave(true); else backToList() }}>Close</button></div>
    <ScanBox label="Add a product to count" value={search} onChange={setSearch} onScan={(code) => void handleScan(code)} onSubmitText={() => { if (found.products.length === 1) addProduct(found.products[0]!, false) }} continuous placeholder="Scan, or search by name, SKU or barcode" hint="Each scan counts one more of that product. Or type the total yourself." />
    {found.products.length > 0 && <ul className="inv-results" aria-label="Matching products">{found.products.map((product) => <li key={productId(product)}><span><strong>{product.name}</strong><small>{product.category}</small></span><button type="button" className="price-secondary" onClick={() => addProduct(product, false)} aria-label={`Count ${product.name}`}>Count</button></li>)}</ul>}
    {found.loaded && !found.failed && found.products.length === 0 && <p className="inv-hint">No product matches “{query}”.</p>}
    {categories.length > 0 && <div className="inv-category-add"><label>Count a whole category<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">Choose a category</option>{categories.map((item) => <option key={item}>{item}</option>)}</select></label><button type="button" className="price-secondary" onClick={() => void addCategory()} disabled={!category || busy}>Add its products</button></div>}
    <div className="inv-live" role="status" aria-live="polite">{message && <p className="inv-hint">{message}</p>}</div>

    {rows.length === 0 ? <div className="inv-empty"><p><strong>Nothing to count yet.</strong></p><p>Scan or search for products, or add a whole category.</p></div>
      : <ul className="inv-lines" aria-label="Products being counted">{rows.map((row) => { const diff = difference(row); return <li key={row.id} className="inv-line inv-count-row">
        <div className="inv-line-head"><strong>{row.name}</strong><span className="inv-meta">System: {plural(row.expected, row.unit, unitWord(row.unit, 2))}</span><button type="button" className="inv-link" onClick={() => { setDirty(true); setRows((current) => current.filter((entry) => entry.id !== row.id)) }} aria-label={`Remove ${row.name} from count`}>Remove</button></div>
        <div className="inv-line-fields">
          <label>Counted<input inputMode="numeric" autoComplete="off" autoFocus={lastAdded === row.id && row.counted === ''} value={row.counted} onChange={(event) => change(row.id, { counted: event.target.value })} aria-label={`Counted quantity for ${row.name}`} /></label>
          <p className={`inv-diff ${diff === null ? '' : diff < 0 ? 'inv-minus' : diff > 0 ? 'inv-plus' : ''}`} aria-label={`Difference for ${row.name}`}>{diff === null ? (row.counted.trim() ? 'Not a whole number' : '—') : diff === 0 ? 'Matches' : `${diff > 0 ? '+' : ''}${diff}`}</p>
          {diff !== null && diff !== 0 && <label>Reason (optional)<select value={row.reason} onChange={(event) => change(row.id, { reason: event.target.value })} aria-label={`Reason for ${row.name}`}><option value="">No reason</option>{COUNT_REASONS.map((reason) => <option key={reason}>{reason}</option>)}</select></label>}
        </div>
      </li> })}</ul>}

    {error && <p className="price-form-error" role="alert">{error}</p>}
    {rows.length > 0 && <div className="inv-quick-actions">
      <button type="button" className="price-delete" onClick={() => setConfirmDiscard(true)} disabled={busy}>Discard count</button>
      <button type="button" className="price-secondary" onClick={() => void saveProgress()} disabled={busy}>{busy ? 'Saving…' : 'Save progress'}</button>
      <button type="button" className="price-primary" onClick={() => void review()} disabled={busy}>Review differences</button>
    </div>}
    {confirmLeave && <ConfirmDialog title="Leave without saving?" confirmLabel="Leave without saving" danger busy={busy} onCancel={() => setConfirmLeave(false)} onConfirm={backToList}><p>Changes since your last save will be lost. Choose Cancel, then Save progress, to keep them.</p></ConfirmDialog>}
    {confirmDiscard && <ConfirmDialog title="Discard this count?" confirmLabel="Discard count" danger busy={busy} onCancel={() => setConfirmDiscard(false)} onConfirm={() => void discard()}><p>The counted quantities will be thrown away. Stock does not change.</p></ConfirmDialog>}
  </div>
}

function ConfirmDialog({ title, children, confirmLabel, danger, busy, onCancel, onConfirm }: { title: string; children: React.ReactNode; confirmLabel: string; danger?: boolean; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  useEscapeKey(true, onCancel)
  return <div className="price-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
    <div className="price-confirm" role="alertdialog" aria-modal="true" aria-labelledby="inv-confirm-title">
      <h3 id="inv-confirm-title">{title}</h3>
      {children}
      <div className="price-modal-actions"><button type="button" className="price-secondary" onClick={onCancel} disabled={busy}>Cancel</button><button type="button" className={danger ? 'price-delete confirm' : 'price-primary'} onClick={onConfirm} disabled={busy}>{confirmLabel}</button></div>
    </div>
  </div>
}
