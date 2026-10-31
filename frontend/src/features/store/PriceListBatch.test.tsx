import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { storeApi, type ProductRecord } from '../../services/storeApi'
import { PriceListPage } from './PriceListPage'

const item = (name: string, category: string, sellingPrice: number, costPrice: number): ProductRecord => ({ _id: name, name, category, sellingPrice, costPrice, currentStock: 5, minStock: 1, unit: 'piece' })
const catalog = [item('Coke', 'Beverages', 20, 10), item('Pepsi', 'Beverages', 20, 10), item('Soap', 'Household', 8, 5), item('Shampoo', 'Household', 3, 2), item('Rice', 'Groceries', 50, 40)]

const box = (name: string) => screen.getByRole('checkbox', { name: 'Select ' + name }) as HTMLInputElement
const bar = () => within(screen.getByRole('region', { name: 'Selected products' }))
const dialog = () => within(screen.getByRole('dialog'))

async function openPage() {
  const products = vi.spyOn(storeApi, 'products').mockResolvedValue({ products: catalog, pagination: { page: 1, limit: 100, total: catalog.length } })
  render(<PriceListPage />)
  await screen.findByText('Rice')
  return products
}

describe('selecting products', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('shows a bar with the count once something is ticked, and can select the whole page or clear', async () => {
    await openPage()
    expect(screen.queryByRole('region', { name: 'Selected products' })).toBeNull()
    fireEvent.click(box('Coke'))
    expect(bar().getByText(/1 selected/)).toBeTruthy()
    expect(bar().getByRole('button', { name: 'Select all 5 matching' })).toBeTruthy()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all products on this page' }))
    expect(bar().getByText(/5 selected/)).toBeTruthy()
    expect(bar().queryByRole('button', { name: /Select all/ })).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all products on this page' }))
    expect(screen.queryByRole('region', { name: 'Selected products' })).toBeNull()

    fireEvent.click(box('Soap'))
    fireEvent.click(bar().getByRole('button', { name: 'Clear' }))
    expect(box('Soap').checked).toBe(false)
  })

  it('forgets the selection when the filters change, so a batch never reaches rows that are not on screen', async () => {
    await openPage()
    fireEvent.click(box('Coke'))
    fireEvent.change(screen.getAllByLabelText('Category').find((element) => element.tagName === 'SELECT')!, { target: { value: 'Household' } })
    expect(screen.queryByRole('region', { name: 'Selected products' })).toBeNull()
    expect(screen.queryByText('Coke')).toBeNull()
    fireEvent.click(box('Soap'))
    fireEvent.change(screen.getByLabelText('Search products by name or barcode'), { target: { value: 'sham' } })
    expect(screen.queryByRole('region', { name: 'Selected products' })).toBeNull()
  })
})

