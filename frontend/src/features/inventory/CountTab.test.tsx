import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '../../services/apiClient'
import { inventoryApi, type CountItem, type StockCount } from '../../services/inventoryApi'
import { CountTab } from './CountTab'
import { item, pageOf } from './inventoryTestData'

vi.mock('../pos/BarcodeCameraScanner', () => ({
  BarcodeCameraScanner: ({ onDetected, continuous }: { onDetected: (code: string) => void; continuous?: boolean }) => <button type="button" data-continuous={String(Boolean(continuous))} onClick={() => onDetected('4800000000017')}>Pretend to scan</button>,
}))

const coke = item('Coke', { barcode: '4800000000017', currentStock: 12 })
const chips = item('Chips', { category: 'Snacks', currentStock: 8 })

const countItem = (overrides: Partial<CountItem> = {}): CountItem => ({ productId: 'Coke', name: 'Coke', unit: 'piece', expectedQuantity: 12, countedQuantity: 9, difference: -3, reason: '', ...overrides })
const savedCount = (items: CountItem[], overrides: Partial<StockCount> = {}): StockCount => ({ id: 'count-1', name: 'Count 1', status: 'open', items, ...overrides })

beforeEach(() => {
  vi.spyOn(inventoryApi, 'listCounts').mockResolvedValue({ counts: [] })
  vi.spyOn(inventoryApi, 'listProducts').mockImplementation(async (query) => pageOf([coke, chips].filter((product) => (!query?.q || product.name.toLowerCase().includes(query.q.toLowerCase())) && (!query?.category || product.category === query.category))))
})
afterEach(() => { cleanup() })

