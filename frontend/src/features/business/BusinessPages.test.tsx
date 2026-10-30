import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { businessApi, type Report, type Supplier } from '../../services/businessApi'
import { ReportsPage, SuppliersPage } from './BusinessPages'

const supplier = (id: string, name: string): Supplier => ({ _id: id, name })

async function openAddDialog() {
  render(<SuppliersPage />)
  fireEvent.click(await screen.findByRole('button', { name: '+ Add Supplier' }))
  fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Mang Tonyo Trading' } })
}

describe('create and edit dialogs', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('shows a failed save inside the dialog and keeps what was typed', async () => {
    vi.spyOn(businessApi, 'suppliers').mockResolvedValue({ suppliers: [], pagination: { page: 1, limit: 100, total: 0 } })
    vi.spyOn(businessApi, 'addSupplier').mockRejectedValue(new Error('A supplier with that name already exists.'))
    await openAddDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Add supplier' }))

    const dialog = screen.getByRole('dialog')
    expect((await screen.findByText('A supplier with that name already exists.')).closest('[role="dialog"]')).toBe(dialog)
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Mang Tonyo Trading')
    expect((screen.getByRole('button', { name: 'Add supplier' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('submits once while saving, then closes the dialog and confirms', async () => {
    vi.spyOn(businessApi, 'suppliers').mockResolvedValue({ suppliers: [], pagination: { page: 1, limit: 100, total: 0 } })
    let finish: (value: { supplier: Supplier }) => void = () => undefined
    const add = vi.spyOn(businessApi, 'addSupplier').mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    await openAddDialog()

    const form = screen.getByRole('dialog').querySelector('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    const saving = await screen.findByRole('button', { name: 'Saving…' }) as HTMLButtonElement
    expect(saving.disabled).toBe(true)
    expect(add).toHaveBeenCalledTimes(1)

    finish({ supplier: supplier('s1', 'Mang Tonyo Trading') })
    expect((await screen.findByRole('status')).textContent).toBe('Supplier added.')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByText('Mang Tonyo Trading')).toBeTruthy()
  })
})

describe('reports', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  const report = (overrides: Partial<Report> = {}): Report => ({ summary: { sales: 0, profit: 0, transactions: 0 }, daily: [], paymentMethods: [], ...overrides })

  it('explains empty sections instead of showing bare headings', async () => {
    vi.spyOn(businessApi, 'reports').mockResolvedValue(report())
    render(<ReportsPage />)

    expect(await screen.findByText(/No sales in this period yet/)).toBeTruthy()
    expect(screen.getByText('No payments recorded yet.')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('lists daily sales and payment methods as tables', async () => {
    vi.spyOn(businessApi, 'reports').mockResolvedValue(report({
      summary: { sales: 300, profit: 90, transactions: 3 },
      daily: [{ _id: '2026-06-29', sales: 300, profit: 90 }],
      paymentMethods: [{ _id: 'Cash', total: 300, count: 3 }],
    }))
    render(<ReportsPage />)

    const tables = await screen.findAllByRole('table')
    expect(tables).toHaveLength(2)
    expect(tables[1]!.textContent).toContain('Cash')
    expect(tables[1]!.textContent).toContain('₱300.00')
  })
})
