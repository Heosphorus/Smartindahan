import { useState } from 'react'

import { useEscapeKey } from '../../hooks/useEscapeKey'
import { storeApi, type ProductRecord } from '../../services/storeApi'
import { parseMoney, parseWhole, UNIT_SUGGESTIONS } from './inventoryMath'

const NEW_CATEGORY = '__new__'

type Props = {
  /** The barcode that was not found, so the new product is saved with it. Empty when adding without a scan. */
  barcode: string
  categories: string[]
  onCancel: () => void
  onCreated: (product: ProductRecord) => void
}

/** A short form for adding a product the store does not have yet, usually right after an unknown barcode was scanned. */
export function NewProductDialog({ barcode, categories, onCancel, onCreated }: Props) {
  const [form, setForm] = useState({ name: '', category: categories[0] ?? NEW_CATEGORY, newCategory: '', barcode, unit: 'piece', costPrice: '', sellingPrice: '', stock: '', minStock: '', purchaseUnit: '', packSize: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEscapeKey(true, onCancel)
  const set = (field: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setForm((current) => ({ ...current, [field]: event.target.value })); setError('') }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    const typed = form.category === NEW_CATEGORY ? form.newCategory.trim().replace(/\s+/g, ' ') : form.category
    // A typed category that differs from an existing one only by capitals joins the existing one.
    const category = categories.find((name) => name.toLocaleLowerCase() === typed.toLocaleLowerCase()) ?? typed
    const cost = parseMoney(form.costPrice)
    const selling = parseMoney(form.sellingPrice)
    const stock = form.stock.trim() === '' ? 0 : parseWhole(form.stock)
    const minStock = form.minStock.trim() === '' ? 0 : parseWhole(form.minStock)
    const wantsPack = form.purchaseUnit.trim() !== '' || form.packSize.trim() !== ''
    const packSize = parseWhole(form.packSize)
    if (!form.name.trim() || !category || !form.unit.trim()) { setError('Enter a name, choose a category and enter a unit.'); return }
    if (cost === null || selling === null) { setError('Enter the cost and the selling price, as numbers of zero or more.'); return }
    if (stock === null || minStock === null) { setError('Stock and the low-stock alert must be whole numbers of zero or more.'); return }
    if (wantsPack && (!form.purchaseUnit.trim() || packSize === null || packSize < 2)) { setError('For a pack, enter its name (such as “pack”) and how many are in it (2 or more), or leave both empty.'); return }
    setBusy(true)
    try {
      const { product } = await storeApi.addProduct({
        name: form.name.trim(), category, unit: form.unit.trim(), costPrice: cost, sellingPrice: selling, initialStock: stock, minStock,
        ...(form.barcode.trim() ? { barcode: form.barcode.trim() } : {}),
        ...(wantsPack ? { purchaseUnit: form.purchaseUnit.trim(), unitsPerPurchaseUnit: packSize } : {}),
      })
      onCreated(product)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The product could not be added.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="price-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
    <form className="price-modal" role="dialog" aria-modal="true" aria-labelledby="new-product-title" onSubmit={(event) => void submit(event)} noValidate>
      <div className="price-modal-header"><div><p className="price-eyebrow">NEW PRODUCT</p><h3 id="new-product-title">{barcode ? 'Add a product for this barcode' : 'Add a product'}</h3></div><button type="button" className="price-close" onClick={onCancel} aria-label="Close">&times;</button></div>
      {barcode && <p className="inv-hint">No product in your store uses barcode <strong>{barcode}</strong>. Enter the details you want to keep; nothing is looked up online.</p>}
      <div className="price-form-grid">
        <label className="price-form-wide"><span>Product name <span className="required-mark" aria-hidden="true">*</span></span><input autoFocus autoComplete="off" maxLength={64} value={form.name} onChange={set('name')} /></label>
        <label><span>Category <span className="required-mark" aria-hidden="true">*</span></span><select value={form.category} onChange={set('category')}>{categories.map((name) => <option key={name} value={name}>{name}</option>)}<option value={NEW_CATEGORY}>Add a new category</option></select></label>
        {form.category === NEW_CATEGORY ? <label>New category<input autoComplete="off" maxLength={64} value={form.newCategory} onChange={set('newCategory')} /></label> : <label>Barcode<input inputMode="numeric" autoComplete="off" maxLength={64} value={form.barcode} onChange={set('barcode')} /></label>}
        {form.category === NEW_CATEGORY && <label>Barcode<input inputMode="numeric" autoComplete="off" maxLength={64} value={form.barcode} onChange={set('barcode')} /></label>}
        <label><span>Sold by the <span className="required-mark" aria-hidden="true">*</span></span><input list="inv-unit-options" autoComplete="off" maxLength={32} value={form.unit} onChange={set('unit')} /></label>
        <label><span>Cost per unit (₱) <span className="required-mark" aria-hidden="true">*</span></span><input inputMode="decimal" autoComplete="off" value={form.costPrice} onChange={set('costPrice')} /></label>
        <label><span>Selling price (₱) <span className="required-mark" aria-hidden="true">*</span></span><input inputMode="decimal" autoComplete="off" value={form.sellingPrice} onChange={set('sellingPrice')} /></label>
        <label>Stock on hand<input inputMode="numeric" autoComplete="off" value={form.stock} onChange={set('stock')} placeholder="0" /></label>
        <label>Alert me at or below<input inputMode="numeric" autoComplete="off" value={form.minStock} onChange={set('minStock')} placeholder="0" /></label>
        <fieldset className="price-form-wide inv-pack"><legend>Bought in packs? (optional)</legend>
          <label>Pack name<input list="inv-unit-options" autoComplete="off" maxLength={32} value={form.purchaseUnit} onChange={set('purchaseUnit')} placeholder="e.g. pack" /></label>
          <label>{form.unit.trim() || 'Units'} in one pack<input inputMode="numeric" autoComplete="off" value={form.packSize} onChange={set('packSize')} placeholder="e.g. 24" /></label>
        </fieldset>
      </div>
      <datalist id="inv-unit-options">{UNIT_SUGGESTIONS.map((unit) => <option key={unit} value={unit} />)}</datalist>
      {error && <p className="price-form-error" role="alert">{error}</p>}
      <div className="price-modal-actions"><button type="button" className="price-secondary" onClick={onCancel} disabled={busy}>Cancel</button><button type="submit" className="price-primary" disabled={busy}>{busy ? 'Adding…' : 'Add product'}</button></div>
    </form>
  </div>
}
