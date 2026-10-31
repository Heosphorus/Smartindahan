import { useMemo, useState } from 'react'

import { useEscapeKey } from '../../hooks/useEscapeKey'
import type { ProductRecord } from '../../services/storeApi'
import { productKey } from './productKey'
import {
  buildDocx, buildExportTable, buildPrintHtml, buildXlsx, DOCX_MIME, downloadFile, EXPORT_COLUMNS, exportFileName, printHtml, XLSX_MIME,
  type ExportColumn,
} from './priceListExport'
import './BatchTools.css'

type Scope = 'all' | 'category' | 'picked'

type Props = {
  products: ProductRecord[]
  /** Category names, without "All". */
  categories: string[]
  /** The category currently filtered in the table, or "All". */
  initialCategory: string
  /** Products already ticked in the table. */
  initialPicked: string[]
  onClose: () => void
}

/** Prints or downloads the price list for everything, for chosen categories, or for hand-picked products. */
export function ExportDialog({ products, categories, initialCategory, initialPicked, onClose }: Props) {
  const [scope, setScope] = useState<Scope>(initialPicked.length ? 'picked' : initialCategory !== 'All' ? 'category' : 'all')
  const [chosenCategories, setChosenCategories] = useState<Set<string>>(new Set(initialCategory !== 'All' ? [initialCategory] : []))
  const [picked, setPicked] = useState<Set<string>>(new Set(initialPicked))
  const [search, setSearch] = useState('')
  const [title, setTitle] = useState('Price list')
  const [columns, setColumns] = useState<Set<ExportColumn>>(new Set<ExportColumn>(['category', 'unit']))
  const [status, setStatus] = useState('')
  useEscapeKey(true, onClose)

  const included = useMemo(() => scope === 'all' ? products
    : scope === 'category' ? products.filter((product) => chosenCategories.has(product.category))
      : products.filter((product) => picked.has(productKey(product))), [scope, products, chosenCategories, picked])

  const shown = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    const matching = query ? products.filter((product) => [product.name, product.category, product.brand].some((value) => value?.toLocaleLowerCase().includes(query))) : products
    return [...matching].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))
  }, [products, search])

  const toggle = <T,>(set: Set<T>, value: T, update: (next: Set<T>) => void) => {
    const next = new Set(set)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    update(next)
    setStatus('')
  }
  const table = () => buildExportTable(included, { title, columns: [...columns] })
  const count = included.length
  const none = count === 0

  const print = () => { printHtml(buildPrintHtml(table())); setStatus('Opening the print dialog…') }
  const download = (extension: 'xlsx' | 'docx') => {
    const built = table()
    const name = exportFileName(built.title, extension)
    downloadFile(name, extension === 'xlsx' ? XLSX_MIME : DOCX_MIME, extension === 'xlsx' ? buildXlsx(built) : buildDocx(built))
    setStatus(`Downloaded ${name}.`)
  }

  return <div className="price-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="price-modal export-modal" role="dialog" aria-modal="true" aria-labelledby="export-title">
      <div className="price-modal-header"><div><p className="price-eyebrow">PRICE LIST</p><h3 id="export-title">Print or download</h3></div><button type="button" className="price-close" onClick={onClose} aria-label="Close print or download">&times;</button></div>

      <fieldset className="export-group">
        <legend>Which products?</legend>
        <label className="export-choice"><input type="radio" name="export-scope" checked={scope === 'all'} onChange={() => { setScope('all'); setStatus('') }} /> All products ({products.length})</label>
        <label className="export-choice"><input type="radio" name="export-scope" checked={scope === 'category'} onChange={() => { setScope('category'); setStatus('') }} /> By category</label>
        {scope === 'category' && <div className="export-chips" role="group" aria-label="Categories to include">
          {categories.length === 0 ? <p className="category-empty">No categories yet.</p> : categories.map((name) => <label key={name} className="export-chip"><input type="checkbox" checked={chosenCategories.has(name)} onChange={() => toggle(chosenCategories, name, setChosenCategories)} /> {name}</label>)}
        </div>}
        <label className="export-choice"><input type="radio" name="export-scope" checked={scope === 'picked'} onChange={() => { setScope('picked'); setStatus('') }} /> Pick products ({picked.size} chosen)</label>
        {scope === 'picked' && <div className="export-picker">
          <div className="export-picker-tools">
            <input aria-label="Search products to pick" placeholder="Search by name, category or brand" value={search} onChange={(event) => setSearch(event.target.value)} />
            <button type="button" className="price-secondary" onClick={() => { const next = new Set(picked); shown.forEach((product) => next.add(productKey(product))); setPicked(next); setStatus('') }}>Pick all shown</button>
            <button type="button" className="price-secondary" onClick={() => { setPicked(new Set()); setStatus('') }} disabled={picked.size === 0}>Clear</button>
          </div>
          <ul className="export-picker-list" aria-label="Products">{shown.length === 0 ? <li className="category-empty">No products match.</li> : shown.map((product) => <li key={productKey(product)}>
            <label><input type="checkbox" checked={picked.has(productKey(product))} onChange={() => toggle(picked, productKey(product), setPicked)} /> <span>{product.name}</span> <small>{product.category}</small></label>
          </li>)}</ul>
        </div>}
      </fieldset>

      <div className="export-two">
        <label className="export-title">Title<input value={title} onChange={(event) => { setTitle(event.target.value); setStatus('') }} autoComplete="off" /></label>
        <fieldset className="export-group">
          <legend>Columns</legend>
          <p className="export-fixed">Product and selling price are always included.</p>
          <div className="export-chips">{EXPORT_COLUMNS.map((column) => <label key={column.id} className="export-chip"><input type="checkbox" checked={columns.has(column.id)} onChange={() => toggle(columns, column.id, setColumns)} /> {column.header}</label>)}</div>
          {columns.has('costPrice') && <p className="price-review-note" role="status">Your cost will be visible to anyone who sees this list.</p>}
        </fieldset>
      </div>

      <p className="export-count" role="status">{none ? 'No products are included yet.' : `${count} ${count === 1 ? 'product' : 'products'} will be included.`}</p>
      {status && <p className="price-success" role="status">{status}</p>}
      <div className="price-modal-actions export-actions">
        <button type="button" className="price-secondary" onClick={onClose}>Close</button>
        <button type="button" className="price-secondary" onClick={print} disabled={none}>Print</button>
        <button type="button" className="price-secondary" onClick={() => download('docx')} disabled={none}>Download Word</button>
        <button type="button" className="price-primary" onClick={() => download('xlsx')} disabled={none}>Download Excel</button>
      </div>
    </section>
  </div>
}
