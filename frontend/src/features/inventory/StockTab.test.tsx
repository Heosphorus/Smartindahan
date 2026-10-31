import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '../../services/apiClient'
import { inventoryApi } from '../../services/inventoryApi'
import { storeApi } from '../../services/storeApi'
import { item, pageOf } from './inventoryTestData'
import { StockTab } from './StockTab'

vi.mock('../pos/BarcodeCameraScanner', () => ({
  BarcodeCameraScanner: ({ onDetected, onClose }: { onDetected: (code: string) => void; onClose: () => void }) => <div role="dialog" aria-label="Camera"><button type="button" onClick={() => onDetected('4800000000017')}>Pretend to scan</button><button type="button" onClick={onClose}>Close camera</button></div>,
}))

const coke = item('Coke', { barcode: '4800000000017', currentStock: 12, minStock: 4 })
const chips = item('Chips', { category: 'Snacks', currentStock: 2, minStock: 5 })
const gum = item('Gum', { category: 'Snacks', currentStock: 0, minStock: 5 })
const soda = item('Soda', { purchaseUnit: 'pack', unitsPerPurchaseUnit: 24, currentStock: 6, minStock: 2 })

const listAll = () => vi.spyOn(inventoryApi, 'listProducts').mockResolvedValue(pageOf([coke, chips, gum]))
const renderTab = (props: Partial<React.ComponentProps<typeof StockTab>> = {}) => render(<StockTab onRestock={vi.fn()} {...props} />)
const row = (name: string) => screen.getByRole('group', { name: `Actions for ${name}` }).closest('li') as HTMLElement

afterEach(() => { cleanup() })

