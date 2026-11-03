import { useRef, useState } from 'react'
import { useAutoRefresh } from '../../hooks/useAutoRefresh'

import type { ProductRecord } from '../../services/storeApi'
import { CountTab } from './CountTab'
import { RestockTab } from './RestockTab'
import { addToLines, type RestockDraftLine } from './restockLines'
import { StockTab } from './StockTab'
import './Inventory.css'

const TABS = [{ id: 'stock', label: 'Stock' }, { id: 'restock', label: 'Restock' }, { id: 'count', label: 'Count' }] as const
type TabId = (typeof TABS)[number]['id']

/**
 * Daily inventory work in one place: find products and adjust stock or prices (Stock), receive a delivery (Restock), and
 * check the shelf against the system (Count). All three stay mounted, so a half-finished delivery or count is still there
 * when the person comes back from another tab.
 */
export function InventoryPage() {
  const [tab, setTab] = useState<TabId>('stock')
  const [lines, setLines] = useState<RestockDraftLine[]>([])
  const [version, setVersion] = useState(0)
  const autoRefreshSignal = useAutoRefresh(tab === 'stock')
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const changed = () => setVersion((count) => count + 1)

  const move = (event: React.KeyboardEvent, index: number) => {
    const next = event.key === 'ArrowRight' ? (index + 1) % TABS.length : event.key === 'ArrowLeft' ? (index + TABS.length - 1) % TABS.length : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : -1
    if (next < 0) return
    event.preventDefault()
    const target = TABS[next]!
    setTab(target.id)
    tabRefs.current[target.id]?.focus()
  }

  const restockProduct = (product: ProductRecord) => { setLines((current) => addToLines(current, product, 1)); setTab('restock') }

  return <section className="price-page inventory-page">
    <div className="price-page-heading"><div><p className="price-eyebrow">INVENTORY</p><h2>Inventory</h2><p>Find products, receive deliveries, and count what is on your shelves.</p></div></div>
    <div className="inv-tabs" role="tablist" aria-label="Inventory tools">
      {TABS.map((item, index) => <button key={item.id} ref={(element) => { tabRefs.current[item.id] = element }} type="button" role="tab" id={`inv-tab-${item.id}`} aria-selected={tab === item.id} aria-controls={`inv-panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1} className={`inv-tab${tab === item.id ? ' active' : ''}`} onClick={() => setTab(item.id)} onKeyDown={(event) => move(event, index)}>
        {item.label}{item.id === 'restock' && lines.length > 0 && <span className="inv-chip-count" aria-label={`${lines.length} in this delivery`}>{lines.length}</span>}
      </button>)}
    </div>
    <div role="tabpanel" id="inv-panel-stock" aria-labelledby="inv-tab-stock" hidden={tab !== 'stock'}><StockTab refreshSignal={version} autoRefreshSignal={autoRefreshSignal} onRestock={restockProduct} /></div>
    <div role="tabpanel" id="inv-panel-restock" aria-labelledby="inv-tab-restock" hidden={tab !== 'restock'}><RestockTab lines={lines} setLines={setLines} onChanged={changed} onShowStock={() => setTab('stock')} /></div>
    <div role="tabpanel" id="inv-panel-count" aria-labelledby="inv-tab-count" hidden={tab !== 'count'}><CountTab onChanged={changed} /></div>
  </section>
}
