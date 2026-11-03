import { useEffect, useRef, useState } from 'react'

import { inventoryApi, type ProductPage, type StatusFilter } from '../../services/inventoryApi'
import type { ProductRecord } from '../../services/storeApi'
import { NewProductDialog } from './NewProductDialog'
import { QuickAdd, QuickPrices, QuickRemove, StockHistory } from './StockActions'
import { ScanBox } from './ScanBox'
import { formatPeso, plural, productId, searchTextFor, STATUS_LABEL, stockStatusOf, unitWord } from './inventoryMath'

const PAGE_SIZE = 20
const SEARCH_DELAY_MS = 250

type PanelMode = 'add' | 'remove' | 'prices' | 'history'
type Scan = { kind: 'unknown'; barcode: string; message: string; archived?: { id: string; name: string } } | { kind: 'error'; message: string } | null

const STATUS_CHIPS: Array<{ value: StatusFilter; label: string }> = [{ value: 'all', label: 'All' }, { value: 'low', label: 'Low stock' }, { value: 'out', label: 'Out of stock' }]

/** Find products by name, SKU or barcode, filter by category and stock level, and change stock or prices with one tap. */
export function StockTab({ onRestock, refreshSignal = 0, autoRefreshSignal = 0 }: { onRestock: (product: ProductRecord) => void; /** Changes whenever stock was changed elsewhere (a delivery or a count), so this list reloads. */ refreshSignal?: number; autoRefreshSignal?: number }) {
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [sort, setSort] = useState<'name' | 'stock'>('name')
  const [page, setPage] = useState(1)
  const [reloads, setReloads] = useState(0)
  const [panel, setPanel] = useState<{ id: string; mode: PanelMode } | null>(null)
  const [highlight, setHighlight] = useState('')
  const [notice, setNotice] = useState('')
  const [scan, setScan] = useState<Scan>(null)
  const [scanBusy, setScanBusy] = useState(false)
  const [adding, setAdding] = useState<{ barcode: string } | null>(null)
  const [result, setResult] = useState<{ key: string; data?: ProductPage; error?: string } | null>(null)
  const highlightRef = useRef<HTMLLIElement | null>(null)

  // Wait for a pause in typing before asking the server, so a fast typist (or a scanner) makes one request, not one per key.
  useEffect(() => {
    const timer = window.setTimeout(() => { setQuery(search.trim()); setPage(1) }, SEARCH_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [search])

  const key = JSON.stringify([query, category, status, sort, page, reloads, refreshSignal, autoRefreshSignal])
  useEffect(() => {
    let active = true
    inventoryApi.listProducts({ q: query, category, status, sort, page, limit: PAGE_SIZE })
      .then((data) => { if (active) setResult({ key, data }) })
      .catch((caught: unknown) => { if (active) setResult((previous) => ({ key, ...(previous?.data ? { data: previous.data } : {}), error: caught instanceof Error ? caught.message : 'Products could not be loaded.' })) })
    return () => { active = false }
  }, [key, query, category, status, sort, page])

  useEffect(() => {
    if (!notice) return undefined
    const timer = window.setTimeout(() => setNotice(''), 6000)
    return () => window.clearTimeout(timer)
  }, [notice])
  useEffect(() => { highlightRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }) }, [highlight, result])

  const loading = result?.key !== key
  const data = result?.data
  const loadError = loading ? '' : result?.error ?? ''
  const refresh = () => setReloads((count) => count + 1)
  const summary = data?.summary
  const filtered = Boolean(query || category || status !== 'all')

  const clearFilters = () => { setSearch(''); setQuery(''); setCategory(''); setStatus('all'); setPage(1); setScan(null); setHighlight('') }
  const done = (message: string) => { setNotice(message); setPanel(null); refresh() }
  const toggle = (product: ProductRecord, mode: PanelMode) => setPanel((current) => current?.id === productId(product) && current.mode === mode ? null : { id: productId(product), mode })

  const handleScan = async (code: string) => {
    if (scanBusy) return
    setScanBusy(true)
    setScan(null)
    setNotice('')
    try {
      const found = await inventoryApi.lookupBarcode(code)
      if (found.found) {
        const text = searchTextFor(found.product)
        setSearch(text); setQuery(text); setCategory(''); setStatus('all'); setPage(1)
        setHighlight(productId(found.product))
        setNotice(`Found ${found.product.name}: ${plural(found.product.currentStock, found.product.unit || 'piece', unitWord(found.product.unit, 2))} in stock.`)
      } else {
        setSearch(code)
        setHighlight('')
        setScan({ kind: 'unknown', barcode: code, message: found.message, ...(found.archived ? { archived: found.archived } : {}) })
      }
    } catch (caught) {
      setScan({ kind: 'error', message: caught instanceof Error ? caught.message : 'The barcode could not be looked up.' })
    } finally {
      setScanBusy(false)
    }
  }

  const restoreArchived = async (archived: { id: string; name: string }, barcode: string) => {
    try {
      await inventoryApi.restoreProduct(archived.id)
      setScan(null)
      setNotice(`${archived.name} is back in your catalog.`)
      void handleScan(barcode)
    } catch (caught) {
      setScan({ kind: 'error', message: caught instanceof Error ? caught.message : 'The product could not be restored.' })
    }
  }

  const products = data?.products ?? []
  const total = data?.pagination.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return <div className="inv-stock">
    <div className="inv-chips" role="group" aria-label="Filter by stock level">
      {STATUS_CHIPS.map((chip) => {
        const count = summary ? (chip.value === 'all' ? summary.all : chip.value === 'low' ? summary.low : summary.out) : null
        return <button key={chip.value} type="button" className={`inv-chip${status === chip.value ? ' active' : ''}${chip.value !== 'all' && count ? ` attention ${chip.value}` : ''}`} aria-pressed={status === chip.value} onClick={() => { setStatus(chip.value); setPage(1) }}>{chip.label}{count !== null && <span className="inv-chip-count">{count}</span>}</button>
      })}
    </div>

    <div className="inv-toolbar">
      <ScanBox label="Search or scan a product" value={search} onChange={(value) => { setSearch(value); setScan(null) }} onScan={(code) => void handleScan(code)} placeholder="Name, SKU or barcode" hint="Scan with the camera or a USB scanner, or type a barcode and press Enter." autoFocus />
      <label className="inv-select">Category<select value={category} onChange={(event) => { setCategory(event.target.value); setPage(1) }}><option value="">All categories</option>{(data?.categories ?? []).map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
      <label className="inv-select">Sort by<select value={sort} onChange={(event) => { setSort(event.target.value as 'name' | 'stock'); setPage(1) }}><option value="name">Name</option><option value="stock">Lowest stock first</option></select></label>
      <button type="button" className="price-primary inv-add" onClick={() => setAdding({ barcode: '' })}>Add product</button>
    </div>

    <div className="inv-live" role="status" aria-live="polite">{notice && <p className="price-success">{notice}</p>}</div>

    {scan?.kind === 'unknown' && <div className="inv-scan-result" role="alert">
      <p><strong>{scan.archived ? 'Archived product' : 'New barcode'}</strong> · {scan.barcode}<br />{scan.archived ? scan.message : 'No product in your store has this barcode.'}</p>
      <div className="inv-quick-actions">
        <button type="button" className="price-secondary" onClick={() => { setScan(null); setSearch('') }}>Dismiss</button>
        {scan.archived ? <button type="button" className="price-primary" onClick={() => void restoreArchived(scan.archived!, scan.barcode)}>Restore {scan.archived.name}</button> : <button type="button" className="price-primary" onClick={() => setAdding({ barcode: scan.barcode })}>Add a product with this barcode</button>}
      </div>
    </div>}
    {scan?.kind === 'error' && <p className="price-form-error" role="alert">{scan.message} You can still type the barcode and press Enter.</p>}
    {scanBusy && <p className="inv-hint" role="status">Looking up barcode…</p>}

    {loadError && <div className="price-error" role="alert">{loadError} <button type="button" className="price-secondary" onClick={refresh}>Try again</button></div>}
    {loading && !data && <p className="inv-empty" role="status">Loading products…</p>}

    {data && products.length === 0 && !loadError && <div className="inv-empty">
      {filtered ? <><p><strong>No products match.</strong></p><p>Try a different word, or clear the filters.</p><button type="button" className="price-secondary" onClick={clearFilters}>Clear filters</button></>
        : <><p><strong>No products yet.</strong></p><p>Add your first product to start tracking stock.</p><button type="button" className="price-primary" onClick={() => setAdding({ barcode: '' })}>Add product</button></>}
    </div>}

    {products.length > 0 && <ul className={`inv-list${loading ? ' updating' : ''}`} aria-label="Products" aria-busy={loading}>
      {products.map((product) => {
        const id = productId(product)
        const level = stockStatusOf(product)
        const unit = product.unit || 'piece'
        const open = panel?.id === id ? panel.mode : null
        return <li key={id} ref={highlight === id ? highlightRef : undefined} className={`inv-row ${level}${highlight === id ? ' highlighted' : ''}`}>
          <div className="inv-row-main">
            <div className="inv-row-name">
              <strong>{product.name}</strong>
              <span className="inv-meta">{product.category}{product.brand ? ` · ${product.brand}` : ''}{product.barcode ? ` · ${product.barcode}` : ' · no barcode'}{product.sku ? ` · SKU ${product.sku}` : ''}</span>
            </div>
            <div className="inv-row-stock"><span className={`inv-badge ${level}`}>{STATUS_LABEL[level]}</span><strong>{product.currentStock} {unitWord(unit, product.currentStock)}</strong>{product.minStock > 0 && <small>alert at {product.minStock}</small>}</div>
            <div className="inv-row-price"><strong>{formatPeso(product.sellingPrice)}</strong><small>cost {formatPeso(product.costPrice)}</small></div>
          </div>
          <div className="inv-row-actions" role="group" aria-label={`Actions for ${product.name}`}>
            <button type="button" className="price-secondary" aria-pressed={open === 'add'} onClick={() => toggle(product, 'add')} aria-label={`Add stock to ${product.name}`}>+ Add stock</button>
            <button type="button" className="price-secondary" aria-pressed={open === 'remove'} onClick={() => toggle(product, 'remove')} disabled={product.currentStock <= 0} aria-label={`Remove stock from ${product.name}`}>− Remove</button>
            <button type="button" className="price-secondary" aria-pressed={open === 'prices'} onClick={() => toggle(product, 'prices')} aria-label={`Edit prices for ${product.name}`}>Prices</button>
            <button type="button" className="price-secondary" aria-pressed={open === 'history'} onClick={() => toggle(product, 'history')} aria-label={`Stock history for ${product.name}`}>History</button>
            {level !== 'ok' && <button type="button" className="price-primary" onClick={() => onRestock(product)} aria-label={`Restock ${product.name}`}>Restock</button>}
          </div>
          {open === 'add' && <QuickAdd product={product} onDone={done} onClose={() => setPanel(null)} />}
          {open === 'remove' && <QuickRemove product={product} onDone={done} onClose={() => setPanel(null)} />}
          {open === 'prices' && <QuickPrices product={product} onDone={done} onClose={() => setPanel(null)} />}
          {open === 'history' && <StockHistory product={product} onClose={() => setPanel(null)} />}
        </li>
      })}
    </ul>}

    {products.length > 0 && <nav className="inv-pager" aria-label="Pages">
      <span role="status">{(page - 1) * PAGE_SIZE + 1}–{(page - 1) * PAGE_SIZE + products.length} of {total}{loading ? ' · updating…' : ''}</span>
      <div><button type="button" className="price-secondary" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1}>Previous</button><button type="button" className="price-secondary" onClick={() => setPage((current) => current + 1)} disabled={page >= pageCount}>Next</button></div>
    </nav>}

    {adding && <NewProductDialog barcode={adding.barcode} categories={data?.categories ?? []} onCancel={() => setAdding(null)} onCreated={(product) => {
      setAdding(null); setScan(null)
      setNotice(`${product.name} was added.`)
      const text = searchTextFor(product)
      setSearch(text); setQuery(text); setCategory(''); setStatus('all'); setPage(1)
      setHighlight(productId(product))
      refresh()
    }} />}
  </div>
}
