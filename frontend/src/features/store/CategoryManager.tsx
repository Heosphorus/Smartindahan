import { useState } from 'react'

import { useEscapeKey } from '../../hooks/useEscapeKey'
import './CategoryManager.css'

export type CategoryRow = { name: string; count: number }

const FALLBACK_CATEGORY = 'Uncategorized'

type Props = {
  categories: CategoryRow[]
  /** Resolve with the confirmation message; reject with an Error whose message is shown in the dialog. */
  onRename: (name: string, newName: string) => Promise<string>
  onDelete: (name: string, moveTo: string) => Promise<string>
  onClose: () => void
}

/** Lists the store's categories with a Rename and a Delete for each. Delete never removes products; it moves them. */
export function CategoryManager({ categories, onRename, onDelete, onClose }: Props) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [moveTo, setMoveTo] = useState(FALLBACK_CATEGORY)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  useEscapeKey(true, onClose)

  const run = async (action: () => Promise<string>) => {
    if (busy) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      setMessage(await action())
      setRenaming(null)
      setDeleting(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The category could not be changed.')
    } finally {
      setBusy(false)
    }
  }

  const startRename = (name: string) => { setRenaming(name); setDraft(name); setDeleting(null); setError(''); setMessage('') }
  const startDelete = (name: string) => { setDeleting(name); setMoveTo(FALLBACK_CATEGORY); setRenaming(null); setError(''); setMessage('') }

  const submitRename = (name: string) => {
    const next = draft.trim()
    if (!next) { setError('Enter a category name.'); return }
    if (next === name) { setError('Enter a different name, or cancel.'); return }
    void run(() => onRename(name, next))
  }

  const moveOptions = (name: string) => {
    const others = categories.map((row) => row.name).filter((other) => other !== name)
    return others.includes(FALLBACK_CATEGORY) ? others : [...others, FALLBACK_CATEGORY]
  }

  return <div className="price-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="price-modal category-modal" role="dialog" aria-modal="true" aria-labelledby="category-manager-title">
      <div className="price-modal-header">
        <div><p className="price-eyebrow">PRODUCT CATALOG</p><h3 id="category-manager-title">Manage categories</h3></div>
        <button type="button" className="price-close" onClick={onClose} aria-label="Close manage categories">&times;</button>
      </div>
      <p className="bulk-help">Renaming changes the category on all of its products. Deleting a category never deletes products; they move to another category.</p>
      {message && <p className="price-success" role="status">{message}</p>}
      {error && <p className="price-form-error" role="alert">{error}</p>}

      {categories.length === 0
        ? <p className="category-empty">No categories yet. They appear when you add products.</p>
        : <ul className="category-list">{categories.map((row) => <li key={row.name} className="category-item">
          {renaming === row.name
            ? <form className="category-edit" onSubmit={(event) => { event.preventDefault(); submitRename(row.name) }}>
              <label htmlFor="category-rename-input" className="sr-only">New name for {row.name}</label>
              <input id="category-rename-input" autoFocus autoComplete="off" value={draft} onChange={(event) => { setDraft(event.target.value); setError('') }} />
              <button type="submit" className="price-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
              <button type="button" className="price-secondary" onClick={() => { setRenaming(null); setError('') }} disabled={busy}>Cancel</button>
            </form>
            : deleting === row.name
              ? <div className="category-delete">
                <p>Delete <strong>{row.name}</strong>? Its {row.count} {row.count === 1 ? 'product' : 'products'} will stay in your price list and move to:</p>
                <div className="category-edit">
                  <label htmlFor="category-move-to" className="sr-only">Move {row.name} products to</label>
                  <select id="category-move-to" value={moveTo} onChange={(event) => setMoveTo(event.target.value)}>{moveOptions(row.name).map((name) => <option key={name} value={name}>{name}</option>)}</select>
                  <button type="button" className="price-delete confirm" onClick={() => void run(() => onDelete(row.name, moveTo))} disabled={busy}>{busy ? 'Deleting…' : 'Delete category'}</button>
                  <button type="button" className="price-secondary" onClick={() => { setDeleting(null); setError('') }} disabled={busy}>Cancel</button>
                </div>
              </div>
              : <>
                <div className="category-info"><strong>{row.name}</strong><small>{row.count} {row.count === 1 ? 'product' : 'products'}</small></div>
                <div className="price-actions">
                  <button type="button" onClick={() => startRename(row.name)} aria-label={'Rename ' + row.name} disabled={busy}>Rename</button>
                  <button type="button" className="price-delete" onClick={() => startDelete(row.name)} aria-label={'Delete ' + row.name} disabled={busy}>Delete</button>
                </div>
              </>}
        </li>)}</ul>}

      <div className="price-modal-actions"><button type="button" className="price-primary" onClick={onClose}>Done</button></div>
    </section>
  </div>
}
