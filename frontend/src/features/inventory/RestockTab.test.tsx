import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '../../services/apiClient'
import { businessApi } from '../../services/businessApi'
import { inventoryApi, type PurchaseResult } from '../../services/inventoryApi'
import { item, pageOf } from './inventoryTestData'
import { RestockTab } from './RestockTab'
import type { RestockDraftLine } from './restockLines'

vi.mock('../pos/BarcodeCameraScanner', () => ({
  BarcodeCameraScanner: ({ onDetected }: { onDetected: (code: string) => void }) => <button type="button" onClick={() => onDetected('4800000000017')}>Pretend to scan</button>,
}))

const coke = item('Coke', { barcode: '4800000000017', currentStock: 12, costPrice: 12 })
const soda = item('Soda', { purchaseUnit: 'pack', unitsPerPurchaseUnit: 24, currentStock: 6, minStock: 2, costPrice: 15 })
const gum = item('Gum', { currentStock: 0, minStock: 5, costPrice: 1 })

const receipt = (overrides: Partial<PurchaseResult['purchase']> = {}): PurchaseResult => ({
  message: 'Delivery recorded.',
  purchase: { id: 'pur-1', total: 360, supplierName: null, items: [{ productId: 'Soda', name: 'Soda', added: 24, previousStock: 6, newStock: 30, lineTotal: 360 }], ...overrides },
})

/** Holds the draft lines the way the Inventory page does, so lines survive between renders. */
function Harness({ initial = [], onChanged = vi.fn(), onShowStock = vi.fn() }: { initial?: RestockDraftLine[]; onChanged?: () => void; onShowStock?: () => void }) {
  const [lines, setLines] = useState<RestockDraftLine[]>(initial)
  return <RestockTab lines={lines} setLines={setLines} onChanged={onChanged} onShowStock={onShowStock} />
}

const draft = (product: typeof soda, overrides: Partial<RestockDraftLine> = {}): RestockDraftLine => ({ product, unit: product.purchaseUnit ? 'purchase' : 'base', quantity: '1', unitCost: product.purchaseUnit ? String(product.costPrice * product.unitsPerPurchaseUnit!) : String(product.costPrice), ...overrides })

beforeEach(() => {
  vi.spyOn(businessApi, 'suppliers').mockResolvedValue({ suppliers: [{ _id: 'sup-1', name: 'Metro Wholesale' }] } as never)
  vi.spyOn(businessApi, 'restockInsights').mockResolvedValue({ suggestions: [] } as never)
  vi.spyOn(inventoryApi, 'listProducts').mockImplementation(async (query) => {
    if (query?.status === 'out') return pageOf([gum])
    if (query?.status === 'low') return pageOf([])
    return pageOf([coke, soda].filter((product) => !query?.q || product.name.toLowerCase().includes(query.q.toLowerCase())))
  })
})
afterEach(() => { cleanup() })

