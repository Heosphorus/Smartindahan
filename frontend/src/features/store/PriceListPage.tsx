import { useEffect, useMemo, useState } from 'react'

import { storeApi, type ProductRecord } from '../../services/storeApi'
import './PriceListPage.css'

const blankForm = { name: '', category: 'Beverages', brand: '', barcode: '', costPrice: '', sellingPrice: '', currentStock: '', minStock: '', unit: 'piece' }
type ProductForm = typeof blankForm
type EditorState = { product?: ProductRecord; form: ProductForm; visible: boolean }
type BulkState = { visible: boolean; names: string; category: string; unit: string }

const peso = (value: number) => `₱${value.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`

function toForm(product?: ProductRecord): ProductForm {
  return product ? {
    name: product.name,
    category: product.category,
    brand: product.brand ?? '',
    barcode: product.barcode ?? '',
    costPrice: String(product.costPrice),
    sellingPrice: String(product.sellingPrice),
    currentStock: String(product.currentStock),
    minStock: String(product.minStock),
    unit: product.unit ?? 'piece',
  } : { ...blankForm }
}

function ProductEditor({ value, title, onCancel, onClose, onChange, onSave }: { value: ProductForm; title: string; onCancel: () => void; onClose: (value: ProductForm) => void; onChange: (value: ProductForm) => void; onSave: (value: ProductForm) => void }) {
  const [form, setForm] = useState(value)
  const update = (field: keyof ProductForm, next: string) => {
    const updated = { ...form, [field]: next }
    setForm(updated)
    onChange(updated)
  }
  return <div className="price-modal-backdrop"><form className="price-modal" onSubmit={(event) => { event.preventDefault(); onSave(form) }}>
    <div className="price-modal-header"><div><p className="price-eyebrow">PRODUCT CATALOG</p><h3>{title}</h3></div><button type="button" className="price-close" onClick={() => onClose(form)} aria-label="Close">×</button></div>
    <div className="price-form-grid">
      <label><span className="field-label">Product name <span className="required-mark" aria-hidden="true">*</span></span><input value={form.name} onChange={(event) => update('name', event.target.value)} required /></label>
      <label><span className="field-label">Category <span className="required-mark" aria-hidden="true">*</span></span><input value={form.category} onChange={(event) => update('category', event.target.value)} placeholder="Beverages, Condiments..." required /></label>
      <label>Brand<input value={form.brand} onChange={(event) => update('brand', event.target.value)} /></label>
      <label>Barcode<input value={form.barcode} onChange={(event) => update('barcode', event.target.value)} /></label>
      <label><span className="field-label">Cost price <span className="required-mark" aria-hidden="true">*</span></span><input type="number" min="0" step="0.01" value={form.costPrice} onChange={(event) => update('costPrice', event.target.value)} required /></label>
      <label><span className="field-label">Selling price <span className="required-mark" aria-hidden="true">*</span></span><input type="number" min="0" step="0.01" value={form.sellingPrice} onChange={(event) => update('sellingPrice', event.target.value)} required /></label>
      <label><span className="field-label">Current stock</span><input type="number" min="0" step="1" value={form.currentStock} onChange={(event) => update('currentStock', event.target.value)} /></label>
      <label><span className="field-label">Minimum stock</span><input type="number" min="0" step="1" value={form.minStock} onChange={(event) => update('minStock', event.target.value)} /></label>
      <label><span className="field-label">Unit <span className="required-mark" aria-hidden="true">*</span></span><input value={form.unit} onChange={(event) => update('unit', event.target.value)} required /></label>
    </div>
    <div className="price-modal-actions"><button type="button" className="price-secondary" onClick={onCancel}>Cancel</button><button type="submit" className="price-primary">Save product</button></div>
  </form></div>
}

