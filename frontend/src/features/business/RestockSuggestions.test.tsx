import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { businessApi, type RestockInsights } from '../../services/businessApi'
import { RestockSuggestions } from './RestockSuggestions'

const insights = (overrides: Partial<RestockInsights> = {}): RestockInsights => ({
  generatedAt: '2026-06-30T00:00:00.000Z',
  windowDays: 30,
  coverDays: 14,
  summary: { needsRestock: 2, out: 1, urgent: 1, estimatedOrderCost: 215.5, slowMovers: 1, moneyTiedInSlowMovers: 500 },
  suggestions: [
    { productId: 'a', name: 'Lucky Me Pancit Canton', unit: 'piece', status: 'out', currentStock: 0, minStock: 5, soldLast30Days: 30, averageDailySales: 1, daysOfStockLeft: 0, suggestedOrderQuantity: 14, estimatedCost: 140, confidence: 'ok', reason: 'Out of stock and sells about 1 per day.' },
    { productId: 'b', name: 'Safeguard Soap', unit: 'bar', status: 'urgent', currentStock: 2, minStock: 0, soldLast30Days: 3, averageDailySales: 0.7, daysOfStockLeft: 2.9, suggestedOrderQuantity: 8, estimatedCost: 75.5, confidence: 'low', reason: 'About 2.9 day(s) of stock left at the recent pace.' },
  ],
  slowMovers: [{ productId: 'c', name: 'Old Candle', unit: 'piece', currentStock: 40, stockValue: 500, daysInCatalog: 90 }],
  method: 'Based on units sold in the last 30 days. This is an estimate from past sales only.',
  ...overrides,
})

describe('RestockSuggestions', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('lists what to restock, most urgent first, with the cost and the method note', async () => {
    vi.spyOn(businessApi, 'restockInsights').mockResolvedValue(insights())
    render(<RestockSuggestions />)

    expect(await screen.findByText(/2 products need restocking \(1 out of stock\)/)).toBeTruthy()
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows[0]?.textContent).toContain('Lucky Me Pancit Canton')
    expect(rows[0]?.textContent).toContain('Out of stock')
    expect(rows[1]?.textContent).toContain('Safeguard Soap')
    expect(rows[1]?.textContent).toContain('rough guide')
    expect(screen.getByText('Old Candle — 40 piece (₱500.00)')).toBeTruthy()
    expect(screen.getByText(/estimate from past sales only/)).toBeTruthy()
  })

  it('asks again when the days of cover change', async () => {
    const load = vi.spyOn(businessApi, 'restockInsights').mockResolvedValue(insights())
    render(<RestockSuggestions />)
    await screen.findByRole('table')

    fireEvent.change(screen.getByLabelText('Stock to cover'), { target: { value: '30' } })
    await waitFor(() => expect(load).toHaveBeenLastCalledWith(30))
  })

  it('says so when nothing needs restocking', async () => {
    vi.spyOn(businessApi, 'restockInsights').mockResolvedValue(insights({ suggestions: [], slowMovers: [], summary: { needsRestock: 0, out: 0, urgent: 0, estimatedOrderCost: 0, slowMovers: 0, moneyTiedInSlowMovers: 0 } }))
    render(<RestockSuggestions />)

    expect(await screen.findByText('Nothing needs restocking right now.')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('shows an error with a retry that recovers', async () => {
    const load = vi.spyOn(businessApi, 'restockInsights').mockRejectedValueOnce(new Error('Network down')).mockResolvedValue(insights())
    render(<RestockSuggestions />)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Network down')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('table')).toBeTruthy()
    expect(load).toHaveBeenCalledTimes(2)
  })
})