const startCounting = async (onChanged = vi.fn()) => {
  render(<CountTab onChanged={onChanged} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Start a new count' }))
  return onChanged
}
const countInput = (name: string) => screen.getByLabelText(`Counted quantity for ${name}`) as HTMLInputElement

describe('Count tab: the list', () => {
  it('shows a loading state, then an empty one', async () => {
    render(<CountTab onChanged={vi.fn()} />)
    expect(screen.getByText('Loading counts…')).toBeTruthy()
    expect(await screen.findByText('No counts in progress.')).toBeTruthy()
  })

  it('lists counts in progress and recently applied ones', async () => {
    vi.mocked(inventoryApi.listCounts).mockImplementation(async (status) => status === 'open'
      ? { counts: [{ id: 'c1', name: 'Back shelf', status: 'open', itemCount: 3, discrepancies: 1, updatedAt: '2026-10-30T08:00:00.000Z', appliedAt: null }] }
      : { counts: [{ id: 'c0', name: 'Last week', status: 'applied', itemCount: 5, discrepancies: 0, updatedAt: '2026-10-20T08:00:00.000Z', appliedAt: '2026-10-21T08:00:00.000Z' }] })
    render(<CountTab onChanged={vi.fn()} />)
    expect(await screen.findByText('Back shelf')).toBeTruthy()
    expect(screen.getByText(/3 products counted · 1 difference/)).toBeTruthy()
    expect(screen.getByText('Last week')).toBeTruthy()
  })

  it('shows a load error with a retry', async () => {
    vi.mocked(inventoryApi.listCounts).mockRejectedValueOnce(new ApiError('Counts unavailable.', 500))
    render(<CountTab onChanged={vi.fn()} />)
    expect((await screen.findByRole('alert')).textContent).toContain('Counts unavailable.')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('No counts in progress.')).toBeTruthy()
  })

  it('continues a saved count with its saved quantities', async () => {
    vi.mocked(inventoryApi.listCounts).mockImplementation(async (status) => ({ counts: status === 'open' ? [{ id: 'c1', name: 'Back shelf', status: 'open', itemCount: 1, discrepancies: 1, updatedAt: '2026-10-30T08:00:00.000Z', appliedAt: null }] : [] }))
    vi.spyOn(inventoryApi, 'getCount').mockResolvedValue({ count: savedCount([countItem()], { id: 'c1', name: 'Back shelf' }) })
    render(<CountTab onChanged={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Continue Back shelf' }))
    expect((await screen.findByLabelText('Counted quantity for Coke') as HTMLInputElement).value).toBe('9')
    expect((screen.getByLabelText('Count name') as HTMLInputElement).value).toBe('Back shelf')
  })
})

describe('Count tab: counting', () => {
  it('adds a searched product and shows the difference from the system as you type', async () => {
    await startCounting()
    fireEvent.change(screen.getByLabelText('Add a product to count'), { target: { value: 'Coke' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Count Coke' }))

    expect(countInput('Coke').value).toBe('')
    expect(screen.getByText(/System: 12 pieces/)).toBeTruthy()
    fireEvent.change(countInput('Coke'), { target: { value: '9' } })
    expect(screen.getByLabelText('Difference for Coke').textContent).toBe('-3')
    fireEvent.change(countInput('Coke'), { target: { value: '12' } })
    expect(screen.getByLabelText('Difference for Coke').textContent).toBe('Matches')
    fireEvent.change(countInput('Coke'), { target: { value: '15' } })
    expect(screen.getByLabelText('Difference for Coke').textContent).toBe('+3')
    fireEvent.change(countInput('Coke'), { target: { value: '1.5' } })
    expect(screen.getByLabelText('Difference for Coke').textContent).toBe('Not a whole number')
  })

  it('counts one more each time a product is scanned, from a USB scanner or the camera, and keeps the camera open', async () => {
    const lookup = vi.spyOn(inventoryApi, 'lookupBarcode').mockResolvedValue({ found: true, product: coke })
    await startCounting()
    const box = screen.getByLabelText('Add a product to count')
    for (let scans = 1; scans <= 2; scans += 1) {
      fireEvent.change(box, { target: { value: '4800000000017' } })
      fireEvent.keyDown(box, { key: 'Enter' })
      await waitFor(() => expect(lookup).toHaveBeenCalledTimes(scans))
      await waitFor(() => expect(countInput('Coke').value).toBe(String(scans)))
    }
    fireEvent.click(screen.getByRole('button', { name: 'Scan a barcode with the camera' }))
    const camera = screen.getByRole('button', { name: 'Pretend to scan' })
    expect(camera.getAttribute('data-continuous')).toBe('true')
    fireEvent.click(camera)
    await waitFor(() => expect(countInput('Coke').value).toBe('3'))
    expect(screen.getByRole('button', { name: 'Pretend to scan' })).toBeTruthy()
  })

  it('says so for an unknown or archived barcode and does not add a row', async () => {
    vi.spyOn(inventoryApi, 'lookupBarcode')
      .mockResolvedValueOnce({ found: false, barcode: '4809999999990', message: 'Barcode not registered.' })
      .mockResolvedValueOnce({ found: false, barcode: '4801111111116', message: 'archived', archived: { id: 'p-old', name: 'Old Soda' } })
      .mockRejectedValueOnce(new ApiError('Network down.', 0))
    await startCounting()
    const box = screen.getByLabelText('Add a product to count')
    fireEvent.change(box, { target: { value: '4809999999990' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(await screen.findByText(/No product has barcode 4809999999990/)).toBeTruthy()
    fireEvent.change(box, { target: { value: '4801111111116' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(await screen.findByText(/“Old Soda” uses this barcode but was archived/)).toBeTruthy()
    fireEvent.change(box, { target: { value: '4800000000017' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(await screen.findByText('Network down.')).toBeTruthy()
    expect(screen.getByText('Nothing to count yet.')).toBeTruthy()
  })

  it('adds a whole category at once', async () => {
    await startCounting()
    await screen.findByRole('option', { name: 'Snacks' })
    fireEvent.change(screen.getByLabelText('Count a whole category'), { target: { value: 'Snacks' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add its products' }))
    expect(await screen.findByLabelText('Counted quantity for Chips')).toBeTruthy()
    expect(screen.queryByLabelText('Counted quantity for Coke')).toBeNull()
  })

  it('removes a product from the count', async () => {
    await startCounting()
    fireEvent.change(screen.getByLabelText('Add a product to count'), { target: { value: 'Coke' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Count Coke' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove Coke from count' }))
    expect(screen.getByText('Nothing to count yet.')).toBeTruthy()
  })
})

describe('Count tab: saving and reviewing', () => {
  const addCoke = async (counted: string) => {
    fireEvent.change(screen.getByLabelText('Add a product to count'), { target: { value: 'Coke' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Count Coke' }))
    fireEvent.change(countInput('Coke'), { target: { value: counted } })
  }

  it('saves progress without changing stock, then saves to the same count next time', async () => {
    const create = vi.spyOn(inventoryApi, 'createCount').mockResolvedValue({ count: savedCount([countItem()]) })
    const save = vi.spyOn(inventoryApi, 'saveCount').mockResolvedValue({ count: savedCount([countItem({ countedQuantity: 10, difference: -2 })]) })
    const onChanged = await startCounting()
    await addCoke('9')
    fireEvent.click(screen.getByRole('button', { name: 'Save progress' }))

    await waitFor(() => expect(create).toHaveBeenCalledWith([{ productId: 'Coke', countedQuantity: 9 }], undefined))
    expect(await screen.findByText('Saved 1 product. Stock has not changed yet.')).toBeTruthy()
    expect((screen.getByLabelText('Count name') as HTMLInputElement).value).toBe('Count 1')
    expect(onChanged).toHaveBeenCalled()

    fireEvent.change(countInput('Coke'), { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save progress' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith('count-1', [{ productId: 'Coke', countedQuantity: 10 }], 'Count 1'))
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('sends the reason only for products that differ', async () => {
    const create = vi.spyOn(inventoryApi, 'createCount').mockResolvedValue({ count: savedCount([countItem({ reason: 'Damaged' })]) })
    await startCounting()
    await addCoke('9')
    fireEvent.change(screen.getByLabelText('Reason for Coke'), { target: { value: 'Damaged' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save progress' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith([{ productId: 'Coke', countedQuantity: 9, reason: 'Damaged' }], undefined))
    fireEvent.change(countInput('Coke'), { target: { value: '12' } })
    expect(screen.queryByLabelText('Reason for Coke')).toBeNull()
  })

  it('keeps the count on screen and explains when saving fails', async () => {
    vi.spyOn(inventoryApi, 'createCount').mockRejectedValue(new ApiError('Connection lost.', 0))
    await startCounting()
    await addCoke('9')
    fireEvent.click(screen.getByRole('button', { name: 'Save progress' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Connection lost.')
    expect(countInput('Coke').value).toBe('9')
  })

  it('blocks a count with a quantity that is not a whole number, and one with nothing counted', async () => {
    const create = vi.spyOn(inventoryApi, 'createCount')
    await startCounting()
    await addCoke('')
    fireEvent.click(screen.getByRole('button', { name: 'Review differences' }))
    expect((await screen.findByRole('alert')).textContent).toContain('at least one product')
    fireEvent.change(countInput('Coke'), { target: { value: '2.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review differences' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('whole number'))
    expect(create).not.toHaveBeenCalled()
  })

  it('saves first, then shows the differences before anything is applied', async () => {
    const create = vi.spyOn(inventoryApi, 'createCount').mockResolvedValue({ count: savedCount([countItem({ stockNow: 12, movedSinceCount: 0 }), countItem({ productId: 'Chips', name: 'Chips', expectedQuantity: 8, countedQuantity: 8, difference: 0, stockNow: 8, movedSinceCount: 0 })]) })
    const apply = vi.spyOn(inventoryApi, 'applyCount')
    await startCounting()
    await addCoke('9')
    fireEvent.change(screen.getByLabelText('Add a product to count'), { target: { value: 'Chips' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Count Chips' }))
    fireEvent.change(countInput('Chips'), { target: { value: '8' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review differences' }))

    const review = await screen.findByRole('region', { name: 'Review count' })
    expect(create).toHaveBeenCalledWith([{ productId: 'Coke', countedQuantity: 9 }, { productId: 'Chips', countedQuantity: 8 }], undefined)
    expect(within(review).getByText('-3')).toBeTruthy()
    expect(within(review).queryByText('Chips')).toBeNull()
    fireEvent.click(within(review).getByLabelText('Show only differences'))
    expect(within(review).getByText('Chips')).toBeTruthy()
    expect(apply).not.toHaveBeenCalled()
  })

  it('warns that sales or deliveries since the count are kept', async () => {
    vi.spyOn(inventoryApi, 'createCount').mockResolvedValue({ count: savedCount([countItem({ stockNow: 10, movedSinceCount: -2 })]) })
    await startCounting()
    await addCoke('9')
    fireEvent.click(screen.getByRole('button', { name: 'Review differences' }))
    expect(await screen.findByText(/1 product had sales or deliveries since it was counted/)).toBeTruthy()
    expect(screen.getByText('-2 since counted')).toBeTruthy()
  })

  it('blocks applying when a product would go below zero', async () => {
    vi.spyOn(inventoryApi, 'createCount').mockResolvedValue({ count: savedCount([countItem({ expectedQuantity: 12, countedQuantity: 4, difference: -8, stockNow: 5, movedSinceCount: -7 })]) })
    await startCounting()
    await addCoke('4')
    fireEvent.click(screen.getByRole('button', { name: 'Review differences' }))
    expect((await screen.findAllByRole('alert'))[0]!.textContent).toContain('Coke would go below zero')
    expect((screen.getByRole('button', { name: /Apply 1 adjustment/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('asks for confirmation, applies once, and reports the result', async () => {
    vi.spyOn(inventoryApi, 'createCount').mockResolvedValue({ count: savedCount([countItem({ stockNow: 12, movedSinceCount: 0 })]) })
    let finish: () => void = () => undefined
    const apply = vi.spyOn(inventoryApi, 'applyCount').mockImplementation(() => new Promise((resolve) => { finish = () => resolve({ message: 'Count applied: 1 product adjusted.', summary: { adjusted: 1, unchanged: 0, unitsAdded: 0, unitsRemoved: 3 } }) }))
    const onChanged = await startCounting()
    await addCoke('9')
    fireEvent.click(screen.getByRole('button', { name: 'Review differences' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Apply 1 adjustment' }))

    const dialog = await screen.findByRole('alertdialog', { name: 'Apply this count?' })
    expect(within(dialog).getByText(/3 removed and 0 added/)).toBeTruthy()
    expect(apply).not.toHaveBeenCalled()
    const confirm = within(dialog).getByRole('button', { name: 'Apply 1 adjustment' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith('count-1')
    finish()
    expect(await screen.findByText('Count applied')).toBeTruthy()
    expect(screen.getByText('Count applied: 1 product adjusted.')).toBeTruthy()
    expect(onChanged).toHaveBeenCalled()
  })

  it('leaves the count open and shows the reason when the server refuses to apply it', async () => {
    vi.spyOn(inventoryApi, 'createCount').mockResolvedValue({ count: savedCount([countItem({ stockNow: 12, movedSinceCount: 0 })]) })
    vi.spyOn(inventoryApi, 'applyCount').mockRejectedValue(new ApiError('Coke would go below zero. Nothing was changed.', 409))
    await startCounting()
    await addCoke('9')
    fireEvent.click(screen.getByRole('button', { name: 'Review differences' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Apply 1 adjustment' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Apply 1 adjustment' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Nothing was changed')
    expect(screen.queryByText('Count applied')).toBeNull()
    expect(screen.getByRole('region', { name: 'Review count' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back to counting' }))
    expect(countInput('Coke').value).toBe('9')
  })

  it('offers to finish a count with no differences without changing any stock', async () => {
    vi.spyOn(inventoryApi, 'createCount').mockResolvedValue({ count: savedCount([countItem({ countedQuantity: 12, difference: 0, stockNow: 12, movedSinceCount: 0 })]) })
    await startCounting()
    await addCoke('12')
    fireEvent.click(screen.getByRole('button', { name: 'Review differences' }))
    expect(await screen.findByText(/Applying will not change any stock/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Finish count' }))
    expect(within(await screen.findByRole('alertdialog')).getByText('No stock will change. The count will be closed.')).toBeTruthy()
  })
})

describe('Count tab: leaving and discarding', () => {
  const withUnsavedRow = async () => {
    await startCounting()
    fireEvent.change(screen.getByLabelText('Add a product to count'), { target: { value: 'Coke' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Count Coke' }))
    fireEvent.change(countInput('Coke'), { target: { value: '9' } })
  }

  it('asks before throwing away unsaved counting, and can cancel', async () => {
    await withUnsavedRow()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Leave without saving?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(countInput('Coke').value).toBe('9')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Leave without saving' }))
    expect(await screen.findByRole('button', { name: 'Start a new count' })).toBeTruthy()
  })

  it('closes straight away when nothing has been entered', async () => {
    await startCounting()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(await screen.findByRole('button', { name: 'Start a new count' })).toBeTruthy()
  })

  it('discards an unsaved count without calling the server, after confirming', async () => {
    const discard = vi.spyOn(inventoryApi, 'discardCount')
    await withUnsavedRow()
    fireEvent.click(screen.getByRole('button', { name: 'Discard count' }))
    fireEvent.click(within(await screen.findByRole('alertdialog', { name: 'Discard this count?' })).getByRole('button', { name: 'Discard count' }))
    expect(await screen.findByRole('button', { name: 'Start a new count' })).toBeTruthy()
    expect(discard).not.toHaveBeenCalled()
  })

  it('discards a saved count on the server', async () => {
    vi.spyOn(inventoryApi, 'createCount').mockResolvedValue({ count: savedCount([countItem()]) })
    const discard = vi.spyOn(inventoryApi, 'discardCount').mockResolvedValue({ message: 'Count discarded.' })
    await withUnsavedRow()
    fireEvent.click(screen.getByRole('button', { name: 'Save progress' }))
    await screen.findByText(/Saved 1 product/)
    fireEvent.click(screen.getByRole('button', { name: 'Discard count' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard count' }))
    await waitFor(() => expect(discard).toHaveBeenCalledWith('count-1'))
    expect(await screen.findByRole('button', { name: 'Start a new count' })).toBeTruthy()
  })
})
