import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { storeApi, type ProductRecord } from '../../services/storeApi'
import { PriceListPage } from './PriceListPage'

const product = (name: string, category: string): ProductRecord => ({ _id: name, name, category, sellingPrice: 10, costPrice: 5, currentStock: 5, minStock: 1, unit: 'piece' })
// The page also has a Category filter and Selling price column, so look inside the open form only.
const form = () => within(document.querySelector('form.price-modal') as HTMLElement)
// The page's own Add product button comes first in the DOM; the form's submit button is rendered after it.
const submit = () => { const buttons = screen.getAllByRole('button', { name: 'Add product' }); fireEvent.click(buttons[buttons.length - 1]!) }

async function openAddProduct() {
  vi.spyOn(storeApi, 'products').mockResolvedValue({
    products: [product('Coke', 'Beverages'), product('Sardines', 'Canned goods'), product('Pepsi', 'Beverages')],
    pagination: { page: 1, limit: 100, total: 3 },
  })
  const add = vi.spyOn(storeApi, 'addProduct').mockResolvedValue({ product: product('New', 'x') })
  render(<PriceListPage />)
  fireEvent.click(await screen.findByRole('button', { name: 'Add product' }))
  return add
}

const fillRest = (name = 'Chips') => {
  fireEvent.change(form().getByLabelText(/Product name/), { target: { value: name } })
  fireEvent.change(form().getByLabelText(/Cost per unit/), { target: { value: '5' } })
  fireEvent.change(form().getByLabelText(/Selling price/), { target: { value: '8' } })
}

describe('category on the Add product form', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('is a dropdown of the categories the store already uses, each listed once', async () => {
    await openAddProduct()
    const select = form().getByLabelText(/^Category/) as HTMLSelectElement
    expect(select.tagName).toBe('SELECT')
    expect([...select.options].map((option) => option.text)).toEqual(['Select a category', 'Beverages', 'Canned goods', 'Add a new category'])
    expect(form().queryByLabelText(/New category/)).toBeNull()
  })

  it('saves an existing category chosen from the list', async () => {
    const add = await openAddProduct()
    fillRest()
    fireEvent.change(form().getByLabelText(/^Category/), { target: { value: 'Canned goods' } })
    submit()
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1))
    expect(add.mock.calls[0]![0]).toMatchObject({ name: 'Chips', category: 'Canned goods' })
  })

  it('lets the user type a category that does not exist yet', async () => {
    const add = await openAddProduct()
    fillRest()
    fireEvent.change(form().getByLabelText(/^Category/), { target: { value: '__new__' } })
    fireEvent.change(form().getByLabelText(/New category/), { target: { value: 'Snacks' } })
    submit()
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1))
    expect(add.mock.calls[0]![0]).toMatchObject({ category: 'Snacks' })
  })

  it('reuses the existing spelling when a new category only differs by capitals or spacing', async () => {
    const add = await openAddProduct()
    fillRest()
    fireEvent.change(form().getByLabelText(/^Category/), { target: { value: '__new__' } })
    fireEvent.change(form().getByLabelText(/New category/), { target: { value: '  canned   GOODS ' } })
    submit()
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1))
    expect(add.mock.calls[0]![0]).toMatchObject({ category: 'Canned goods' })
  })

  it('asks for a category when none is chosen or the new one is left blank', async () => {
    const add = await openAddProduct()
    fillRest()
    submit()
    expect(form().getByRole('alert').textContent).toContain('choose or add a category')

    fireEvent.change(form().getByLabelText(/^Category/), { target: { value: '__new__' } })
    submit()
    expect(form().getByRole('alert').textContent).toContain('choose or add a category')
    expect(add).not.toHaveBeenCalled()
  })

  it('also shows the dropdown when editing, with the current category selected', async () => {
    await openAddProduct()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click((await screen.findAllByRole('button', { name: 'Edit' }))[0]!)
    const select = await waitFor(() => form().getByLabelText(/^Category/)) as HTMLSelectElement
    expect(select.tagName).toBe('SELECT')
    expect(select.value).toBe('Beverages')
    expect(form().queryByLabelText(/New category/)).toBeNull()
  })
})