function ProductDeleteDialog({ product, onCancel, onConfirm }: { product: ProductRecord; onCancel: () => void; onConfirm: () => void }) {
  return <div className="price-modal-backdrop"><div className="price-confirm"><div className="price-warning">!</div><h3>Remove product?</h3><p>Are you sure you want to remove <strong>{product.name}</strong> from the price list?</p><div className="price-modal-actions"><button type="button" className="price-secondary" onClick={onCancel}>Cancel</button><button type="button" className="price-delete confirm" onClick={onConfirm}>Delete product</button></div></div></div>
}

function BulkProductDialog({ value, categories, onCancel, onSave }: { value: BulkState; categories: string[]; onCancel: () => void; onSave: (value: BulkState) => void }) {
  const [form, setForm] = useState(value)
  const [customCategory, setCustomCategory] = useState('')
  const update = (field: keyof BulkState, next: string) => setForm((current) => ({ ...current, [field]: next }))
  return <div className="price-modal-backdrop"><form className="price-modal bulk-modal" onSubmit={(event) => { event.preventDefault(); onSave({ ...form, category: form.category === '__new__' ? customCategory : form.category }) }}><div className="price-modal-header"><div><p className="price-eyebrow">QUICK CATALOG SETUP</p><h3>Bulk add products</h3></div><button type="button" className="price-close" onClick={onCancel} aria-label="Close">×</button></div><p className="bulk-help">Enter one product name per line. Prices and stock start at zero so you can edit them in the list afterward.</p><label><span className="field-label">Category <span className="required-mark">*</span></span><select value={form.category} onChange={(event) => update('category', event.target.value)} required><option value="">Select a category</option>{categories.filter((item) => item !== 'All').map((item) => <option key={item} value={item}>{item}</option>)}<option value="__new__">+ Add new category</option></select></label>{form.category === '__new__' && <label><span className="field-label">New category <span className="required-mark">*</span></span><input value={customCategory} onChange={(event) => setCustomCategory(event.target.value)} placeholder="e.g. Beverages" required /></label>}<label><span className="field-label">Product names <span className="required-mark">*</span></span><textarea rows={8} value={form.names} onChange={(event) => update('names', event.target.value)} placeholder={'Coca-Cola 1.5L\nMilo Sachet\nLucky Me Pancit Canton'} required /></label><label>Unit<input value={form.unit} onChange={(event) => update('unit', event.target.value)} /></label><div className="price-modal-actions"><button type="button" className="price-secondary" onClick={onCancel}>Cancel</button><button type="submit" className="price-primary">Add products</button></div></form></div>
}

