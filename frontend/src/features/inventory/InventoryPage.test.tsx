import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { businessApi } from '../../services/businessApi'
import { inventoryApi } from '../../services/inventoryApi'
import { InventoryPage } from './InventoryPage'
import { item, pageOf } from './inventoryTestData'

vi.mock('../pos/BarcodeCameraScanner', () => ({ BarcodeCameraScanner: () => <div role="dialog" aria-label="Camera" /> }))

const gum = item('Gum', { currentStock: 0, minStock: 5 })
const coke = item('Coke', { currentStock: 12 })

beforeEach(() => {
  vi.spyOn(inventoryApi, 'listProducts').mockImplementation(async (query) => pageOf(query?.status === 'out' ? [gum] : query?.status === 'low' ? [] : [coke, gum]))
  vi.spyOn(inventoryApi, 'listCounts').mockResolvedValue({ counts: [] })
  vi.spyOn(businessApi, 'suppliers').mockResolvedValue({ suppliers: [] } as never)
  vi.spyOn(businessApi, 'restockInsights').mockResolvedValue({ suggestions: [] } as never)
})
afterEach(() => { cleanup() })

const tab = (name: string) => screen.getByRole('tab', { name: new RegExp(`^${name}`) })
const panel = (id: string) => document.getElementById(`inv-panel-${id}`) as HTMLElement

describe('Inventory page', () => {
  it('shows Stock first, with the other tools one tap away', async () => {
    render(<InventoryPage />)
    expect(tab('Stock').getAttribute('aria-selected')).toBe('true')
    expect(panel('stock').hidden).toBe(false)
    expect(panel('restock').hidden).toBe(true)
    expect(panel('count').hidden).toBe(true)
    await screen.findByText('Coke')
  })

  it('moves between tabs with the arrow, Home and End keys, and only the active tab is a tab stop', async () => {
    render(<InventoryPage />)
    await screen.findByText('Coke')
    fireEvent.keyDown(tab('Stock'), { key: 'ArrowRight' })
    expect(tab('Restock').getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tab('Restock'))
    expect(tab('Stock').tabIndex).toBe(-1)
    fireEvent.keyDown(tab('Restock'), { key: 'End' })
    expect(tab('Count').getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(tab('Count'), { key: 'ArrowRight' })
    expect(tab('Stock').getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(tab('Stock'), { key: 'ArrowLeft' })
    expect(tab('Count').getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(tab('Count'), { key: 'Home' })
    expect(tab('Stock').getAttribute('aria-selected')).toBe('true')
  })

  it('links each tab to its panel for screen readers', () => {
    render(<InventoryPage />)
    for (const id of ['stock', 'restock', 'count']) {
      const element = document.getElementById(`inv-tab-${id}`)!
      expect(element.getAttribute('aria-controls')).toBe(`inv-panel-${id}`)
      expect(panel(id).getAttribute('aria-labelledby')).toBe(`inv-tab-${id}`)
    }
  })

  it('sends a low product to Restock from the Stock tab and shows how many are waiting', async () => {
    render(<InventoryPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Restock Gum' }))
    expect(tab('Restock').getAttribute('aria-selected')).toBe('true')
    expect(await screen.findByLabelText('Quantity received of Gum')).toBeTruthy()
    expect(within(tab('Restock')).getByLabelText('1 in this delivery')).toBeTruthy()
  })

  it('keeps a half-finished delivery and count when switching tabs', async () => {
    vi.spyOn(inventoryApi, 'lookupBarcode')
    render(<InventoryPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Restock Gum' }))
    fireEvent.change(await screen.findByLabelText('Quantity received of Gum'), { target: { value: '30' } })

    fireEvent.click(tab('Count'))
    fireEvent.click(await within(panel('count')).findByRole('button', { name: 'Start a new count' }))
    fireEvent.change(within(panel('count')).getByLabelText('Add a product to count'), { target: { value: 'Coke' } })
    fireEvent.click(await within(panel('count')).findByRole('button', { name: 'Count Coke' }))
    fireEvent.change(screen.getByLabelText('Counted quantity for Coke'), { target: { value: '7' } })

    fireEvent.click(tab('Stock'))
    fireEvent.click(tab('Restock'))
    expect((screen.getByLabelText('Quantity received of Gum') as HTMLInputElement).value).toBe('30')
    fireEvent.click(tab('Count'))
    expect((screen.getByLabelText('Counted quantity for Coke') as HTMLInputElement).value).toBe('7')
  })

  it('reloads the stock list after a delivery is recorded', async () => {
    const list = vi.mocked(inventoryApi.listProducts)
    vi.spyOn(inventoryApi, 'restock').mockResolvedValue({ message: 'ok', purchase: { id: 'p1', total: 5, supplierName: null, items: [{ productId: 'Gum', name: 'Gum', added: 5, previousStock: 0, newStock: 5, lineTotal: 5 }] } })
    render(<InventoryPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Restock Gum' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Review delivery' }))
    const stockCalls = () => list.mock.calls.filter(([query]) => query?.status === 'all' && query.limit === 20).length
    const before = stockCalls()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and update stock' }))
    await screen.findByText('Delivery recorded')
    await waitFor(() => expect(stockCalls()).toBeGreaterThan(before))
  })
})
