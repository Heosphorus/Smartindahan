import { useCallback, useEffect, useMemo, useState } from 'react'

import { storeApi, type ProductRecord } from '../../services/storeApi'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { lookupPublicProduct } from '../../services/openFoodFacts'
import { BarcodeCameraScanner } from '../pos/BarcodeCameraScanner'
import './PriceListPage.css'
import './PriceListRedesign.css'
import '../pos/POSFlow.css'

const PAGE_SIZE = 10
const API_PAGE_SIZE = 100
const blankForm = { name: '', category: '', brand: '', barcode: '', costPrice: '', sellingPrice: '', currentStock: '', minStock: '', unit: 'piece' }
type ProductForm = typeof blankForm
type EditorState = { product?: ProductRecord; form: ProductForm; visible: boolean }
type BulkState = { names: string; category: string; unit: string }
type StockFilter = 'all' | 'in-stock' | 'low-stock' | 'out-of-stock'
type SortField = 'name' | 'category' | 'costPrice' | 'sellingPrice' | 'profit' | 'currentStock'

const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })
const formatPeso = (value: number) => peso.format(value)
const isValidNumber = (value: string) => value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0

function toForm(product?: ProductRecord): ProductForm {
  return product ? {
    name: product.name,
    category: product.category,
    brand: product.brand ?? '',
    barcode: product.barcode ?? '',
    costPrice: String(product.costPrice ?? ''),
    sellingPrice: String(product.sellingPrice ?? ''),
    currentStock: String(product.currentStock ?? ''),
    minStock: String(product.minStock ?? ''),
    unit: product.unit ?? 'piece',
  } : { ...blankForm }
}

function stockStatus(product: ProductRecord): Exclude<StockFilter, 'all'> {
  if (product.currentStock <= 0) return 'out-of-stock'
  if (product.currentStock <= product.minStock) return 'low-stock'
  return 'in-stock'
}

function stockLabel(status: Exclude<StockFilter, 'all'>) {
  return status === 'in-stock' ? 'In Stock' : status === 'low-stock' ? 'Low Stock' : 'Out of Stock'
}

function displayPrice(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? formatPeso(value) : 'Review required'
}