describe('Stock tab: finding products', () => {
  it('shows a loading message, then products with stock status and whole-store counts', async () => {
    listAll()
    renderTab()
    expect(screen.getByText('Loading products…')).toBeTruthy()
    await screen.findByText('Coke')

    expect(within(row('Chips')).getByText('Low stock')).toBeTruthy()
    expect(within(row('Gum')).getByText('Out of stock')).toBeTruthy()
    expect(within(row('Coke')).getByText('In stock')).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Low stock\s*1$/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Out of stock\s*1$/ })).toBeTruthy()
    // Only products that need attention offer Restock directly.
    expect(within(row('Coke')).queryByRole('button', { name: 'Restock Coke' })).toBeNull()
    expect(within(row('Gum')).getByRole('button', { name: 'Restock Gum' })).toBeTruthy()
    // Nothing to remove from an empty shelf.
    expect((within(row('Gum')).getByRole('button', { name: 'Remove stock from Gum' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('asks the server to search only after typing pauses, using one request for a fast typist', async () => {
    const list = listAll()
    renderTab()
    await screen.findByText('Coke')
    list.mockClear()

    const box = screen.getByLabelText('Search or scan a product')
    for (const text of ['c', 'ch', 'chi', 'chip']) fireEvent.change(box, { target: { value: text } })
    expect(list).not.toHaveBeenCalled()
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1))
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ q: 'chip', page: 1, limit: 20 }))
  })

  it('filters by stock level and category and sorts by lowest stock, all on the server', async () => {
    const list = listAll()
    renderTab()
    await screen.findByText('Coke')

    fireEvent.click(screen.getByRole('button', { name: /^Low stock/ }))
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'low' })))
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'Snacks' } })
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'low', category: 'Snacks' })))
    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'stock' } })
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'stock' })))
    expect(screen.getByRole('button', { name: /^Low stock/ }).getAttribute('aria-pressed')).toBe('true')
  })

  it('pages through long lists', async () => {
    const many = Array.from({ length: 20 }, (_, index) => item(`Item ${index + 1}`))
    const list = vi.spyOn(inventoryApi, 'listProducts').mockImplementation(async (query) => pageOf(many, { pagination: { page: query?.page ?? 1, limit: 20, total: 45 } }))
    renderTab()
    await screen.findByText('Item 1')
    expect(screen.getByText(/1–20 of 45/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })))
    await screen.findByText(/21–40 of 45/)
  })

  it('explains an empty store and an empty search differently, and can clear the search', async () => {
    const list = vi.spyOn(inventoryApi, 'listProducts').mockResolvedValue(pageOf([]))
    renderTab()
    expect(await screen.findByText('No products yet.')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Search or scan a product'), { target: { value: 'zzz' } })
    expect(await screen.findByText('No products match.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(await screen.findByText('No products yet.')).toBeTruthy()
    expect((screen.getByLabelText('Search or scan a product') as HTMLInputElement).value).toBe('')
    expect(list).toHaveBeenLastCalledWith(expect.not.objectContaining({ q: 'zzz' }))
  })

  it('shows a load error with a retry that recovers', async () => {
    const list = vi.spyOn(inventoryApi, 'listProducts').mockRejectedValueOnce(new ApiError('Server is down.', 503)).mockResolvedValue(pageOf([coke]))
    renderTab()
    expect((await screen.findByRole('alert')).textContent).toContain('Server is down.')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByText('Coke')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('reloads when stock was changed elsewhere', async () => {
    const list = listAll()
    const view = renderTab({ refreshSignal: 0 })
    await screen.findByText('Coke')
    view.rerender(<StockTab onRestock={vi.fn()} refreshSignal={1} />)
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
  })
})

describe('Stock tab: scanning', () => {
  it('opens the product behind a barcode typed or scanned with a USB scanner (digits then Enter)', async () => {
    listAll()
    const lookup = vi.spyOn(inventoryApi, 'lookupBarcode').mockResolvedValue({ found: true, product: coke })
    renderTab()
    await screen.findByText('Coke')

    const box = screen.getByLabelText('Search or scan a product')
    fireEvent.change(box, { target: { value: '4800000000017' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(lookup).toHaveBeenCalledWith('4800000000017'))
    expect(await screen.findByText(/Found Coke: 12 pieces in stock/)).toBeTruthy()
  })

  it('does not treat an ordinary word as a barcode', async () => {
    listAll()
    const lookup = vi.spyOn(inventoryApi, 'lookupBarcode')
    renderTab()
    await screen.findByText('Coke')
    const box = screen.getByLabelText('Search or scan a product')
    fireEvent.change(box, { target: { value: 'coke' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(lookup).not.toHaveBeenCalled()
  })

  it('reads a barcode from the camera', async () => {
    listAll()
    const lookup = vi.spyOn(inventoryApi, 'lookupBarcode').mockResolvedValue({ found: true, product: coke })
    renderTab()
    await screen.findByText('Coke')
    fireEvent.click(screen.getByRole('button', { name: 'Scan a barcode with the camera' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pretend to scan' }))
    await waitFor(() => expect(lookup).toHaveBeenCalledWith('4800000000017'))
    expect(screen.queryByRole('dialog', { name: 'Camera' })).toBeNull()
  })

  it('offers to add a product when the barcode is new, with the barcode already filled in', async () => {
    listAll()
    vi.spyOn(inventoryApi, 'lookupBarcode').mockResolvedValue({ found: false, barcode: '4809999999990', message: 'Barcode not registered.' })
    renderTab()
    await screen.findByText('Coke')
    const box = screen.getByLabelText('Search or scan a product')
    fireEvent.change(box, { target: { value: '4809999999990' } })
    fireEvent.keyDown(box, { key: 'Enter' })

    expect((await screen.findByRole('alert')).textContent).toContain('No product in your store has this barcode.')
    fireEvent.click(screen.getByRole('button', { name: 'Add a product with this barcode' }))
    const dialog = await screen.findByRole('dialog')
    expect((within(dialog).getByLabelText(/barcode/i) as HTMLInputElement).value).toBe('4809999999990')
  })

  it('tells the person when the barcode belongs to an archived product and restores it on request', async () => {
    listAll()
    const lookup = vi.spyOn(inventoryApi, 'lookupBarcode')
      .mockResolvedValueOnce({ found: false, barcode: '4801111111116', message: 'Old Soda uses this barcode but is archived.', archived: { id: 'p-old', name: 'Old Soda' } })
      .mockResolvedValueOnce({ found: true, product: item('Old Soda', { barcode: '4801111111116' }) })
    const restore = vi.spyOn(inventoryApi, 'restoreProduct').mockResolvedValue({ product: item('Old Soda') })
    renderTab()
    await screen.findByText('Coke')
    const box = screen.getByLabelText('Search or scan a product')
    fireEvent.change(box, { target: { value: '4801111111116' } })
    fireEvent.keyDown(box, { key: 'Enter' })

    expect((await screen.findByRole('alert')).textContent).toContain('archived')
    fireEvent.click(screen.getByRole('button', { name: 'Restore Old Soda' }))
    await waitFor(() => expect(restore).toHaveBeenCalledWith('p-old'))
    await waitFor(() => expect(lookup).toHaveBeenCalledTimes(2))
  })

  it('keeps manual entry available when the lookup fails', async () => {
    listAll()
    vi.spyOn(inventoryApi, 'lookupBarcode').mockRejectedValue(new ApiError('Network down.', 0))
    renderTab()
    await screen.findByText('Coke')
    const box = screen.getByLabelText('Search or scan a product')
    fireEvent.change(box, { target: { value: '4800000000017' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Network down.')
    expect(alert.textContent).toContain('type the barcode and press Enter')
    expect((box as HTMLInputElement).value).toBe('4800000000017')
  })
})

describe('Stock tab: quick actions', () => {
  it('adds stock with one idempotency key, shows success and reloads the list', async () => {
    const list = listAll()
    const stockIn = vi.spyOn(inventoryApi, 'stockIn').mockResolvedValue({ message: 'ok' })
    renderTab()
    await screen.findByText('Coke')
    fireEvent.click(screen.getByRole('button', { name: 'Add stock to Coke' }))
    const form = screen.getByRole('form', { name: 'Add stock to Coke' })
    fireEvent.change(within(form).getByLabelText('Quantity to add'), { target: { value: '12' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Add 12 pieces' }))

    await waitFor(() => expect(stockIn).toHaveBeenCalledWith('Coke', 12, expect.stringMatching(/^k-/)))
    expect(await screen.findByText('Added 12 pieces to Coke.')).toBeTruthy()
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('form', { name: 'Add stock to Coke' })).toBeNull()
  })

  it('converts packs to pieces before sending, and shows the result first', async () => {
    vi.spyOn(inventoryApi, 'listProducts').mockResolvedValue(pageOf([soda]))
    const stockIn = vi.spyOn(inventoryApi, 'stockIn').mockResolvedValue({ message: 'ok' })
    renderTab()
    await screen.findByText('Soda')
    fireEvent.click(screen.getByRole('button', { name: 'Add stock to Soda' }))
    const form = screen.getByRole('form', { name: 'Add stock to Soda' })
    fireEvent.change(within(form).getByLabelText('In'), { target: { value: 'purchase' } })
    fireEvent.change(within(form).getByLabelText('Quantity to add'), { target: { value: '2' } })
    expect(within(form).getByText('That adds 48 pieces.')).toBeTruthy()
    fireEvent.click(within(form).getByRole('button', { name: 'Add 48 pieces' }))
    await waitFor(() => expect(stockIn).toHaveBeenCalledWith('Soda', 48, expect.any(String)))
  })

  it('rejects a quantity that is not a whole number of pieces and sends nothing', async () => {
    listAll()
    const stockIn = vi.spyOn(inventoryApi, 'stockIn')
    renderTab()
    await screen.findByText('Coke')
    fireEvent.click(screen.getByRole('button', { name: 'Add stock to Coke' }))
    const form = screen.getByRole('form', { name: 'Add stock to Coke' })
    fireEvent.change(within(form).getByLabelText('Quantity to add'), { target: { value: '1.5' } })
    fireEvent.submit(form)
    expect((await within(form).findByRole('alert')).textContent).toContain('whole number')
    expect(stockIn).not.toHaveBeenCalled()
  })

  it('keeps the form and reuses the same key when adding stock fails, so a retry cannot double count', async () => {
    listAll()
    const stockIn = vi.spyOn(inventoryApi, 'stockIn').mockRejectedValueOnce(new ApiError('Connection lost.', 0)).mockResolvedValue({ message: 'ok' })
    renderTab()
    await screen.findByText('Coke')
    fireEvent.click(screen.getByRole('button', { name: 'Add stock to Coke' }))
    const form = screen.getByRole('form', { name: 'Add stock to Coke' })
    fireEvent.change(within(form).getByLabelText('Quantity to add'), { target: { value: '5' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Add 5 pieces' }))

    expect((await within(form).findByRole('alert')).textContent).toContain('Connection lost.')
    expect((within(form).getByLabelText('Quantity to add') as HTMLInputElement).value).toBe('5')
    fireEvent.click(within(form).getByRole('button', { name: 'Add 5 pieces' }))
    await waitFor(() => expect(stockIn).toHaveBeenCalledTimes(2))
    expect(stockIn.mock.calls[0]![2]).toBe(stockIn.mock.calls[1]![2])
  })

  it('does not submit twice when the button is pressed twice quickly', async () => {
    listAll()
    let finish: () => void = () => undefined
    const stockIn = vi.spyOn(inventoryApi, 'stockIn').mockImplementation(() => new Promise((resolve) => { finish = () => resolve({ message: 'ok' }) }))
    renderTab()
    await screen.findByText('Coke')
    fireEvent.click(screen.getByRole('button', { name: 'Add stock to Coke' }))
    const form = screen.getByRole('form', { name: 'Add stock to Coke' })
    fireEvent.change(within(form).getByLabelText('Quantity to add'), { target: { value: '5' } })
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(stockIn).toHaveBeenCalledTimes(1)
    finish()
    await screen.findByText('Added 5 pieces to Coke.')
  })

  it('asks to confirm before removing stock, then records the reason', async () => {
    listAll()
    const stockOut = vi.spyOn(inventoryApi, 'stockOut').mockResolvedValue({ message: 'ok', product: { id: 'Coke', currentStock: 10 } })
    renderTab()
    await screen.findByText('Coke')
    fireEvent.click(screen.getByRole('button', { name: 'Remove stock from Coke' }))
    const form = screen.getByRole('form', { name: 'Remove stock from Coke' })
    fireEvent.change(within(form).getByLabelText('Quantity to remove'), { target: { value: '2' } })
    fireEvent.change(within(form).getByLabelText('Reason'), { target: { value: 'Expired' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Remove stock' }))

    expect(stockOut).not.toHaveBeenCalled()
    expect(within(form).getByText(/Stock will go from 12 to 10/)).toBeTruthy()
    fireEvent.click(within(form).getByRole('button', { name: 'Confirm removal' }))
    await waitFor(() => expect(stockOut).toHaveBeenCalledWith('Coke', 2, 'Expired', expect.stringMatching(/^k-/), undefined))
    expect(await screen.findByText(/Removed 2 pieces of Coke \(expired\)/)).toBeTruthy()
  })

  it('refuses to remove more than is in stock, and goes back to the first step after changing the amount', async () => {
    listAll()
    const stockOut = vi.spyOn(inventoryApi, 'stockOut')
    renderTab()
    await screen.findByText('Chips')
    fireEvent.click(screen.getByRole('button', { name: 'Remove stock from Chips' }))
    const form = screen.getByRole('form', { name: 'Remove stock from Chips' })
    const quantity = within(form).getByLabelText('Quantity to remove')
    fireEvent.change(quantity, { target: { value: '5' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Remove stock' }))
    expect((await within(form).findByRole('alert')).textContent).toContain('Only 2 pieces in stock')

    fireEvent.change(quantity, { target: { value: '1' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Remove stock' }))
    expect(within(form).getByRole('button', { name: 'Confirm removal' })).toBeTruthy()
    fireEvent.change(quantity, { target: { value: '2' } })
    expect(within(form).getByRole('button', { name: 'Remove stock' })).toBeTruthy()
    expect(stockOut).not.toHaveBeenCalled()
  })

  it('shows the server message when a removal is refused, and asks to confirm again', async () => {
    listAll()
    vi.spyOn(inventoryApi, 'stockOut').mockRejectedValue(new ApiError('Only 1 left; someone just sold some.', 409))
    renderTab()
    await screen.findByText('Coke')
    fireEvent.click(screen.getByRole('button', { name: 'Remove stock from Coke' }))
    const form = screen.getByRole('form', { name: 'Remove stock from Coke' })
    fireEvent.change(within(form).getByLabelText('Quantity to remove'), { target: { value: '2' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Remove stock' }))
    fireEvent.click(within(form).getByRole('button', { name: 'Confirm removal' }))
    expect((await within(form).findByText(/someone just sold some/)).textContent).toBeTruthy()
    expect(within(form).getByRole('button', { name: 'Remove stock' })).toBeTruthy()
  })

  it('saves only the prices that changed, and warns about selling below cost', async () => {
    listAll()
    const update = vi.spyOn(storeApi, 'updateProduct').mockResolvedValue({} as never)
    renderTab()
    await screen.findByText('Coke')
    fireEvent.click(screen.getByRole('button', { name: 'Edit prices for Coke' }))
    const form = screen.getByRole('form', { name: 'Edit prices for Coke' })

    fireEvent.click(within(form).getByRole('button', { name: 'Save changes' }))
    expect((await within(form).findByRole('alert')).textContent).toContain('Nothing was changed')
    fireEvent.change(within(form).getByLabelText('Selling price (₱)'), { target: { value: '10' } })
    expect(within(form).getByText(/Selling below cost/)).toBeTruthy()
    fireEvent.change(within(form).getByLabelText('Selling price (₱)'), { target: { value: '25' } })
    fireEvent.change(within(form).getByLabelText('Alert me when stock is at or below'), { target: { value: '6' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(update).toHaveBeenCalledWith('Coke', { sellingPrice: 25, minStock: 6 }))
    expect(await screen.findByText('Saved changes to Coke.')).toBeTruthy()
  })

  it('rejects invalid prices without calling the server', async () => {
    listAll()
    const update = vi.spyOn(storeApi, 'updateProduct')
    renderTab()
    await screen.findByText('Coke')
    fireEvent.click(screen.getByRole('button', { name: 'Edit prices for Coke' }))
    const form = screen.getByRole('form', { name: 'Edit prices for Coke' })
    fireEvent.change(within(form).getByLabelText('Selling price (₱)'), { target: { value: '-5' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save changes' }))
    expect((await within(form).findByRole('alert')).textContent).toContain('numbers of zero or more')
    fireEvent.change(within(form).getByLabelText('Selling price (₱)'), { target: { value: '25' } })
    fireEvent.change(within(form).getByLabelText('Alert me when stock is at or below'), { target: { value: '2.5' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save changes' }))
    expect((await within(form).findByRole('alert')).textContent).toContain('whole number')
    expect(update).not.toHaveBeenCalled()
  })

  it('shows recent stock movements, an empty message, and a retry on error', async () => {
    listAll()
    const movements = vi.spyOn(inventoryApi, 'movements')
      .mockRejectedValueOnce(new ApiError('History unavailable.', 500))
      .mockResolvedValueOnce({ movements: [{ id: 'm1', productId: 'Coke', type: 'sale', quantity: -2, previousStock: 14, newStock: 12, createdAt: '2026-10-30T08:00:00.000Z' }, { id: 'm2', productId: 'Coke', type: 'stock_in', quantity: 24, previousStock: 0, newStock: 24, unitCost: 15, createdAt: '2026-10-29T08:00:00.000Z' }], pagination: { total: 2 } })
    renderTab()
    await screen.findByText('Coke')
    fireEvent.click(screen.getByRole('button', { name: 'Stock history for Coke' }))
    expect((await screen.findByText(/History unavailable/)).textContent).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Sold')).toBeTruthy()
    expect(screen.getByText('-2')).toBeTruthy()
    expect(screen.getByText('+24')).toBeTruthy()
    expect(screen.getByText(/Stock added · cost/)).toBeTruthy()
    expect(movements).toHaveBeenCalledTimes(2)
  })

  it('hands a low product to the restock tab', async () => {
    listAll()
    const onRestock = vi.fn()
    renderTab({ onRestock })
    await screen.findByText('Chips')
    fireEvent.click(screen.getByRole('button', { name: 'Restock Chips' }))
    expect(onRestock).toHaveBeenCalledWith(expect.objectContaining({ name: 'Chips' }))
  })
})

describe('Stock tab: adding a product', () => {
  it('opens the add product form from the toolbar and closes it again on cancel', async () => {
    listAll()
    renderTab()
    await screen.findByText('Coke')
    fireEvent.click(screen.getAllByRole('button', { name: 'Add product' })[0]!)
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /cancel/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
