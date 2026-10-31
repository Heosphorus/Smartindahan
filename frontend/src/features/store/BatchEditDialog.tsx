import { useMemo, useState } from 'react'

import { useEscapeKey } from '../../hooks/useEscapeKey'
import type { PriceAdjustment, ProductRecord } from '../../services/storeApi'
import { ADJUST_MODES, applyAdjustment, parseAdjustmentInput, type AdjustMode } from './priceAdjust'
import './BatchTools.css'

const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })
const PREVIEW_ROWS = 5

type Field = { mode: AdjustMode; value: string }
export type BatchPriceChanges = { sellingPrice?: PriceAdjustment; costPrice?: PriceAdjustment }

function AdjustField({ legend, field, onChange }: { legend: string; field: Field; onChange: (next: Field) => void }) {
  const percent = field.mode.endsWith('percent')
  return <fieldset className="adjust-field">
    <legend>{legend}</legend>
    <div className="adjust-controls">
      <select aria-label={legend + ' change'} value={field.mode} onChange={(event) => onChange({ mode: event.target.value as AdjustMode, value: field.mode === 'none' ? '' : field.value })}>
        {ADJUST_MODES.map((option) => <option key={option.mode} value={option.mode}>{option.label}</option>)}
      </select>
      <span className="adjust-input">
        {field.mode !== 'none' && !percent && <span aria-hidden="true">₱</span>}
        <input type="number" min="0" step="0.01" inputMode="decimal" aria-label={legend + ' amount'} value={field.value} disabled={field.mode === 'none'} placeholder={field.mode === 'none' ? '' : percent ? 'e.g. 10' : 'e.g. 25.00'} onChange={(event) => onChange({ ...field, value: event.target.value })} />
        {percent && <span aria-hidden="true">%</span>}
      </span>
    </div>
  </fieldset>
}

/** Changes the selling price and/or cost of every selected product together, showing the result before anything is saved. */
export function BatchEditDialog({ products, isSaving, error, onCancel, onSave }: { products: ProductRecord[]; isSaving: boolean; error: string; onCancel: () => void; onSave: (changes: BatchPriceChanges) => void }) {
  const [selling, setSelling] = useState<Field>({ mode: 'none', value: '' })
  const [cost, setCost] = useState<Field>({ mode: 'none', value: '' })
  const [submitted, setSubmitted] = useState(false)
  useEscapeKey(true, onCancel)

  const parsedSelling = parseAdjustmentInput(selling.mode, selling.value)
  const parsedCost = parseAdjustmentInput(cost.mode, cost.value)
  const sellingAdjustment = parsedSelling.kind === 'ok' ? parsedSelling.adjustment : undefined
  const costAdjustment = parsedCost.kind === 'ok' ? parsedCost.adjustment : undefined

  const rows = useMemo(() => products.map((product) => {
    const nextSelling = sellingAdjustment ? applyAdjustment(product.sellingPrice, sellingAdjustment) : product.sellingPrice
    const nextCost = costAdjustment ? applyAdjustment(product.costPrice, costAdjustment) : product.costPrice
    return { product, nextSelling, nextCost }
  }), [products, sellingAdjustment, costAdjustment])
  const outOfRange = rows.filter((row) => row.nextSelling === null || row.nextCost === null).length
  const belowCost = rows.filter((row) => row.nextSelling !== null && row.nextCost !== null && row.nextSelling < row.nextCost).length

  const problem = parsedSelling.kind === 'invalid' ? 'Selling price: ' + parsedSelling.message
    : parsedCost.kind === 'invalid' ? 'Cost per unit: ' + parsedCost.message
      : parsedSelling.kind === 'none' && parsedCost.kind === 'none' ? 'Choose how to change the selling price, the cost, or both.'
        : outOfRange > 0 ? `${outOfRange} ${outOfRange === 1 ? 'product would' : 'products would'} end up with a price below zero or too large. Adjust the change.`
          : ''

  const submit = () => {
    setSubmitted(true)
    if (problem) return
    onSave({ ...(sellingAdjustment ? { sellingPrice: sellingAdjustment } : {}), ...(costAdjustment ? { costPrice: costAdjustment } : {}) })
  }
  const show = (before: number, after: number | null) => after === null ? 'Not valid' : after === before ? peso.format(after) : `${peso.format(before)} → ${peso.format(after)}`

  return <div className="price-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
    <form className="price-modal batch-modal" role="dialog" aria-modal="true" aria-labelledby="batch-edit-title" noValidate onSubmit={(event) => { event.preventDefault(); submit() }}>
      <div className="price-modal-header"><div><p className="price-eyebrow">BATCH EDIT</p><h3 id="batch-edit-title">Edit prices for {products.length} {products.length === 1 ? 'product' : 'products'}</h3></div><button type="button" className="price-close" onClick={onCancel} aria-label="Close batch edit">&times;</button></div>
      <p className="bulk-help">Choose a change for each price. Prices you leave on "No change" stay as they are. You can review the result below before saving.</p>
      <div className="adjust-grid">
        <AdjustField legend="Selling price" field={selling} onChange={(next) => { setSelling(next); setSubmitted(false) }} />
        <AdjustField legend="Cost per unit" field={cost} onChange={(next) => { setCost(next); setSubmitted(false) }} />
      </div>

      <div className="batch-preview" aria-label="Preview of the new prices">
        <table>
          <thead><tr><th scope="col">Product</th><th scope="col">Selling price</th><th scope="col">Cost per unit</th></tr></thead>
          <tbody>{rows.slice(0, PREVIEW_ROWS).map(({ product, nextSelling, nextCost }) => <tr key={product._id ?? product.id ?? product.name}>
            <td>{product.name}</td><td>{show(product.sellingPrice, nextSelling)}</td><td>{show(product.costPrice, nextCost)}</td>
          </tr>)}</tbody>
        </table>
        {rows.length > PREVIEW_ROWS && <p className="batch-more">and {rows.length - PREVIEW_ROWS} more {rows.length - PREVIEW_ROWS === 1 ? 'product' : 'products'}</p>}
      </div>

      {belowCost > 0 && !problem && <p className="price-review-note" role="status">{belowCost} {belowCost === 1 ? 'product' : 'products'} will sell below cost after this change.</p>}
      {submitted && problem && <p className="price-form-error" role="alert">{problem}</p>}
      {error && <p className="price-form-error" role="alert">{error}</p>}
      <div className="price-modal-actions"><button type="button" className="price-secondary" onClick={onCancel} disabled={isSaving}>Cancel</button><button type="submit" className="price-primary" disabled={isSaving}>{isSaving ? 'Saving…' : `Update ${products.length} ${products.length === 1 ? 'product' : 'products'}`}</button></div>
    </form>
  </div>
}
