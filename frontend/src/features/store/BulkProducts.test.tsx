import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { storeApi } from '../../services/storeApi'
import { parseBulkLine } from './bulkLines'
import { BULK_NAMES_LIMIT, BulkProductDialog, PriceListPage } from './PriceListPage'

const dialog = () => within(screen.getByRole('dialog'))
const field = (label: string) => dialog().getByLabelText(label, { exact: false }) as HTMLInputElement

function renderDialog(onSave = vi.fn()) {
  render(<BulkProductDialog categories={['All', 'Canned goods']} isSaving={false} error="" onCancel={vi.fn()} onSave={onSave} />)
  return onSave
}

function fillRequired(names = 'Canned sardines\nInstant noodles') {
  fireEvent.change(dialog().getByLabelText(/Product names/), { target: { value: names } })
  fireEvent.change(dialog().getByLabelText(/Category/), { target: { value: 'Canned goods' } })
  fireEvent.change(field('Selling price'), { target: { value: '25' } })
}

describe('bulk add dialog', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('limits the product names box to 256 characters and counts them', () => {
    renderDialog()
    const names = screen.getByLabelText(/Product names/) as HTMLTextAreaElement
    expect(BULK_NAMES_LIMIT).toBe(256)
    expect(names.maxLength).toBe(256)
    expect(names.hasAttribute('data-long-text')).toBe(true)
    fireEvent.change(names, { target: { value: 'Sardines\nNoodles' } })
    expect(screen.getByText(/16 \/ 256 characters/)).toBeTruthy()
  })

  it('has the same details as the Add product form, and cost is not required', () => {
    renderDialog()
    for (const label of [/^Category/, /^Brand/, /^Cost per unit/, /^Selling price/, /^Current stock/, /^Low stock alert at/, /^Unit/]) {
      expect(screen.getByLabelText(label)).toBeTruthy()
    }
    expect(screen.getByText('optional')).toBeTruthy()
    expect(screen.getByLabelText(/Selling price/).getAttribute('aria-required')).toBe('true')
    expect(screen.getByLabelText(/Cost per unit/).getAttribute('aria-required')).toBeNull()
  })

  it('asks for a selling price but accepts a blank cost, and explains what blank cost means', () => {
    const onSave = renderDialog()
    fillRequired()
    fireEvent.change(field('Selling price'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /Preview 2 products/ }))
    expect(screen.getByRole('alert').textContent).toContain('selling price')

    fireEvent.change(field('Selling price'), { target: { value: '25' } })
    fireEvent.click(screen.getByRole('button', { name: /Preview 2 products/ }))
    expect(screen.getByText(/No cost entered, so it is saved as ₱0\.00/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 products' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ items: [{ name: 'Canned sardines', price: '' }, { name: 'Instant noodles', price: '' }], category: 'Canned goods', sellingPrice: '25', costPrice: '', unit: 'piece' }))
  })

  it('shows a placeholder that explains how to add a price to each line', () => {
    renderDialog()
    const placeholder = (screen.getByLabelText(/Product names/) as HTMLTextAreaElement).placeholder
    expect(placeholder).toContain('Canned sardines, 25')
    expect(placeholder).toContain('Instant noodles, 12.50')
    expect(screen.getByText(/Add a price after a comma/)).toBeTruthy()
  })

  it('keeps a price typed on a line and needs no shared price when every line has one', () => {
    const onSave = renderDialog()
    fireEvent.change(screen.getByLabelText(/Product names/), { target: { value: 'Safeguard Soap, 20\nCoke Mismo, ₱12.50' } })
    fireEvent.change(dialog().getByLabelText(/Category/), { target: { value: 'Canned goods' } })
    expect(screen.getByLabelText(/^Selling price/).getAttribute('aria-required')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Preview 2 products/ }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('₱20.00')).toBeTruthy()
    expect(screen.getByText('₱12.50')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 products' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ items: [{ name: 'Safeguard Soap', price: '20' }, { name: 'Coke Mismo', price: '12.50' }], sellingPrice: '' }))
  })

  it('uses the shared price for lines without one, and asks for it when needed', () => {
    renderDialog()
    fireEvent.change(screen.getByLabelText(/Product names/), { target: { value: 'Safeguard Soap, 20\nNido, 400g' } })
    fireEvent.change(dialog().getByLabelText(/Category/), { target: { value: 'Canned goods' } })
    fireEvent.click(screen.getByRole('button', { name: /Preview 2 products/ }))
    expect(screen.getByRole('alert').textContent).toContain('Some products have no price')

    fireEvent.change(field('Selling price'), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: /Preview 2 products/ }))
    expect(screen.getByText('Nido, 400g')).toBeTruthy()
    expect(screen.getByText('₱20.00')).toBeTruthy()
    expect(screen.getAllByText('₱30.00').length).toBeGreaterThan(0)
  })

  it('rejects a price that is not a number', () => {
    renderDialog()
    fireEvent.change(screen.getByLabelText(/Product names/), { target: { value: 'Safeguard Soap, 1.2.3' } })
    fireEvent.change(dialog().getByLabelText(/Category/), { target: { value: 'Canned goods' } })
    fireEvent.change(field('Selling price'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: /Preview 1 products/ }))
    expect(screen.getByRole('alert').textContent).toContain('not a valid amount')
  })

  it('only treats a number after the last comma as a price', () => {
    expect(parseBulkLine('Safeguard Soap, 20')).toEqual({ name: 'Safeguard Soap', price: '20' })
    expect(parseBulkLine('Coke, 8 oz, 12.5')).toEqual({ name: 'Coke, 8 oz', price: '12.5' })
    expect(parseBulkLine('Nido, 400g')).toEqual({ name: 'Nido, 400g', price: '' })
    expect(parseBulkLine('Coke Mismo')).toEqual({ name: 'Coke Mismo', price: '' })
  })

  it('rejects a bad optional cost and over-long names, and skips duplicates', () => {
    renderDialog()
    fillRequired('Sardines\nsardines\nNoodles')
    expect(screen.getByText('1 duplicate name will be skipped.')).toBeTruthy()

    fireEvent.change(field('Cost per unit'), { target: { value: '-3' } })
    fireEvent.click(screen.getByRole('button', { name: /Preview 2 products/ }))
    expect(screen.getByRole('alert').textContent).toContain('Cost per unit')

    fireEvent.change(field('Cost per unit'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText(/Product names/), { target: { value: 'x'.repeat(65) } })
    fireEvent.click(screen.getByRole('button', { name: /Preview 1 products/ }))
    expect(screen.getByRole('alert').textContent).toContain('64 characters or fewer')
  })
})