function ProductEditor({ value, title, isSaving, error, onCancel, onClose, onSave }: {
  value: ProductForm
  title: string
  isSaving: boolean
  error: string
  onCancel: () => void
  onClose: (value: ProductForm) => void
  onSave: (value: ProductForm) => void
}) {
  const [form, setForm] = useState(value)
  const [validationError, setValidationError] = useState('')
  const [barcodeLookupMessage, setBarcodeLookupMessage] = useState('')
  const [isLookingUpBarcode, setIsLookingUpBarcode] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  useEscapeKey(!cameraOpen, onCancel)

  const update = (field: keyof ProductForm, next: string) => {
    setForm((current) => ({ ...current, [field]: next }))
    setValidationError('')
  }

  const handleBarcodeLookup = async () => {
    const barcode = form.barcode.trim()
    if (!barcode) {
      setBarcodeLookupMessage('Enter or scan a barcode first.')
      return
    }
    setIsLookingUpBarcode(true)
    setBarcodeLookupMessage('Looking up product details…')
    try {
      const details = await lookupPublicProduct(barcode)
      if (!details) {
        setBarcodeLookupMessage('No public details found. You can still enter the product details manually.')
        return
      }
      setForm((current) => ({
        ...current,
        name: details.name || current.name,
        brand: details.brand || current.brand,
        category: details.category || current.category,
      }))
      setBarcodeLookupMessage('Product details filled in. Review them and enter your store prices and stock.')
    } catch (error) {
      setBarcodeLookupMessage(error instanceof Error ? error.message : 'Could not look up public product details.')
    } finally {
      setIsLookingUpBarcode(false)
    }
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!form.name.trim() || !form.category.trim() || !form.unit.trim()) {
      setValidationError('Enter a product name, category, and unit.')
      return
    }
    if (!isValidNumber(form.costPrice) || !isValidNumber(form.sellingPrice)) {
      setValidationError('Enter valid, non-negative cost and selling prices.')
      return
    }
    if (form.currentStock !== '' && (!isValidNumber(form.currentStock) || !Number.isInteger(Number(form.currentStock)))) {
      setValidationError('Stock quantity must be a non-negative whole number.')
      return
    }
    if (form.minStock !== '' && (!isValidNumber(form.minStock) || !Number.isInteger(Number(form.minStock)))) {
      setValidationError('Minimum stock must be a non-negative whole number.')
      return
    }
    onSave(form)
  }

  const priceNeedsReview = Number(form.costPrice) === 0 || Number(form.sellingPrice) === 0

  return <div className="price-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
    <form className="price-modal" onSubmit={handleSubmit} noValidate>
      <div className="price-modal-header">
        <div><p className="price-eyebrow">PRODUCT CATALOG</p><h3>{title}</h3></div>
        <button type="button" className="price-close" onClick={() => onClose(form)} aria-label="Close product form">&times;</button>
      </div>
      <div className="price-form-grid">
        <label><span>Product name <span className="required-mark" aria-hidden="true">*</span></span><input autoFocus autoComplete="off" value={form.name} onChange={(event) => update('name', event.target.value)} required /></label>
        <label><span>Category <span className="required-mark" aria-hidden="true">*</span></span><input value={form.category} onChange={(event) => update('category', event.target.value)} placeholder="e.g. Beverages" required /></label>
        <label>Brand<input value={form.brand} onChange={(event) => update('brand', event.target.value)} /></label>
        {title === 'Add product' ? <div className="price-barcode-field"><label htmlFor="price-product-barcode">Barcode</label><input id="price-product-barcode" inputMode="numeric" autoComplete="off" maxLength={64} value={form.barcode} onChange={(event) => update('barcode', event.target.value)} /><div className="price-barcode-actions"><button type="button" className="price-secondary" onClick={() => setCameraOpen(true)} disabled={isSaving}>Scan barcode</button><button type="button" className="price-secondary" onClick={() => void handleBarcodeLookup()} disabled={isLookingUpBarcode || isSaving}>{isLookingUpBarcode ? 'Looking up…' : 'Fill from barcode'}</button></div>{barcodeLookupMessage && <p className="price-barcode-message" role="status">{barcodeLookupMessage}</p>}</div> : <label>Barcode<input inputMode="numeric" autoComplete="off" maxLength={64} value={form.barcode} onChange={(event) => update('barcode', event.target.value)} /></label>}
        <label><span>Cost per unit (PHP) <span className="required-mark" aria-hidden="true">*</span></span><input type="number" min="0" step="0.01" inputMode="decimal" value={form.costPrice} onChange={(event) => update('costPrice', event.target.value)} required /></label>
        <label><span>Selling price (PHP) <span className="required-mark" aria-hidden="true">*</span></span><input type="number" min="0" step="0.01" inputMode="decimal" value={form.sellingPrice} onChange={(event) => update('sellingPrice', event.target.value)} required /></label>
        <label>Current stock<input type="number" min="0" step="1" inputMode="numeric" value={form.currentStock} onChange={(event) => update('currentStock', event.target.value)} /></label>
        <label>Low stock alert at<input type="number" min="0" step="1" inputMode="numeric" value={form.minStock} onChange={(event) => update('minStock', event.target.value)} /></label>
        <label><span>Unit <span className="required-mark" aria-hidden="true">*</span></span><input value={form.unit} onChange={(event) => update('unit', event.target.value)} required /></label>
      </div>
      {priceNeedsReview && <p className="price-review-note" role="status">A zero cost or selling price is allowed, but review it before saving if it was entered by mistake.</p>}
      {validationError && <p className="price-form-error" role="alert">{validationError}</p>}
      {error && <p className="price-form-error" role="alert">{error}</p>}
      <div className="price-modal-actions">
        <button type="button" className="price-secondary" onClick={onCancel} disabled={isSaving}>Cancel</button>
        <button type="submit" className="price-primary" disabled={isSaving}>{isSaving ? 'Saving…' : title === 'Add product' ? 'Add product' : 'Save changes'}</button>
      </div>
      {cameraOpen && <BarcodeCameraScanner onDetected={(barcode) => { update('barcode', barcode); setBarcodeLookupMessage('Barcode scanned. Select “Fill from barcode” to look up product details.'); setCameraOpen(false) }} onClose={() => setCameraOpen(false)} />}
    </form>
  </div>
}

