import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { storeApi } from '../../services/storeApi'
import { POSFlow } from './POSFlow'

const sardines = { _id: 'p1', name: 'Sardines 155g', category: 'Canned', sellingPrice: 25, costPrice: 20, currentStock: 12, minStock: 2 }

async function scanSardines() {
  vi.spyOn(storeApi, 'allProducts').mockResolvedValue([sardines])
  vi.spyOn(storeApi, 'lookupProduct').mockResolvedValue({ found: true, product: sardines })
  render(<POSFlow />)
  fireEvent.change(screen.getByLabelText('Barcode'), { target: { value: '4800010001' } })
  fireEvent.click(screen.getByRole('button', { name: 'Look up' }))
  await screen.findByText('x1')
}

describe('POS checkout', () => {
  afterEach(() => { cleanup() })

  it('shows the scanned product with a real price, not NaN', async () => {
    await scanSardines()
    expect(document.body.textContent).toMatch(/25\.00/)
    expect(document.body.textContent).not.toMatch(/NaN/)
  })

  it('submits once and reuses one idempotency key when the button is clicked repeatedly', async () => {
    let finish: (value: { sale: { code: string; total: number; profit: number } }) => void = () => undefined
    const checkout = vi.spyOn(storeApi, 'checkout').mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    await scanSardines()

    const button = screen.getByRole('button', { name: 'Complete Checkout' })
    fireEvent.click(button)
    fireEvent.click(button)
    fireEvent.click(button)

    expect(checkout).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /Processing/ }).hasAttribute('disabled')).toBe(true)
    const [items, method, key] = checkout.mock.calls[0]!
    expect(items).toEqual([{ productId: 'p1', quantity: 1 }])
    expect(method).toBe('Cash')
    expect(typeof key).toBe('string')

    finish({ sale: { code: 'TXN-1', total: 25, profit: 5 } })
    await waitFor(() => expect(screen.getByText(/Checkout complete: TXN-1/)).toBeTruthy())
  })

  it('keeps the cart and explains the problem when checkout fails', async () => {
    vi.spyOn(storeApi, 'checkout').mockRejectedValue(new Error('Sardines 155g has insufficient stock.'))
    await scanSardines()
    fireEvent.click(screen.getByRole('button', { name: 'Complete Checkout' }))

    expect(await screen.findByText('Sardines 155g has insufficient stock.')).toBeTruthy()
    expect(screen.getByText('x1')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Complete Checkout' }).hasAttribute('disabled')).toBe(false)
  })
})
