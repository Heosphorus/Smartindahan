import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { storeApi, type ProductRecord } from '../../services/storeApi'
import { PriceListPage } from './PriceListPage'

const product = (name: string, category: string): ProductRecord => ({ _id: name, name, category, sellingPrice: 10, costPrice: 5, currentStock: 5, minStock: 1, unit: 'piece' })
const dialog = () => within(screen.getByRole('dialog'))

/** A tiny in-memory store, so a rename or delete is visible when the page reloads its products. */
async function openManager() {
  let products = [product('Coke', 'Beverages'), product('Pepsi', 'Beverages'), product('Sardines', 'Canned goods')]
  vi.spyOn(storeApi, 'products').mockImplementation(async () => ({ products, pagination: { page: 1, limit: 100, total: products.length } }))
  const rename = vi.spyOn(storeApi, 'renameCategory').mockImplementation(async (name, newName) => {
    products = products.map((item) => item.category === name ? { ...item, category: newName } : item)
    return { message: `"${name}" was renamed to "${newName}".`, category: newName, moved: 2 }
  })
  const remove = vi.spyOn(storeApi, 'deleteCategory').mockImplementation(async (name, moveTo = 'Uncategorized') => {
    products = products.map((item) => item.category === name ? { ...item, category: moveTo } : item)
    return { message: `"${name}" was deleted.`, category: moveTo, moved: 1 }
  })
  render(<PriceListPage />)
  fireEvent.click(await screen.findByRole('button', { name: 'Manage categories' }))
  return { rename, remove }
}

describe('manage categories', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('lists each category with how many products use it', async () => {
    await openManager()
    expect(dialog().getByText('Beverages')).toBeTruthy()
    expect(dialog().getByText('2 products')).toBeTruthy()
    expect(dialog().getByText('Canned goods')).toBeTruthy()
    expect(dialog().getByText('1 product')).toBeTruthy()
  })

  it('renames a category, shows the result and reloads the products', async () => {
    const { rename } = await openManager()
    fireEvent.click(dialog().getByRole('button', { name: 'Rename Beverages' }))
    const input = dialog().getByLabelText('New name for Beverages') as HTMLInputElement
    expect(input.value).toBe('Beverages')
    fireEvent.change(input, { target: { value: 'Drinks' } })
    fireEvent.click(dialog().getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(rename).toHaveBeenCalledWith('Beverages', 'Drinks'))
    expect((await dialog().findByRole('status')).textContent).toContain('renamed to "Drinks"')
    expect(await dialog().findByRole('button', { name: 'Rename Drinks' })).toBeTruthy()
    expect(dialog().queryByRole('button', { name: 'Rename Beverages' })).toBeNull()
  })

  it('does not call the server for a blank or unchanged name', async () => {
    const { rename } = await openManager()
    fireEvent.click(dialog().getByRole('button', { name: 'Rename Beverages' }))
    fireEvent.click(dialog().getByRole('button', { name: 'Save' }))
    expect(dialog().getByRole('alert').textContent).toContain('different name')
    fireEvent.change(dialog().getByLabelText('New name for Beverages'), { target: { value: '   ' } })
    fireEvent.click(dialog().getByRole('button', { name: 'Save' }))
    expect(dialog().getByRole('alert').textContent).toContain('Enter a category name')
    expect(rename).not.toHaveBeenCalled()
  })

  it('deleting asks where the products go, defaulting to Uncategorized, and never offers the category itself', async () => {
    const { remove } = await openManager()
    fireEvent.click(dialog().getByRole('button', { name: 'Delete Canned goods' }))
    expect(dialog().getByText(/1 product will stay in your price list/)).toBeTruthy()
    const select = dialog().getByLabelText('Move Canned goods products to') as HTMLSelectElement
    expect([...select.options].map((option) => option.value)).toEqual(['Beverages', 'Uncategorized'])
    expect(select.value).toBe('Uncategorized')
    expect(remove).not.toHaveBeenCalled()

    fireEvent.click(dialog().getByRole('button', { name: 'Delete category' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith('Canned goods', 'Uncategorized'))
    expect(await dialog().findByRole('button', { name: 'Rename Uncategorized' })).toBeTruthy()
    expect(dialog().queryByRole('button', { name: 'Rename Canned goods' })).toBeNull()
  })

  it('can move the products of a deleted category into another one, and cancel without changes', async () => {
    const { remove } = await openManager()
    fireEvent.click(dialog().getByRole('button', { name: 'Delete Canned goods' }))
    fireEvent.click(dialog().getByRole('button', { name: 'Cancel' }))
    expect(dialog().getByRole('button', { name: 'Delete Canned goods' })).toBeTruthy()
    expect(remove).not.toHaveBeenCalled()

    fireEvent.click(dialog().getByRole('button', { name: 'Delete Canned goods' }))
    fireEvent.change(dialog().getByLabelText('Move Canned goods products to'), { target: { value: 'Beverages' } })
    fireEvent.click(dialog().getByRole('button', { name: 'Delete category' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith('Canned goods', 'Beverages'))
  })

  it('keeps the dialog open and shows the error when the server refuses', async () => {
    await openManager()
    vi.spyOn(storeApi, 'renameCategory').mockRejectedValue(new Error('Category not found.'))
    fireEvent.click(dialog().getByRole('button', { name: 'Rename Beverages' }))
    fireEvent.change(dialog().getByLabelText('New name for Beverages'), { target: { value: 'Drinks' } })
    fireEvent.click(dialog().getByRole('button', { name: 'Save' }))
    expect((await dialog().findByRole('alert')).textContent).toBe('Category not found.')
    expect(dialog().getByLabelText('New name for Beverages')).toBeTruthy()
  })

  it('moves the category filter along with a renamed category', async () => {
    await openManager()
    const filter = () => screen.getAllByLabelText('Category').find((element) => element.tagName === 'SELECT' && !element.closest('[role=dialog]')) as HTMLSelectElement
    fireEvent.change(filter(), { target: { value: 'Beverages' } })
    fireEvent.click(dialog().getByRole('button', { name: 'Rename Beverages' }))
    fireEvent.change(dialog().getByLabelText('New name for Beverages'), { target: { value: 'Drinks' } })
    fireEvent.click(dialog().getByRole('button', { name: 'Save' }))
    await dialog().findByRole('button', { name: 'Rename Drinks' })
    expect(filter().value).toBe('Drinks')
  })
})