describe('bulk add from the price list', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('sends each line\'s own price and the shared values as numbers, and leaves cost out when it is blank', async () => {
    vi.spyOn(storeApi, 'products').mockResolvedValue({ products: [], pagination: { page: 1, limit: 100, total: 0 } })
    const add = vi.spyOn(storeApi, 'bulkAddProducts').mockResolvedValue({ message: '2 products added.', products: [] })
    render(<PriceListPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Bulk add' }))
    fillRequired('Canned sardines, 30\nInstant noodles')
    fireEvent.change(dialog().getByLabelText(/Category/), { target: { value: '__new__' } })
    fireEvent.change(dialog().getByLabelText(/New category/), { target: { value: 'Canned goods' } })
    fireEvent.change(field('Brand'), { target: { value: 'Ligo' } })
    fireEvent.change(field('Current stock'), { target: { value: '12' } })
    fireEvent.change(field('Low stock alert at'), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: /Preview 2 products/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 products' }))

    await waitFor(() => expect(add).toHaveBeenCalledTimes(1))
    expect(add.mock.calls[0]![0]).toEqual({ items: [{ name: 'Canned sardines', sellingPrice: 30 }, { name: 'Instant noodles' }], category: 'Canned goods', unit: 'piece', sellingPrice: 25, brand: 'Ligo', initialStock: 12, minStock: 4 })
    expect(await screen.findByText('2 products added.')).toBeTruthy()
  })
})