describe('batch price edit', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('previews old and new prices, sends the change for the ticked products only, and reloads', async () => {
    const products = await openPage()
    const update = vi.spyOn(storeApi, 'batchUpdateProducts').mockResolvedValue({ message: '2 products updated.', updated: 2, skipped: 0 })
    fireEvent.click(box('Coke'))
    fireEvent.click(box('Pepsi'))
    fireEvent.click(bar().getByRole('button', { name: 'Edit prices' }))

    fireEvent.change(dialog().getByLabelText('Selling price change'), { target: { value: 'increase-percent' } })
    fireEvent.change(dialog().getByLabelText('Selling price amount'), { target: { value: '10' } })
    expect(dialog().getAllByText('₱20.00 → ₱22.00')).toHaveLength(2)
    expect(dialog().getAllByText('₱10.00')).toHaveLength(2)
    fireEvent.click(dialog().getByRole('button', { name: 'Update 2 products' }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update).toHaveBeenCalledWith(['Coke', 'Pepsi'], { sellingPrice: { type: 'percent', value: 10 } })
    expect(await screen.findByText('2 products updated.')).toBeTruthy()
    expect(products).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('can change the cost as well, and warns when a product would sell below cost', async () => {
    await openPage()
    const update = vi.spyOn(storeApi, 'batchUpdateProducts').mockResolvedValue({ message: '1 product updated.', updated: 1, skipped: 0 })
    fireEvent.click(box('Soap'))
    fireEvent.click(bar().getByRole('button', { name: 'Edit prices' }))
    fireEvent.change(dialog().getByLabelText('Cost per unit change'), { target: { value: 'set' } })
    fireEvent.change(dialog().getByLabelText('Cost per unit amount'), { target: { value: '9' } })
    expect(dialog().getByText('1 product will sell below cost after this change.')).toBeTruthy()
    fireEvent.click(dialog().getByRole('button', { name: 'Update 1 product' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith(['Soap'], { costPrice: { type: 'set', value: 9 } }))
  })

  it('refuses an empty change and a change that would make a price negative, without calling the server', async () => {
    await openPage()
    const update = vi.spyOn(storeApi, 'batchUpdateProducts')
    fireEvent.click(box('Shampoo'))
    fireEvent.click(box('Rice'))
    fireEvent.click(bar().getByRole('button', { name: 'Edit prices' }))
    fireEvent.click(dialog().getByRole('button', { name: 'Update 2 products' }))
    expect(dialog().getByRole('alert').textContent).toContain('Choose how to change')

    fireEvent.change(dialog().getByLabelText('Selling price change'), { target: { value: 'decrease-amount' } })
    fireEvent.change(dialog().getByLabelText('Selling price amount'), { target: { value: '5' } })
    fireEvent.click(dialog().getByRole('button', { name: 'Update 2 products' }))
    expect(dialog().getByRole('alert').textContent).toContain('1 product would end up with a price below zero')
    expect(update).not.toHaveBeenCalled()
  })

  it('shows the server error in the dialog and keeps the selection', async () => {
    await openPage()
    vi.spyOn(storeApi, 'batchUpdateProducts').mockRejectedValue(new Error('None of the selected products were found.'))
    fireEvent.click(box('Rice'))
    fireEvent.click(bar().getByRole('button', { name: 'Edit prices' }))
    fireEvent.change(dialog().getByLabelText('Selling price change'), { target: { value: 'set' } })
    fireEvent.change(dialog().getByLabelText('Selling price amount'), { target: { value: '55' } })
    fireEvent.click(dialog().getByRole('button', { name: 'Update 1 product' }))
    expect((await dialog().findByRole('alert')).textContent).toBe('None of the selected products were found.')
    fireEvent.click(dialog().getByRole('button', { name: 'Cancel' }))
    expect(box('Rice').checked).toBe(true)
  })
})

describe('batch delete', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('asks first, names the products, then removes only the ticked ones and clears the selection', async () => {
    await openPage()
    const archive = vi.spyOn(storeApi, 'batchArchiveProducts').mockResolvedValue({ message: '2 products removed from the price list.', archived: 2 })
    fireEvent.click(box('Soap'))
    fireEvent.click(box('Shampoo'))
    fireEvent.click(bar().getByRole('button', { name: 'Delete' }))
    const confirm = within(screen.getByRole('alertdialog'))
    expect(confirm.getByRole('heading').textContent).toBe('Delete 2 products?')
    expect(confirm.getByText(/Shampoo, Soap will be removed from your price list/)).toBeTruthy()
    expect(archive).not.toHaveBeenCalled()

    fireEvent.click(confirm.getByRole('button', { name: 'Cancel' }))
    expect(archive).not.toHaveBeenCalled()
    fireEvent.click(bar().getByRole('button', { name: 'Delete' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete 2 products' }))
    await waitFor(() => expect(archive).toHaveBeenCalledWith(['Shampoo', 'Soap']))
    expect(await screen.findByText('2 products removed from the price list.')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Selected products' })).toBeNull()
  })
})

describe('print and download', () => {
  const downloads: Array<{ name: string; type: string }> = []
  beforeEach(() => {
    downloads.length = 0
    URL.createObjectURL = vi.fn((blob: Blob | MediaSource) => { downloads.push({ name: '', type: (blob as Blob).type }); return 'blob:test' })
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloads[downloads.length - 1]!.name = this.download })
  })
  afterEach(() => { cleanup(); vi.restoreAllMocks(); document.querySelectorAll('iframe').forEach((frame) => frame.remove()) })

  const open = () => fireEvent.click(screen.getAllByRole('button', { name: 'Print / download' })[0]!)

  it('starts on the category being filtered, counts what will be included, and downloads Excel and Word', async () => {
    await openPage()
    fireEvent.change(screen.getAllByLabelText('Category').find((element) => element.tagName === 'SELECT')!, { target: { value: 'Household' } })
    open()
    expect((dialog().getByRole('radio', { name: /By category/ }) as HTMLInputElement).checked).toBe(true)
    expect((dialog().getByRole('checkbox', { name: 'Household' }) as HTMLInputElement).checked).toBe(true)
    expect(dialog().getByText('2 products will be included.')).toBeTruthy()

    fireEvent.click(dialog().getByRole('checkbox', { name: 'Groceries' }))
    expect(dialog().getByText('3 products will be included.')).toBeTruthy()

    fireEvent.click(dialog().getByRole('button', { name: 'Download Excel' }))
    fireEvent.click(dialog().getByRole('button', { name: 'Download Word' }))
    expect(downloads.map((download) => download.name)).toEqual([expect.stringMatching(/^price-list-\d{4}-\d{2}-\d{2}\.xlsx$/), expect.stringMatching(/^price-list-\d{4}-\d{2}-\d{2}\.docx$/)])
    expect(downloads[0]!.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(downloads[1]!.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    expect(dialog().getAllByRole('status').some((node) => /Downloaded price-list-.*\.docx/.test(node.textContent ?? ''))).toBe(true)
  })

  it('starts from the products ticked in the table, lets the user pick more, and names the file after the title', async () => {
    await openPage()
    fireEvent.click(box('Coke'))
    fireEvent.click(box('Rice'))
    open()
    expect((dialog().getByRole('radio', { name: /Pick products/ }) as HTMLInputElement).checked).toBe(true)
    expect(dialog().getByText('2 products will be included.')).toBeTruthy()

    fireEvent.change(dialog().getByLabelText('Search products to pick'), { target: { value: 'soap' } })
    const list = within(dialog().getByRole('list', { name: 'Products' }))
    expect(list.queryByText('Coke')).toBeNull()
    fireEvent.click(list.getByRole('checkbox', { name: /Soap/ }))
    expect(dialog().getByText('3 products will be included.')).toBeTruthy()

    fireEvent.change(dialog().getByLabelText('Title'), { target: { value: 'Customer prices' } })
    fireEvent.click(dialog().getByRole('button', { name: 'Download Excel' }))
    expect(downloads[0]!.name).toMatch(/^customer-prices-\d{4}-\d{2}-\d{2}\.xlsx$/)
  })

  it('cannot print or download with nothing chosen, and warns when cost would be shown', async () => {
    await openPage()
    open()
    fireEvent.click(dialog().getByRole('radio', { name: /Pick products/ }))
    expect(dialog().getByText('No products are included yet.')).toBeTruthy()
    for (const name of ['Print', 'Download Word', 'Download Excel']) expect((dialog().getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(dialog().getByRole('radio', { name: /All products/ }))
    expect(dialog().queryByText(/Your cost will be visible/)).toBeNull()
    fireEvent.click(dialog().getByRole('checkbox', { name: 'Cost per unit' }))
    expect(dialog().getByText(/Your cost will be visible/)).toBeTruthy()
  })

  it('prints through a hidden frame holding only the chosen products', async () => {
    await openPage()
    fireEvent.click(box('Coke'))
    open()
    fireEvent.click(dialog().getByRole('button', { name: 'Print' }))
    const frame = document.querySelector('iframe')!
    expect(frame).not.toBeNull()
    expect(frame.getAttribute('aria-hidden')).toBe('true')
    expect(frame.srcdoc).toContain('Coke')
    expect(frame.srcdoc).not.toContain('Pepsi')
    expect(frame.srcdoc).not.toContain('Cost per unit')
  })
})