function ProductDeleteDialog({ product, isDeleting, error, onCancel, onConfirm }: { product: ProductRecord; isDeleting: boolean; error: string; onCancel: () => void; onConfirm: () => void }) {
  useEscapeKey(true, onCancel)
  return <div className="price-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
    <div className="price-confirm" role="alertdialog" aria-modal="true" aria-labelledby="archive-product-title">
      <h3 id="archive-product-title">Archive product?</h3>
      <p><strong>{product.name}</strong> will be removed from the active price list. Existing sales records are preserved.</p>
      {error && <p className="price-form-error" role="alert">{error}</p>}
      <div className="price-modal-actions"><button type="button" className="price-secondary" onClick={onCancel} disabled={isDeleting}>Cancel</button><button type="button" className="price-delete confirm" onClick={onConfirm} disabled={isDeleting}>{isDeleting ? 'Archiving…' : 'Archive product'}</button></div>
    </div>
  </div>
}

function BulkProductDialog({ categories, isSaving, error, onCancel, onSave }: { categories: string[]; isSaving: boolean; error: string; onCancel: () => void; onSave: (value: BulkState) => void }) {
  const [names, setNames] = useState('')
  const [category, setCategory] = useState('')
  const [customCategory, setCustomCategory] = useState('')
  const [unit, setUnit] = useState('piece')
  const [showPreview, setShowPreview] = useState(false)
  const [validationError, setValidationError] = useState('')
  useEscapeKey(true, onCancel)

  const preparedNames = useMemo(() => {
    const seen = new Set<string>()
    return names.split(/\r?\n/).map((name) => name.trim()).filter((name) => {
      const normalized = name.toLocaleLowerCase()
      if (!normalized || seen.has(normalized)) return false
      seen.add(normalized)
      return true
    })
  }, [names])
  const categoryName = category === '__new__' ? customCategory.trim() : category.trim()
  const duplicateCount = names.split(/\r?\n/).map((name) => name.trim()).filter(Boolean).length - preparedNames.length

  const reviewImport = () => {
    if (!preparedNames.length || !categoryName || !unit.trim()) {
      setValidationError('Enter at least one product name, choose a category, and provide a unit.')
      return
    }
    setValidationError('')
    setShowPreview(true)
  }

  return <div className="price-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
    <div className="price-modal bulk-modal" role="dialog" aria-modal="true" aria-labelledby="bulk-products-title">
      <div className="price-modal-header"><div><p className="price-eyebrow">QUICK CATALOG SETUP</p><h3 id="bulk-products-title">{showPreview ? 'Review products' : 'Bulk add products'}</h3></div><button type="button" className="price-close" onClick={onCancel} aria-label="Close bulk product form">&times;</button></div>
      {!showPreview ? <>
        <p className="bulk-help">Enter one product name per line. New products start with zero prices and stock so you can update those values after import.</p>
        <label>Category<select value={category} onChange={(event) => setCategory(event.target.value)} required><option value="">Select a category</option>{categories.filter((item) => item !== 'All').map((item) => <option key={item} value={item}>{item}</option>)}<option value="__new__">Add a new category</option></select></label>
        {category === '__new__' && <label>New category<input value={customCategory} onChange={(event) => setCustomCategory(event.target.value)} required /></label>}
        <label>Product names<textarea rows={8} value={names} onChange={(event) => { setNames(event.target.value); setValidationError('') }} placeholder={'Canned sardines\nInstant noodles\nBottled water'} required /></label>
        <label>Unit<input value={unit} onChange={(event) => setUnit(event.target.value)} /></label>
        {duplicateCount > 0 && <p className="price-review-note" role="status">{duplicateCount} duplicate name{duplicateCount === 1 ? '' : 's'} will be skipped.</p>}
        {validationError && <p className="price-form-error" role="alert">{validationError}</p>}
        {error && <p className="price-form-error" role="alert">{error}</p>}
        <div className="price-modal-actions"><button type="button" className="price-secondary" onClick={onCancel}>Cancel</button><button type="button" className="price-primary" onClick={reviewImport}>Preview {preparedNames.length} products</button></div>
      </> : <>
        <p className="bulk-help">Confirm the category and names before adding these products. Prices and stock will be zero until you edit each product.</p>
        <div className="bulk-preview-summary"><strong>{preparedNames.length} products</strong><span>Category: {categoryName}</span><span>Unit: {unit.trim()}</span></div>
        <ul className="bulk-preview-list">{preparedNames.map((name) => <li key={name}><span>{name}</span><span>Price needs review</span></li>)}</ul>
        {validationError && <p className="price-form-error" role="alert">{validationError}</p>}
        {error && <p className="price-form-error" role="alert">{error}</p>}
        <div className="price-modal-actions"><button type="button" className="price-secondary" onClick={() => setShowPreview(false)} disabled={isSaving}>Back to edit</button><button type="button" className="price-primary" disabled={isSaving} onClick={() => onSave({ names: preparedNames.join('\n'), category: categoryName, unit: unit.trim() })}>{isSaving ? 'Adding…' : 'Add ' + preparedNames.length + ' products'}</button></div>
      </>}
    </div>
  </div>
}