describe('Restock tab: building a delivery', () => {
  it('starts empty and explains what to do', async () => {
    render(<Harness />)
    expect(screen.getByText('No products in this delivery yet.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Review delivery' })).toBeNull()
    await screen.findByText(/1 product to restock/)
  })

  it('finds a product by typing, adds it, and shows what the line will do', async () => {
    render(<Harness />)
    fireEvent.change(screen.getByLabelText('Add a product to this delivery'), { target: { value: 'Soda' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Add Soda to delivery' }))

    const line = screen.getByRole('list', { name: 'Products in this delivery' })
    expect((within(line).getByLabelText('Quantity received of Soda') as HTMLInputElement).value).toBe('1')
    expect(within(line).getByText(/Adds/).textContent).toContain('24 pieces')
    expect(within(line).getByText(/stock becomes 30/)).toBeTruthy()
    expect(within(line).getByText(/₱360\.00 total/)).toBeTruthy()
    expect(within(line).getByText(/₱15\.00 each/)).toBeTruthy()
    expect((screen.getByLabelText('Add a product to this delivery') as HTMLInputElement).value).toBe('')
  })

  it('adds the product behind a scanned barcode and adds one more when scanned again', async () => {
    const lookup = vi.spyOn(inventoryApi, 'lookupBarcode').mockResolvedValue({ found: true, product: coke })
    render(<Harness />)
    const box = screen.getByLabelText('Add a product to this delivery')
    for (let scans = 0; scans < 2; scans += 1) {
      fireEvent.change(box, { target: { value: '4800000000017' } })
      fireEvent.keyDown(box, { key: 'Enter' })
      await waitFor(() => expect(lookup).toHaveBeenCalledTimes(scans + 1))
      await waitFor(() => expect((box as HTMLInputElement).value).toBe(''))
    }
    expect((screen.getByLabelText('Quantity received of Coke') as HTMLInputElement).value).toBe('2')
  })

  it('reads barcodes from the camera too', async () => {
    const lookup = vi.spyOn(inventoryApi, 'lookupBarcode').mockResolvedValue({ found: true, product: coke })
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Scan a barcode with the camera' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pretend to scan' }))
    await waitFor(() => expect(lookup).toHaveBeenCalledWith('4800000000017'))
    expect(await screen.findByLabelText('Quantity received of Coke')).toBeTruthy()
  })

  it('offers to create a product for an unknown barcode instead of guessing', async () => {
    vi.spyOn(inventoryApi, 'lookupBarcode').mockResolvedValue({ found: false, barcode: '4809999999990', message: 'Barcode not registered.' })
    render(<Harness />)
    const box = screen.getByLabelText('Add a product to this delivery')
    fireEvent.change(box, { target: { value: '4809999999990' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect((await screen.findByRole('alert')).textContent).toContain('No product has barcode 4809999999990')
    fireEvent.click(screen.getByRole('button', { name: 'Add a product with this barcode' }))
    const dialog = await screen.findByRole('dialog')
    expect((within(dialog).getByLabelText(/barcode/i) as HTMLInputElement).value).toBe('4809999999990')
  })

  it('says so, and keeps working, when a barcode lookup fails', async () => {
    vi.spyOn(inventoryApi, 'lookupBarcode').mockRejectedValue(new ApiError('Network down.', 0))
    render(<Harness />)
    const box = screen.getByLabelText('Add a product to this delivery')
    fireEvent.change(box, { target: { value: '4800000000017' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(await screen.findByText('Network down.')).toBeTruthy()
    expect((box as HTMLInputElement).value).toBe('4800000000017')
  })

  it('says when a search finds nothing and offers to add a product', async () => {
    render(<Harness />)
    fireEvent.change(screen.getByLabelText('Add a product to this delivery'), { target: { value: 'nothing here' } })
    expect(await screen.findByText(/No product matches/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add a new product' }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  it('adds a low-stock product from the suggestions with the suggested quantity', async () => {
    render(<Harness />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add Gum, suggested quantity 10' }))
    expect((screen.getByLabelText('Quantity received of Gum') as HTMLInputElement).value).toBe('10')
  })

  it('uses sales-based suggestions when the server has them', async () => {
    vi.spyOn(businessApi, 'restockInsights').mockResolvedValue({ suggestions: [{ productId: 'Gum', suggestedOrderQuantity: 40, reason: 'Sells about 4 a day.' }] } as never)
    render(<Harness />)
    expect(await screen.findByText(/Sells about 4 a day\. Suggested: 40 pieces/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add Gum, suggested quantity 40' }))
    expect((screen.getByLabelText('Quantity received of Gum') as HTMLInputElement).value).toBe('40')
  })

  it('keeps working when suggestions cannot load, with a retry', async () => {
    const list = vi.mocked(inventoryApi.listProducts)
    list.mockRejectedValueOnce(new ApiError('Suggestions failed.', 500))
    render(<Harness />)
    expect(await screen.findByText(/Suggestions failed\./)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByText(/1 product to restock/)
  })

  it('switches a pack product between packs and pieces and re-prices the line', async () => {
    render(<Harness initial={[draft(soda)]} />)
    const select = screen.getByLabelText('Unit received for Soda')
    fireEvent.change(select, { target: { value: 'base' } })
    expect((screen.getByLabelText('Price paid for Soda') as HTMLInputElement).value).toBe('15')
    fireEvent.change(screen.getByLabelText('Quantity received of Soda'), { target: { value: '10' } })
    expect(screen.getByText(/Adds/).textContent).toContain('10 pieces')
    fireEvent.change(select, { target: { value: 'purchase' } })
    expect((screen.getByLabelText('Price paid for Soda') as HTMLInputElement).value).toBe('360')
  })

  it('shows what is wrong with a line and blocks review until it is fixed', async () => {
    render(<Harness initial={[draft(coke)]} />)
    fireEvent.change(screen.getByLabelText('Quantity received of Coke'), { target: { value: '1.5' } })
    expect(screen.getAllByRole('alert')[0]!.textContent).toContain('whole number')
    fireEvent.click(screen.getByRole('button', { name: 'Review delivery' }))
    expect(screen.getAllByRole('alert').some((alert) => alert.textContent?.startsWith('Coke:'))).toBe(true)
    expect(screen.queryByRole('region', { name: 'Review delivery' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Quantity received of Coke'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review delivery' }))
    expect(screen.getByRole('region', { name: 'Review delivery' })).toBeTruthy()
  })

  it('removes a product and clears the whole delivery', async () => {
    render(<Harness initial={[draft(coke), draft(soda)]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Coke from delivery' }))
    expect(screen.queryByLabelText('Quantity received of Coke')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(screen.getByText('No products in this delivery yet.')).toBeTruthy()
  })
})

describe('Restock tab: confirming', () => {
  const toReview = async (initial: RestockDraftLine[] = [draft(soda)]) => {
    render(<Harness initial={initial} />)
    fireEvent.click(screen.getByRole('button', { name: 'Review delivery' }))
    return screen.getByRole('region', { name: 'Review delivery' })
  }

  it('shows a review with stock before and after and nothing is saved until confirmed', async () => {
    const restock = vi.spyOn(inventoryApi, 'restock')
    const review = await toReview([draft(soda, { quantity: '2', unitCost: '300' })])
    expect(within(review).getByText('+48')).toBeTruthy()
    expect(within(review).getByText('6 → 54')).toBeTruthy()
    expect(within(review).getAllByText('₱600.00').length).toBeGreaterThan(0)
    expect(within(review).getByText(/cost per piece: ₱15\.00 → ₱12\.50/)).toBeTruthy()
    expect(restock).not.toHaveBeenCalled()
    fireEvent.click(within(review).getByRole('button', { name: 'Back' }))
    expect((screen.getByLabelText('Quantity received of Soda') as HTMLInputElement).value).toBe('2')
  })

  it('sends the exact items with a key, supplier and cost option, then shows the result', async () => {
    const restock = vi.spyOn(inventoryApi, 'restock').mockResolvedValue(receipt({ supplierName: 'Metro Wholesale' }))
    const onChanged = vi.fn()
    render(<Harness initial={[draft(soda, { quantity: '1' })]} onChanged={onChanged} />)
    await screen.findByRole('option', { name: 'Metro Wholesale' })
    fireEvent.change(screen.getByLabelText('Supplier (optional)'), { target: { value: 'sup-1' } })
    fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: ' Invoice 55 ' } })
    fireEvent.click(screen.getByLabelText(/Update each product’s cost/))
    fireEvent.click(screen.getByRole('button', { name: 'Review delivery' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and update stock' }))

    await waitFor(() => expect(restock).toHaveBeenCalledTimes(1))
    expect(restock).toHaveBeenCalledWith({ items: [{ productId: 'Soda', quantity: 1, unit: 'purchase', unitCost: 360 }], supplierId: 'sup-1', note: 'Invoice 55', updateProductCost: false, idempotencyKey: expect.stringMatching(/^k-/) })
    expect(await screen.findByText('Delivery recorded')).toBeTruthy()
    expect(screen.getByText(/from Metro Wholesale · total paid ₱360\.00/)).toBeTruthy()
    expect(screen.getByText('6 → 30')).toBeTruthy()
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('records the delivery only once when confirm is pressed twice', async () => {
    let finish: (result: PurchaseResult) => void = () => undefined
    const restock = vi.spyOn(inventoryApi, 'restock').mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const review = await toReview()
    const confirm = within(review).getByRole('button', { name: 'Confirm and update stock' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(restock).toHaveBeenCalledTimes(1)
    expect((within(review).getByRole('button', { name: 'Saving…' }) as HTMLButtonElement).disabled).toBe(true)
    finish(receipt())
    await screen.findByText('Delivery recorded')
  })

  it('keeps the whole delivery when saving fails, and retries with the same key', async () => {
    const restock = vi.spyOn(inventoryApi, 'restock').mockRejectedValueOnce(new ApiError('Connection lost.', 0)).mockResolvedValue(receipt())
    const review = await toReview([draft(soda, { quantity: '2', unitCost: '300' })])
    fireEvent.click(within(review).getByRole('button', { name: 'Confirm and update stock' }))
    expect((await within(review).findByRole('alert')).textContent).toContain('Connection lost.')

    fireEvent.click(within(review).getByRole('button', { name: 'Back' }))
    expect((screen.getByLabelText('Quantity received of Soda') as HTMLInputElement).value).toBe('2')
    fireEvent.click(screen.getByRole('button', { name: 'Review delivery' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and update stock' }))
    await screen.findByText('Delivery recorded')
    expect(restock).toHaveBeenCalledTimes(2)
    expect(restock.mock.calls[1]![0].idempotencyKey).toBe(restock.mock.calls[0]![0].idempotencyKey)
  })

  it('shows the server reason when it refuses the delivery', async () => {
    vi.spyOn(inventoryApi, 'restock').mockRejectedValue(new ApiError('Soda was archived.', 409))
    const review = await toReview()
    fireEvent.click(within(review).getByRole('button', { name: 'Confirm and update stock' }))
    expect((await within(review).findByRole('alert')).textContent).toBe('Soda was archived.')
    expect(screen.queryByText('Delivery recorded')).toBeNull()
  })

  it('tells the person when the server recognised a repeat of the same delivery', async () => {
    vi.spyOn(inventoryApi, 'restock').mockResolvedValue({ ...receipt(), replayed: true })
    const review = await toReview()
    fireEvent.click(within(review).getByRole('button', { name: 'Confirm and update stock' }))
    expect(await screen.findByText('This delivery was already recorded')).toBeTruthy()
  })

  it('starts a fresh delivery with a new key and can jump to the stock list', async () => {
    const restock = vi.spyOn(inventoryApi, 'restock').mockResolvedValue(receipt())
    const onShowStock = vi.fn()
    render(<Harness initial={[draft(soda)]} onShowStock={onShowStock} />)
    fireEvent.click(screen.getByRole('button', { name: 'Review delivery' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and update stock' }))
    await screen.findByText('Delivery recorded')
    fireEvent.click(screen.getByRole('button', { name: 'View stock' }))
    expect(onShowStock).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Receive another delivery' }))
    expect(screen.getByText('No products in this delivery yet.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Add a product to this delivery'), { target: { value: 'Soda' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Add Soda to delivery' }))
    fireEvent.click(screen.getByRole('button', { name: 'Review delivery' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and update stock' }))
    await waitFor(() => expect(restock).toHaveBeenCalledTimes(2))
    expect(restock.mock.calls[1]![0].idempotencyKey).not.toBe(restock.mock.calls[0]![0].idempotencyKey)
  })
})