export function PriceListPage() {
  const [products, setProducts] = useState<ProductRecord[]>([])
  const [category, setCategory] = useState('All')
  const [search, setSearch] = useState('')
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [bulk, setBulk] = useState<BulkState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ProductRecord | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = () => storeApi.products().then((response) => setProducts(response.products)).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Unable to load price list.'))
  useEffect(() => { void load() }, [])
  useEffect(() => {
    if (!notice) return undefined
    const timer = window.setTimeout(() => setNotice(''), 3500)
    return () => window.clearTimeout(timer)
  }, [notice])

  const categories = useMemo(() => ['All', ...Array.from(new Set(products.map((product) => product.category).filter(Boolean))).sort()], [products])
  const filtered = products.filter((product) => {
    const matchesCategory = category === 'All' || product.category === category
    const query = search.trim().toLowerCase()
    const matchesSearch = !query || [product.name, product.category, product.brand, product.barcode, product.sku].some((value) => value?.toLowerCase().includes(query))
    return matchesCategory && matchesSearch
  })

  function openEditor(product?: ProductRecord) {
    const sameDraft = editor && ((!product && !editor.product) || (product && editor.product && (product._id ?? product.id) === (editor.product._id ?? editor.product.id)))
    setEditor({ product, form: sameDraft ? editor.form : toForm(product), visible: true })
  }

  function closeEditorWithDraft(form: ProductForm) {
    setEditor((current) => current ? { ...current, form, visible: false } : current)
  }

  async function save(form: ProductForm) {
    const payload = { ...form, costPrice: Number(form.costPrice), sellingPrice: Number(form.sellingPrice), currentStock: Number(form.currentStock), initialStock: Number(form.currentStock), minStock: Number(form.minStock) }
    const wasEditing = Boolean(editor?.product)
    try {
      if (wasEditing) await storeApi.updateProduct(editor?.product?._id ?? editor?.product?.id ?? '', payload)
      else await storeApi.addProduct(payload)
      setEditor(null)
      setNotice(wasEditing ? 'Product details successfully changed.' : 'Product successfully added.')
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save product.')
    }
  }

  async function remove() {
    if (!deleteTarget) return
    try {
      await storeApi.deleteProduct(deleteTarget._id ?? deleteTarget.id ?? '')
      setDeleteTarget(null)
      setNotice('Product successfully deleted.')
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to delete product.')
    }
  }

  async function bulkSave(value: BulkState) {
    const names = value.names.split(/\r?\n/).map((name) => name.trim()).filter(Boolean)
    const categoryName = value.category === '__new__' ? '' : value.category
    if (!names.length || !categoryName) { setError('Choose or enter a category and add at least one product name.'); return }
    try { const response = await storeApi.bulkAddProducts(names, categoryName, value.unit || 'piece'); setBulk(null); setNotice(response.message); await load() } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to add products.') }
  }

  return <section className="price-page">
    <div className="price-page-heading"><div><p className="price-eyebrow">INVENTORY MANAGEMENT</p><h2>Price List</h2><p>Manage your products, prices, and categories in one place.</p></div><div className="price-heading-actions"><button className="price-secondary" type="button" onClick={() => setBulk({ visible: true, names: '', category: '', unit: 'piece' })}>Bulk add</button><button className="price-primary" type="button" onClick={() => openEditor()}>Add product</button></div></div>
    {notice && <div className="price-success" role="status">{notice}</div>}
    {error && <div className="price-error">{error}</div>}
    <div className="price-toolbar"><div className="category-tabs">{categories.map((item) => <button type="button" key={item} className={category === item ? 'category-tab active' : 'category-tab'} onClick={() => setCategory(item)}>{item}</button>)}</div><div className="price-search"><span aria-hidden="true">⌕</span><input aria-label="Search products" placeholder="Search products" value={search} onChange={(event) => setSearch(event.target.value)} /><button type="button" aria-label="Clear product search" onClick={() => setSearch('')}>×</button></div><span>{filtered.length} products</span></div>
    <div className="price-table"><div className="price-table-head"><span>Product</span><span>Category</span><span>Cost</span><span>Selling price</span><span>Stock</span><span>Actions</span></div>
      {filtered.map((product) => <div className="price-row" key={product._id ?? product.id}><div><strong>{product.name}</strong><small>{product.brand || product.barcode || 'No barcode'}</small></div><span className="category-label">{product.category}</span><span>{peso(product.costPrice)}</span><strong>{peso(product.sellingPrice)}</strong><span className={product.currentStock <= product.minStock ? 'stock-warning' : ''}>{product.currentStock} {product.unit || 'piece'}</span><div className="price-actions"><button type="button" onClick={() => openEditor(product)}>Edit</button><button type="button" className="price-delete" onClick={() => setDeleteTarget(product)}>Delete</button></div></div>)}
      {!filtered.length && <div className="price-empty">No products in this category yet. Add your first product to start the price list.</div>}
    </div>
    {editor?.visible && <ProductEditor title={editor.product ? 'Edit product' : 'Add product'} value={editor.form} onCancel={() => setEditor(null)} onClose={closeEditorWithDraft} onChange={(form) => setEditor((current) => current ? { ...current, form } : current)} onSave={save} />}
    {bulk && <BulkProductDialog value={bulk} categories={categories} onCancel={() => setBulk(null)} onSave={bulkSave} />}
    {deleteTarget && <ProductDeleteDialog product={deleteTarget} onCancel={() => setDeleteTarget(null)} onConfirm={() => void remove()} />}
  </section>
}