export function PriceListPage() {
  const [products, setProducts] = useState<ProductRecord[]>([])
  const [category, setCategory] = useState('All')
  const [stockFilter, setStockFilter] = useState<StockFilter>('all')
  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(1)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [bulk, setBulk] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ProductRecord | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isBulkSaving, setIsBulkSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setIsLoading(true)
    setError('')
    try {
      const first = await storeApi.products(1, API_PAGE_SIZE)
      const pageCount = Math.ceil(first.pagination.total / first.pagination.limit)
      const remaining = await Promise.all(Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) => storeApi.products(index + 2, API_PAGE_SIZE)))
      setProducts([...first.products, ...remaining.flatMap((result) => result.products)])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load the price list.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
  }, [load])
  useEffect(() => {
    if (!notice) return undefined
    const timer = window.setTimeout(() => setNotice(''), 4000)
    return () => window.clearTimeout(timer)
  }, [notice])

  const categories = useMemo(() => ['All', ...Array.from(new Set(products.map((product) => product.category.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b))], [products])
  const summary = useMemo(() => products.reduce((result, product) => {
    const status = stockStatus(product)
    result.lowStock += status === 'low-stock' ? 1 : 0
    result.outOfStock += status === 'out-of-stock' ? 1 : 0
    result.inventoryValue += typeof product.costPrice === 'number' && Number.isFinite(product.costPrice) ? product.costPrice * product.currentStock : 0
    return result
  }, { lowStock: 0, outOfStock: 0, inventoryValue: 0 }), [products])

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    const matching = products.filter((product) => {
      const matchesCategory = category === 'All' || product.category === category
      const matchesStatus = stockFilter === 'all' || stockStatus(product) === stockFilter
      const matchesSearch = !query || [product.name, product.barcode, product.sku, product.brand].some((value) => value?.toLocaleLowerCase().includes(query))
      return matchesCategory && matchesStatus && matchesSearch
    })
    return matching.sort((left, right) => {
      const leftValue = sortField === 'profit' ? left.sellingPrice - left.costPrice : left[sortField]
      const rightValue = sortField === 'profit' ? right.sellingPrice - right.costPrice : right[sortField]
      const order = typeof leftValue === 'string' && typeof rightValue === 'string'
        ? leftValue.localeCompare(rightValue, undefined, { sensitivity: 'base' })
        : Number(leftValue) - Number(rightValue)
      return order * (sortDirection === 'asc' ? 1 : -1)
    })
  }, [products, category, stockFilter, search, sortField, sortDirection])
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const visibleProducts = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  function chooseCategory(value: string) { setCategory(value); setPage(1) }
  function chooseStock(value: StockFilter) { setStockFilter(value); setPage(1) }
  function chooseSort(field: SortField) {
    setSortDirection((current) => field === sortField ? (current === 'asc' ? 'desc' : 'asc') : 'asc')
    setSortField(field)
  }
  function openEditor(product?: ProductRecord) {
    const sameProduct = editor && ((product?._id ?? product?.id ?? '') === (editor.product?._id ?? editor.product?.id ?? ''))
    setEditor({ product, form: sameProduct ? editor.form : toForm(product), visible: true })
  }

  async function save(form: ProductForm) {
    if (isSaving) return
    setIsSaving(true)
    setError('')
    const payload = {
      ...form,
      name: form.name.trim(),
      category: form.category.trim(),
      brand: form.brand.trim(),
      barcode: form.barcode.trim(),
      costPrice: Number(form.costPrice),
      sellingPrice: Number(form.sellingPrice),
      currentStock: form.currentStock === '' ? 0 : Number(form.currentStock),
      initialStock: form.currentStock === '' ? 0 : Number(form.currentStock),
      minStock: form.minStock === '' ? 0 : Number(form.minStock),
      unit: form.unit.trim(),
    }
    const wasEditing = Boolean(editor?.product)
    try {
      if (wasEditing) {
        const productId = editor?.product?._id ?? editor?.product?.id ?? ''
        const originalStock = editor?.product?.currentStock ?? 0
        await storeApi.updateProduct(productId, {
          name: payload.name, category: payload.category, brand: payload.brand, barcode: payload.barcode,
          costPrice: payload.costPrice, sellingPrice: payload.sellingPrice, minStock: payload.minStock, unit: payload.unit,
        })
        if (payload.currentStock !== originalStock) await storeApi.inventoryCount(productId, payload.currentStock)
      } else {
        await storeApi.addProduct(payload)
      }
      setEditor(null)
      setNotice(wasEditing ? 'Product details saved.' : 'Product added to the price list.')
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save the product.')
    } finally {
      setIsSaving(false)
    }
  }

  async function remove() {
    if (!deleteTarget || isDeleting) return
    setIsDeleting(true)
    setError('')
    try {
      await storeApi.deleteProduct(deleteTarget._id ?? deleteTarget.id ?? '')
      setDeleteTarget(null)
      setNotice('Product archived. Sales history is preserved.')
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to archive the product.')
    } finally {
      setIsDeleting(false)
    }
  }

  async function bulkSave(value: BulkState) {
    if (isBulkSaving) return
    setIsBulkSaving(true)
    setError('')
    try {
      const response = await storeApi.bulkAddProducts(value.names.split('\n'), value.category, value.unit)
      setBulk(false)
      setNotice(response.message)
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to add products.')
    } finally {
      setIsBulkSaving(false)
    }
  }

  function sortButton(label: string, field: SortField) {
    const active = sortField === field
    const sortStatus = active ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'
    return <button type="button" className="price-sort-button" onClick={() => chooseSort(field)} aria-label={'Sort by ' + label + (active ? ', ' + sortStatus : '')} aria-sort={sortStatus}>{label}{active && <span aria-hidden="true">{sortDirection === 'asc' ? ' ↑' : ' ↓'}</span>}</button>
  }

  return <section className="price-page">
    <div className="price-page-heading">
      <div><p className="price-eyebrow">INVENTORY MANAGEMENT</p><h2>Price List</h2><p>Manage products, monitor stock, and keep your shelf prices current.</p></div>
      <div className="price-heading-actions"><button className="price-secondary" type="button" onClick={() => setBulk(true)}>Bulk add</button><button className="price-primary" type="button" onClick={() => openEditor()}>Add product</button></div>
    </div>

    {notice && <div className="price-success" role="status">{notice}</div>}
    {error && <div className="price-error" role="alert"><span>{error}</span><button type="button" onClick={() => void load()}>Retry loading</button></div>}

    <div className="price-summary-grid" aria-label="Inventory summary">
      <article className="price-summary-card"><span>Total products</span><strong>{isLoading ? '—' : products.length.toLocaleString('en-PH')}</strong><small>Active products</small></article>
      <article className="price-summary-card"><span>Low stock</span><strong>{isLoading ? '—' : summary.lowStock.toLocaleString('en-PH')}</strong><small>Above zero, at or below alert threshold</small></article>
      <article className="price-summary-card"><span>Out of stock</span><strong>{isLoading ? '—' : summary.outOfStock.toLocaleString('en-PH')}</strong><small>Available quantity is zero</small></article>
      <article className="price-summary-card"><span>Inventory value</span><strong>{isLoading ? '—' : formatPeso(summary.inventoryValue)}</strong><small>At recorded cost per unit</small></article>
    </div>

    <section className="price-inventory-panel" aria-label="Product inventory">
      <div className="price-panel-heading"><div><h3>Products</h3><p>{filtered.length.toLocaleString('en-PH')} matching {filtered.length === 1 ? 'product' : 'products'}</p></div></div>
      <div className="price-filter-bar">
        <label className="price-search"><span>Search</span><input aria-label="Search products by name or barcode" placeholder="Name or barcode" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} /><button type="button" aria-label="Clear product search" onClick={() => { setSearch(''); setPage(1) }} disabled={!search}>Clear</button></label>
        <label className="price-filter"><span>Category</span><select value={category} onChange={(event) => chooseCategory(event.target.value)}>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label className="price-filter"><span>Stock status</span><select value={stockFilter} onChange={(event) => chooseStock(event.target.value as StockFilter)}><option value="all">All stock</option><option value="in-stock">In Stock</option><option value="low-stock">Low Stock</option><option value="out-of-stock">Out of Stock</option></select></label>
      </div>

      {isLoading ? <div className="price-state" role="status"><strong>Loading products…</strong><span>Getting the latest store inventory.</span></div>
        : error && products.length === 0 ? <div className="price-state"><strong>Products could not be loaded</strong><span>Use Retry loading to try again.</span></div>
          : products.length === 0 ? <div className="price-state"><strong>Your price list is empty</strong><span>Add a product to start tracking prices and stock.</span><button className="price-primary" type="button" onClick={() => openEditor()}>Add first product</button></div>
            : filtered.length === 0 ? <div className="price-state"><strong>No matching products</strong><span>Try another search or clear your filters.</span><button className="price-secondary" type="button" onClick={() => { setSearch(''); chooseCategory('All'); chooseStock('all') }}>Clear filters</button></div>
              : <div className="price-table-scroll"><table className="price-data-table">
                <thead><tr>
                  <th scope="col">{sortButton('Product', 'name')}</th><th scope="col">{sortButton('Category', 'category')}</th>
                  <th scope="col" className="numeric-cell">{sortButton('Cost / unit', 'costPrice')}</th><th scope="col" className="numeric-cell">{sortButton('Selling price', 'sellingPrice')}</th>
                  <th scope="col" className="numeric-cell">{sortButton('Potential gross profit', 'profit')}</th><th scope="col">{sortButton('Stock', 'currentStock')}</th><th scope="col">Status</th><th scope="col">Actions</th>
                </tr></thead>
                <tbody>{visibleProducts.map((product) => {
                  const status = stockStatus(product)
                  const hasCost = typeof product.costPrice === 'number' && Number.isFinite(product.costPrice)
                  const hasSellingPrice = typeof product.sellingPrice === 'number' && Number.isFinite(product.sellingPrice)
                  const priceFlag = !hasCost || !hasSellingPrice || product.costPrice === 0 || product.sellingPrice === 0
                  const profit = hasCost && hasSellingPrice ? formatPeso(product.sellingPrice - product.costPrice) : 'Review required'
                  return <tr key={product._id ?? product.id}>
                    <td className="product-name-cell"><strong>{product.name}</strong><small>{product.barcode ? 'Barcode: ' + product.barcode : 'No barcode recorded'}</small></td>
                    <td><span className="category-label">{product.category}</span></td>
                    <td className="numeric-cell">{displayPrice(product.costPrice)}</td>
                    <td className="numeric-cell">{displayPrice(product.sellingPrice)}{priceFlag && <small className="price-review-tag">Review price</small>}</td>
                    <td className="numeric-cell">{profit}<small>Potential gross per unit</small></td>
                    <td>{product.currentStock.toLocaleString('en-PH')} {product.unit || 'piece'}<small>Alert at {product.minStock}</small></td>
                    <td><span className={'stock-status ' + status}><i aria-hidden="true" />{stockLabel(status)}</span></td>
                    <td><div className="price-actions"><button type="button" onClick={() => openEditor(product)}>Edit</button><button type="button" className="price-delete" onClick={() => setDeleteTarget(product)}>Archive</button></div></td>
                  </tr>
                })}</tbody>
              </table></div>}

      {!isLoading && filtered.length > 0 && <div className="price-pagination"><span>Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}</span><div><button type="button" className="price-secondary" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={currentPage <= 1}>Previous</button><span>Page {currentPage} of {pageCount}</span><button type="button" className="price-secondary" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={currentPage >= pageCount}>Next</button></div></div>}
    </section>

    {editor?.visible && <ProductEditor key={editor.product?._id ?? editor.product?.id ?? 'new-product'} title={editor.product ? 'Edit product' : 'Add product'} value={editor.form} isSaving={isSaving} error={error} onCancel={() => setEditor(null)} onClose={(form) => setEditor((current) => current ? { ...current, form, visible: false } : current)} onSave={(form) => void save(form)} />}
    {bulk && <BulkProductDialog categories={categories} isSaving={isBulkSaving} error={error} onCancel={() => setBulk(false)} onSave={(value) => void bulkSave(value)} />}
    {deleteTarget && <ProductDeleteDialog product={deleteTarget} isDeleting={isDeleting} error={error} onCancel={() => setDeleteTarget(null)} onConfirm={() => void remove()} />}
  </section>
}
