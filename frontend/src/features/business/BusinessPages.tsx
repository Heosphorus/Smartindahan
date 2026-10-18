import { useEffect, useState } from 'react'
import { businessApi, type Customer, type Alert, type Expense, type Report, type Sale, type Settings, type Supplier } from '../../services/businessApi'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { authApi } from '../../services/authApi'
import { accentOptions, fontOptions, fontSizeOptions, getThemePreferences, saveThemePreferences, type ThemeMode } from '../../services/themePreferences'
import './BusinessPages.css'
import './SettingsPage.css'
import './ThemeSettings.css'

const formatPeso = (value: number) => `₱${value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function DeleteConfirmationModal({ isOpen, onClose, onConfirm, itemName }: { isOpen: boolean; onClose: () => void; onConfirm: () => void; itemName: string }) {
  useEscapeKey(isOpen, onClose)
  if (!isOpen) return null
  return (
    <div className="delete-backdrop">
      <div className="delete-dialog">
        <div className="delete-icon">!</div>
        <h3>Delete {itemName}?</h3>
        <p>Are you sure you want to delete this {itemName.toLowerCase()}? This action cannot be undone.</p>
        <div className="delete-actions">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={onConfirm} className="danger-button">Delete</button>
        </div>
      </div>
    </div>
  )
}

function EntryFormModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEscapeKey(true, onClose)
  const eyebrow = title.toLowerCase().includes('customer') ? 'CUSTOMER DETAILS' : title.toLowerCase().includes('supplier') ? 'SUPPLIER DETAILS' : 'EXPENSE DETAILS'
  return (
    <div className="modal-backdrop">
      <section className="modal-dialog entry-form-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <div><p className="entry-form-eyebrow">{eyebrow}</p><h3>{title}</h3></div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close form">&times;</button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  )
}

export function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    businessApi.alerts()
      .then(data => setAlerts(data.alerts))
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load alerts'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="business-page"><p>Loading alerts...</p></div>

  return (
    <section className="business-page">
      <h2>Alerts</h2>
      <p>View and manage system alerts and notifications.</p>

      {error && <div className="dashboard-error">{error}</div>}

      <div className="alert-list">
        {alerts.length === 0 ? (
          <div className="empty-state">No alerts.</div>
        ) : (
          alerts.map(alert => (
            <div key={alert.id} className={`alert-card alert-${alert.severity}`}>
              <div className="alert-header">
                <span className="alert-severity">{alert.severity.toUpperCase()}</span>
                <span className="alert-date">{new Date(alert.createdAt).toLocaleDateString()}</span>
              </div>
              <h3>{alert.title}</h3>
              <p>{alert.message}</p>
            </div>
          ))
        )}
      </div>
    </section>
  )
}

export function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
  const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; id: string | null }>({ isOpen: false, id: null })
  const [formData, setFormData] = useState({ name: '', mobileNumber: '', address: '', creditLimit: '' })

  useEffect(() => {
    businessApi.customers()
      .then(data => setCustomers(data.customers))
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load customers'))
      .finally(() => setLoading(false))
  }, [])

  const handleAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const result = await businessApi.addCustomer({
        name: formData.name,
        mobileNumber: formData.mobileNumber,
        address: formData.address,
        creditLimit: parseFloat(formData.creditLimit) || 0
      })
      setCustomers([...customers, result.customer])
      setShowAddForm(false)
      setEditingCustomer(null)
      setFormData({ name: '', mobileNumber: '', address: '', creditLimit: '' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add customer')
    }
  }

  const handleEditCustomer = (customer: Customer) => {
    if (editingCustomer?._id === customer._id) {
      setShowAddForm(true)
      return
    }
    setEditingCustomer(customer)
    setShowAddForm(true)
    setFormData({
      name: customer.name,
      mobileNumber: customer.mobileNumber || '',
      address: customer.address || '',
      creditLimit: customer.creditLimit.toString()
    })
  }

  const handleUpdateCustomer = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingCustomer) return
    try {
      const result = await businessApi.updateCustomer(editingCustomer._id, {
        name: formData.name,
        mobileNumber: formData.mobileNumber,
        address: formData.address,
        creditLimit: parseFloat(formData.creditLimit) || 0
      })
      setCustomers(customers.map(c => c._id === editingCustomer._id ? result.customer : c))
      setEditingCustomer(null)
      setShowAddForm(false)
      setFormData({ name: '', mobileNumber: '', address: '', creditLimit: '' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update customer')
    }
  }

  const handleDeleteCustomer = async (id: string) => {
    setDeleteModal({ isOpen: true, id })
  }

  const confirmDelete = async () => {
    if (!deleteModal.id) return
    try {
      await businessApi.deleteCustomer(deleteModal.id)
      setCustomers(customers.filter(c => c._id !== deleteModal.id))
      setDeleteModal({ isOpen: false, id: null })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete customer')
    }
  }

  if (loading) return <div className="business-page"><p>Loading customers...</p></div>

  return (
    <section className="business-page">
      <h2>Customers</h2>
      <p>Manage customer information and utang records.</p>

      {error && <div className="dashboard-error">{error}</div>}

      <button onClick={() => {
        if (editingCustomer) {
          setEditingCustomer(null)
          setFormData({ name: '', mobileNumber: '', address: '', creditLimit: '' })
        }
        setShowAddForm(true)
      }} className="btn-primary" type="button">
        + Add Customer
      </button>

      {showAddForm && (
        <EntryFormModal title={editingCustomer ? 'Edit customer' : 'Add customer'} onClose={() => { setShowAddForm(false); setEditingCustomer(null); setFormData({ name: '', mobileNumber: '', address: '', creditLimit: '' }) }}>
          <form onSubmit={editingCustomer ? handleUpdateCustomer : handleAddCustomer} className="customer-form">
            <label>Name<input placeholder="Name" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} required /></label>
            <label>Contact number<input placeholder="Contact number" value={formData.mobileNumber} onChange={e => setFormData({ ...formData, mobileNumber: e.target.value })} /></label>
            <label>Address<input placeholder="Address" value={formData.address} onChange={e => setFormData({ ...formData, address: e.target.value })} /></label>
            <label>Credit limit<input type="number" min="0" placeholder="Credit limit" value={formData.creditLimit} onChange={e => setFormData({ ...formData, creditLimit: e.target.value })} /></label>
            <div className="form-actions">
              <button type="button" className="btn-secondary" onClick={() => { setShowAddForm(false); setEditingCustomer(null); setFormData({ name: '', mobileNumber: '', address: '', creditLimit: '' }) }}>Cancel</button>
              <button type="submit" className="btn-primary">{editingCustomer ? 'Save customer' : 'Add customer'}</button>
            </div>
          </form>
        </EntryFormModal>
      )}

      <div className="customer-list">
        {customers.length === 0 ? (
          <div className="empty-state">No customers yet.</div>
        ) : (
          customers.map(customer => (
            <div key={customer._id} className="customer-card">
              <div className="customer-info">
                <h3>{customer.name}</h3>
                {customer.mobileNumber && <p>Contact number: {customer.mobileNumber}</p>}
                {customer.address && <p>Address: {customer.address}</p>}
              </div>
              <div className="customer-utang">
                <div className="utang-row">
                  <span>Outstanding:</span>
                  <span className={customer.outstandingBalance > 0 ? 'utang-owed' : 'utang-clear'}>
                    {formatPeso(customer.outstandingBalance)}
                  </span>
                </div>
                <div className="utang-row">
                  <span>Credit Limit:</span>
                  <span>{formatPeso(customer.creditLimit)}</span>
                </div>
                {customer.utangRequestedAt && (
                  <p className="utang-date">Last utang: {new Date(customer.utangRequestedAt).toLocaleDateString()}</p>
                )}
              </div>
              <div className="card-actions">
                <button onClick={() => handleEditCustomer(customer)} className="btn-secondary" type="button">Edit</button>
                <button onClick={() => handleDeleteCustomer(customer._id)} className="btn-danger" type="button">Delete</button>
              </div>
            </div>
          ))
        )}
      </div>

      <DeleteConfirmationModal
        isOpen={deleteModal.isOpen}
        onClose={() => setDeleteModal({ isOpen: false, id: null })}
        onConfirm={confirmDelete}
        itemName="Customer"
      />
    </section>
  )
}

export function ExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null)
  const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; id: string | null }>({ isOpen: false, id: null })
  const [formData, setFormData] = useState({ category: '', description: '', amount: '', expenseDate: '' })

  useEffect(() => {
    businessApi.expenses()
      .then(data => setExpenses(data.expenses))
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load expenses'))
      .finally(() => setLoading(false))
  }, [])

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const result = await businessApi.addExpense({
        category: formData.category,
        description: formData.description,
        amount: parseFloat(formData.amount) || 0,
        expenseDate: formData.expenseDate || new Date().toISOString().split('T')[0]
      })
      setExpenses([...expenses, result.expense])
      setShowAddForm(false)
      setEditingExpense(null)
      setFormData({ category: '', description: '', amount: '', expenseDate: '' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add expense')
    }
  }

  const handleEditExpense = (expense: Expense) => {
    if (editingExpense?._id === expense._id) {
      setShowAddForm(true)
      return
    }
    setEditingExpense(expense)
    setShowAddForm(true)
    setFormData({
      category: expense.category,
      description: expense.description,
      amount: expense.amount.toString(),
      expenseDate: expense.expenseDate
    })
  }

  const handleUpdateExpense = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingExpense) return
    try {
      const result = await businessApi.updateExpense(editingExpense._id, {
        category: formData.category,
        description: formData.description,
        amount: parseFloat(formData.amount) || 0,
        expenseDate: formData.expenseDate
      })
      setExpenses(expenses.map(e => e._id === editingExpense._id ? result.expense : e))
      setEditingExpense(null)
      setShowAddForm(false)
      setFormData({ category: '', description: '', amount: '', expenseDate: '' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update expense')
    }
  }

  const handleDeleteExpense = async (id: string) => {
    setDeleteModal({ isOpen: true, id })
  }

  const confirmDelete = async () => {
    if (!deleteModal.id) return
    try {
      await businessApi.deleteExpense(deleteModal.id)
      setExpenses(expenses.filter(e => e._id !== deleteModal.id))
      setDeleteModal({ isOpen: false, id: null })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete expense')
    }
  }

  if (loading) return <div className="business-page"><p>Loading expenses...</p></div>

  return (
    <section className="business-page">
      <h2>Expenses</h2>
      <p>Track and manage business expenses.</p>

      {error && <div className="dashboard-error">{error}</div>}

      <button onClick={() => {
        if (editingExpense) {
          setEditingExpense(null)
          setFormData({ category: '', description: '', amount: '', expenseDate: '' })
        }
        setShowAddForm(true)
      }} className="btn-primary" type="button">
        + Add Expense
      </button>

      {showAddForm && (
        <EntryFormModal title={editingExpense ? 'Edit expense' : 'Add expense'} onClose={() => { setShowAddForm(false); setEditingExpense(null); setFormData({ category: '', description: '', amount: '', expenseDate: '' }) }}>
          <form onSubmit={editingExpense ? handleUpdateExpense : handleAddExpense} className="customer-form">
            <label>Category<input placeholder="Category" value={formData.category} onChange={e => setFormData({ ...formData, category: e.target.value })} required /></label>
            <label>Description<input placeholder="Description" value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} required /></label>
            <label>Amount<input type="number" min="0.01" step="0.01" placeholder="Amount" value={formData.amount} onChange={e => setFormData({ ...formData, amount: e.target.value })} required /></label>
            <label>Date<input type="date" value={formData.expenseDate} onChange={e => setFormData({ ...formData, expenseDate: e.target.value })} required /></label>
            <div className="form-actions">
              <button type="button" className="btn-secondary" onClick={() => { setShowAddForm(false); setEditingExpense(null); setFormData({ category: '', description: '', amount: '', expenseDate: '' }) }}>Cancel</button>
              <button type="submit" className="btn-primary">{editingExpense ? 'Save expense' : 'Add expense'}</button>
            </div>
          </form>
        </EntryFormModal>
      )}

      <div className="customer-list">
        {expenses.length === 0 ? (
          <div className="empty-state">No expenses recorded.</div>
        ) : (
          expenses.map(expense => (
            <div key={expense._id} className="customer-card">
              <div className="customer-info">
                <h3>{expense.category}</h3>
                <p>{expense.description}</p>
                <p className="utang-date">{new Date(expense.expenseDate).toLocaleDateString()}</p>
              </div>
              <div className="customer-utang">
                <div className="utang-row">
                  <span>Amount:</span>
                  <span>{formatPeso(expense.amount)}</span>
                </div>
              </div>
              <div className="card-actions">
                <button onClick={() => handleEditExpense(expense)} className="btn-secondary" type="button">Edit</button>
                <button onClick={() => handleDeleteExpense(expense._id)} className="btn-danger" type="button">Delete</button>
              </div>
            </div>
          ))
        )}
      </div>

      <DeleteConfirmationModal
        isOpen={deleteModal.isOpen}
        onClose={() => setDeleteModal({ isOpen: false, id: null })}
        onConfirm={confirmDelete}
        itemName="Expense"
      />
    </section>
  )
}

export function ReportsPage() {
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    businessApi.reports()
      .then(data => setReport(data))
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load reports'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="business-page"><p>Loading reports...</p></div>

  return (
    <section className="business-page">
      <h2>Reports</h2>
      <p>View business reports and analytics.</p>

      {error && <div className="dashboard-error">{error}</div>}

      {report && (
        <>
          <div className="report-cards">
            <div>
              <span>Total Sales</span>
              <strong>{formatPeso(report.summary.sales)}</strong>
            </div>
            <div>
              <span>Total Profit</span>
              <strong>{formatPeso(report.summary.profit)}</strong>
            </div>
            <div>
              <span>Transactions</span>
              <strong>{report.summary.transactions}</strong>
            </div>
          </div>

          <h3>Daily Sales</h3>
          <div className="customer-list">
            {report.daily.map(daily => (
              <div key={daily._id} className="customer-card">
                <div className="customer-info">
                  <h3>{new Date(daily._id).toLocaleDateString()}</h3>
                </div>
                <div className="customer-utang">
                  <div className="utang-row">
                    <span>Sales:</span>
                    <span>{formatPeso(daily.sales)}</span>
                  </div>
                  <div className="utang-row">
                    <span>Profit:</span>
                    <span>{formatPeso(daily.profit)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <h3>Payment Methods</h3>
          <div className="customer-list">
            {report.paymentMethods.map(pm => (
              <div key={pm._id} className="customer-card">
                <div className="customer-info">
                  <h3>{pm._id}</h3>
                </div>
                <div className="customer-utang">
                  <div className="utang-row">
                    <span>Total:</span>
                    <span>{formatPeso(pm.total)}</span>
                  </div>
                  <div className="utang-row">
                    <span>Count:</span>
                    <span>{pm.count}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

export function SalesPage() {
  const [sales, setSales] = useState<Sale[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    businessApi.sales()
      .then(data => setSales(data.sales))
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load sales'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="business-page"><p>Loading sales...</p></div>

  return (
    <section className="business-page">
      <h2>Sales</h2>
      <p>View and manage sales records.</p>

      {error && <div className="dashboard-error">{error}</div>}

      <div className="customer-list">
        {sales.length === 0 ? (
          <div className="empty-state">No sales recorded.</div>
        ) : (
          sales.map(sale => (
            <div key={sale.transactionCode} className="customer-card">
              <div className="customer-info">
                <h3>#{sale.transactionCode}</h3>
                <p>{new Date(sale.createdAt).toLocaleString()}</p>
                <p className="utang-date">{sale.paymentMethod}</p>
                <div className="sale-items">
                  {sale.items.map((item, idx) => (
                    <small key={idx}>{item.productName} x{item.quantity}</small>
                  ))}
                </div>
              </div>
              <div className="customer-utang">
                <div className="utang-row">
                  <span>Total:</span>
                  <span>{formatPeso(sale.total)}</span>
                </div>
                <div className="utang-row">
                  <span>Profit:</span>
                  <span>{formatPeso(sale.estimatedProfit)}</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  )
}

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showPasswordForm, setShowPasswordForm] = useState(false)
  const [formData, setFormData] = useState({ firstName: '', lastName: '', email: '', mobileNumber: '', storeName: '', storeAddress: '' })
  const [passwordData, setPasswordData] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [themePreferences, setThemePreferences] = useState(getThemePreferences)

  const updateThemePreference = (changes: Partial<typeof themePreferences>) => {
    const next = { ...themePreferences, ...changes }
    setThemePreferences(next)
    saveThemePreferences(next)
  }

  useEffect(() => {
    businessApi.settings()
      .then(data => {
        setSettings(data.settings)
        setFormData(data.settings)
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load settings'))
      .finally(() => setLoading(false))
  }, [])

  const handleUpdateSettings = async (e: React.FormEvent, fields: Partial<Settings>) => {
    e.preventDefault()
    try {
      const result = await businessApi.updateSettings(fields)
      setSettings(result.settings)
      setFormData(current => ({
        ...result.settings,
        ...(fields.firstName === undefined ? { firstName: current.firstName } : {}),
        ...(fields.lastName === undefined ? { lastName: current.lastName } : {}),
        ...(fields.mobileNumber === undefined ? { mobileNumber: current.mobileNumber } : {}),
        ...(fields.storeName === undefined ? { storeName: current.storeName } : {}),
        ...(fields.storeAddress === undefined ? { storeAddress: current.storeAddress } : {}),
      }))
      if (fields.storeName !== undefined) {
        window.dispatchEvent(new CustomEvent('smarTindahan:store-profile-updated', { detail: { storeName: result.settings.storeName } }))
      }
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update settings')
    }
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    const token = localStorage.getItem('sarismart_token')
    if (!token) {
      setError('You must be logged in to change your password')
      return
    }
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setError('New password and confirm password do not match')
      return
    }
    try {
      await authApi.changePassword(token, passwordData.currentPassword, passwordData.newPassword, passwordData.confirmPassword)
      setShowPasswordForm(false)
      setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' })
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change password')
    }
  }

  if (loading) return <div className="business-page"><p>Loading settings...</p></div>

  return (
    <section className="business-page settings-page">
      <div className="settings-heading">
        <div>
          <p className="business-eyebrow">ACCOUNT & STORE</p>
          <h2>Settings</h2>
          <p>Manage your contact details and store profile.</p>
        </div>
        {settings && (
          <div className="settings-heading-actions">
            <button onClick={() => setShowPasswordForm(!showPasswordForm)} className="btn-secondary" type="button">
              {showPasswordForm ? 'Hide password form' : 'Change password'}
            </button>
          </div>
        )}
      </div>

      {error && <div className="dashboard-error">{error}</div>}

      <section className="settings-section appearance-section" aria-labelledby="appearance-heading">
        <div className="settings-section-heading">
          <div>
            <h3 id="appearance-heading">Appearance</h3>
            <p>Choose the color and display mode used across smarTindahan.</p>
          </div>
        </div>
        <div className="appearance-controls">
          <fieldset className="appearance-mode">
            <legend>Display mode</legend>
            <div className="mode-switch" role="group" aria-label="Display mode">
              {(['light', 'dark'] as ThemeMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={themePreferences.mode === mode ? 'mode-option selected' : 'mode-option'}
                  aria-pressed={themePreferences.mode === mode}
                  onClick={() => updateThemePreference({ mode })}
                >
                  <span className={`mode-preview ${mode}`} aria-hidden="true">{mode === 'light' ? 'Aa' : 'Aа'}</span>
                  <span>{mode === 'light' ? 'Light' : 'Dark'}</span>
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="appearance-accent">
            <legend>Accent color</legend>
            <div className="accent-options" role="group" aria-label="Accent color">
              {accentOptions.map((accent) => (
                <button
                  key={accent.id}
                  type="button"
                  className={themePreferences.accent === accent.id ? 'accent-option selected' : 'accent-option'}
                  style={{ '--swatch-color': accent.color } as React.CSSProperties}
                  aria-label={`${accent.name} accent color`}
                  aria-pressed={themePreferences.accent === accent.id}
                  title={accent.name}
                  onClick={() => updateThemePreference({ accent: accent.id })}
                >
                  <span aria-hidden="true" />
                </button>
              ))}
            </div>
          </fieldset>
          <label className="appearance-select">
            <span>Font family</span>
            <select value={themePreferences.fontFamily} onChange={(event) => updateThemePreference({ fontFamily: event.target.value as typeof themePreferences.fontFamily })}>
              {fontOptions.map((font) => <option key={font.id} value={font.id}>{font.name}</option>)}
            </select>
          </label>
          <label className="appearance-select">
            <span>Text size</span>
            <select value={themePreferences.fontSize} onChange={(event) => updateThemePreference({ fontSize: event.target.value as typeof themePreferences.fontSize })}>
              {fontSizeOptions.map((size) => <option key={size.id} value={size.id}>{size.name}</option>)}
            </select>
          </label>
        </div>
      </section>

      {settings && (
        <>
            <div className="settings-editor settings-always-editable">
              <section className="settings-section">
                <div className="settings-section-heading"><div><h3>Owner profile</h3><p>Update the details associated with your account.</p></div></div>
                <form onSubmit={(event) => handleUpdateSettings(event, { firstName: formData.firstName, lastName: formData.lastName, mobileNumber: formData.mobileNumber })}>
                  <div className="settings-fields">
                    <label>First name<input placeholder="First name" value={formData.firstName} onChange={e => setFormData({ ...formData, firstName: e.target.value })} required /></label>
                    <label>Last name<input placeholder="Last name" value={formData.lastName} onChange={e => setFormData({ ...formData, lastName: e.target.value })} required /></label>
                    <label>Account email<input type="email" value={settings.email} readOnly aria-describedby="account-email-note" /><small id="account-email-note">Email changes are managed separately to protect account access.</small></label>
                    <label>Contact number<input placeholder="Contact number" value={formData.mobileNumber} onChange={e => setFormData({ ...formData, mobileNumber: e.target.value })} required /></label>
                  </div>
                  <div className="form-actions"><button type="submit" className="btn-primary">Save owner profile</button></div>
                </form>
              </section>
              <section className="settings-section">
                <div className="settings-section-heading"><div><h3>Store profile</h3><p>Update how your business is identified.</p></div></div>
                <form onSubmit={(event) => handleUpdateSettings(event, { storeName: formData.storeName, storeAddress: formData.storeAddress })}>
                  <div className="settings-fields">
                    <label>Store name<input placeholder="Store name" value={formData.storeName} onChange={e => setFormData({ ...formData, storeName: e.target.value })} required /></label>
                    <label>Store address<input placeholder="Store address" value={formData.storeAddress} onChange={e => setFormData({ ...formData, storeAddress: e.target.value })} required /></label>
                  </div>
                  <div className="form-actions"><button type="submit" className="btn-primary">Save store profile</button></div>
                </form>
              </section>
            </div>

          {showPasswordForm && (
            <form onSubmit={handleChangePassword} className="settings-editor password-editor">
              <section className="settings-section">
                <div className="settings-section-heading"><div><h3>Change password</h3><p>Choose a new password to secure your account.</p></div></div>
                <div className="settings-fields password-fields">
                  <label>Current password<input type="password" placeholder="Current password" value={passwordData.currentPassword} onChange={e => setPasswordData({ ...passwordData, currentPassword: e.target.value })} required /></label>
                  <label>New password<input type="password" placeholder="New password" value={passwordData.newPassword} onChange={e => setPasswordData({ ...passwordData, newPassword: e.target.value })} required /></label>
                  <label>Confirm new password<input type="password" placeholder="Confirm new password" value={passwordData.confirmPassword} onChange={e => setPasswordData({ ...passwordData, confirmPassword: e.target.value })} required /></label>
                </div>
              </section>
              <div className="form-actions">
                <button type="submit" className="btn-primary">Change Password</button>
                <button type="button" onClick={() => { setShowPasswordForm(false); setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' }) }} className="btn-secondary">Cancel</button>
              </div>
            </form>
          )}
        </>
      )}
    </section>
  )
}

export function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null)
  const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; id: string | null }>({ isOpen: false, id: null })
  const [formData, setFormData] = useState({ name: '', contactNumber: '', address: '' })

  useEffect(() => {
    businessApi.suppliers()
      .then(data => setSuppliers(data.suppliers))
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load suppliers'))
      .finally(() => setLoading(false))
  }, [])

  const handleAddSupplier = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const result = await businessApi.addSupplier({
        name: formData.name,
        contactNumber: formData.contactNumber,
        address: formData.address
      })
      setSuppliers([...suppliers, result.supplier])
      setShowAddForm(false)
      setFormData({ name: '', contactNumber: '', address: '' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add supplier')
    }
  }

  const handleEditSupplier = (supplier: Supplier) => {
    setEditingSupplier(supplier)
    setShowAddForm(true)
    setFormData({
      name: supplier.name,
      contactNumber: supplier.contactNumber || '',
      address: supplier.address || ''
    })
  }

  const handleUpdateSupplier = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingSupplier) return
    try {
      const result = await businessApi.updateSupplier(editingSupplier._id, {
        name: formData.name,
        contactNumber: formData.contactNumber,
        address: formData.address
      })
      setSuppliers(suppliers.map(s => s._id === editingSupplier._id ? result.supplier : s))
      setEditingSupplier(null)
      setShowAddForm(false)
      setFormData({ name: '', contactNumber: '', address: '' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update supplier')
    }
  }

  const handleDeleteSupplier = async (id: string) => {
    setDeleteModal({ isOpen: true, id })
  }

  const confirmDelete = async () => {
    if (!deleteModal.id) return
    try {
      await businessApi.deleteSupplier(deleteModal.id)
      setSuppliers(suppliers.filter(s => s._id !== deleteModal.id))
      setDeleteModal({ isOpen: false, id: null })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete supplier')
    }
  }

  if (loading) return <div className="business-page"><p>Loading suppliers...</p></div>

  return (
    <section className="business-page">
      <h2>Suppliers</h2>
      <p>Manage supplier information and orders.</p>

      {error && <div className="dashboard-error">{error}</div>}

      <button onClick={() => {
        if (editingSupplier) {
          setEditingSupplier(null)
          setFormData({ name: '', contactNumber: '', address: '' })
        }
        setShowAddForm(true)
      }} className="btn-primary" type="button">
        + Add Supplier
      </button>

      {showAddForm && (
        <EntryFormModal title={editingSupplier ? 'Edit supplier' : 'Add supplier'} onClose={() => { setShowAddForm(false); setEditingSupplier(null); setFormData({ name: '', contactNumber: '', address: '' }) }}>
          <form onSubmit={editingSupplier ? handleUpdateSupplier : handleAddSupplier} className="customer-form">
            <label>Name<input placeholder="Name" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} required /></label>
            <label>Contact number<input placeholder="Contact number" value={formData.contactNumber} onChange={e => setFormData({ ...formData, contactNumber: e.target.value })} /></label>
            <label>Address<input placeholder="Address" value={formData.address} onChange={e => setFormData({ ...formData, address: e.target.value })} /></label>
            <div className="form-actions">
              <button type="button" className="btn-secondary" onClick={() => { setShowAddForm(false); setEditingSupplier(null); setFormData({ name: '', contactNumber: '', address: '' }) }}>Cancel</button>
              <button type="submit" className="btn-primary">{editingSupplier ? 'Save supplier' : 'Add supplier'}</button>
            </div>
          </form>
        </EntryFormModal>
      )}

      <div className="customer-list">
        {suppliers.length === 0 ? (
          <div className="empty-state">No suppliers yet.</div>
        ) : (
          suppliers.map(supplier => (
            <div key={supplier._id} className="customer-card">
              <div className="customer-info">
                <h3>{supplier.name}</h3>
                {supplier.contactNumber && <p>Contact number: {supplier.contactNumber}</p>}
                {supplier.address && <p>Address: {supplier.address}</p>}
              </div>
              <div className="card-actions">
                <button onClick={() => handleEditSupplier(supplier)} className="btn-secondary" type="button">Edit</button>
                <button onClick={() => handleDeleteSupplier(supplier._id)} className="btn-danger" type="button">Delete</button>
              </div>
            </div>
          ))
        )}
      </div>

      <DeleteConfirmationModal
        isOpen={deleteModal.isOpen}
        onClose={() => setDeleteModal({ isOpen: false, id: null })}
        onConfirm={confirmDelete}
        itemName="Supplier"
      />
    </section>
  )
}
