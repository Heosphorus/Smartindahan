import { useEffect, useState } from 'react'
import { businessApi, type Customer, type Alert, type Expense, type Report, type Sale, type Settings, type Supplier } from '../../services/businessApi'
import { authApi } from '../../services/authApi'
import './BusinessPages.css'

const formatPeso = (value: number) => `₱${value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function DeleteConfirmationModal({ isOpen, onClose, onConfirm, itemName }: { isOpen: boolean; onClose: () => void; onConfirm: () => void; itemName: string }) {
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

function FormModal({ isOpen, onClose, title, children }: { isOpen: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!isOpen) return null
  return (
    <div className="modal-backdrop">
      <div className="modal-dialog">
        <div className="modal-header">
          <h3>{title}</h3>
          <button onClick={onClose} className="modal-close">×</button>
        </div>
        <div className="modal-body">
          {children}
        </div>
      </div>
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
      setFormData({ name: '', mobileNumber: '', address: '', creditLimit: '' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add customer')
    }
  }

  const handleEditCustomer = (customer: Customer) => {
    setEditingCustomer(customer)
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

      <button onClick={() => { setShowAddForm(!showAddForm); setEditingCustomer(null); setFormData({ name: '', mobileNumber: '', address: '', creditLimit: '' }) }} className="btn-primary" type="button">
        {showAddForm || editingCustomer ? 'Cancel' : '+ Add Customer'}
      </button>

      {(showAddForm || editingCustomer) && (
        <form onSubmit={editingCustomer ? handleUpdateCustomer : handleAddCustomer} className="customer-form">
          <input
            placeholder="Name"
            value={formData.name}
            onChange={e => setFormData({ ...formData, name: e.target.value })}
            required
          />
          <input
            placeholder="Mobile Number"
            value={formData.mobileNumber}
            onChange={e => setFormData({ ...formData, mobileNumber: e.target.value })}
          />
          <input
            placeholder="Address"
            value={formData.address}
            onChange={e => setFormData({ ...formData, address: e.target.value })}
          />
          <input
            type="number"
            placeholder="Credit Limit"
            value={formData.creditLimit}
            onChange={e => setFormData({ ...formData, creditLimit: e.target.value })}
          />
          <button type="submit" className="btn-primary">{editingCustomer ? 'Update Customer' : 'Add Customer'}</button>
        </form>
      )}

      <div className="customer-list">
        {customers.length === 0 ? (
          <div className="empty-state">No customers yet.</div>
        ) : (
          customers.map(customer => (
            <div key={customer._id} className="customer-card">
              <div className="customer-info">
                <h3>{customer.name}</h3>
                {customer.mobileNumber && <p>📱 {customer.mobileNumber}</p>}
                {customer.address && <p>📍 {customer.address}</p>}
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
      setFormData({ category: '', description: '', amount: '', expenseDate: '' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add expense')
    }
  }

  const handleEditExpense = (expense: Expense) => {
    setEditingExpense(expense)
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

      <button onClick={() => { setShowAddForm(!showAddForm); setEditingExpense(null); setFormData({ category: '', description: '', amount: '', expenseDate: '' }) }} className="btn-primary" type="button">
        {showAddForm || editingExpense ? 'Cancel' : '+ Add Expense'}
      </button>

      {(showAddForm || editingExpense) && (
        <form onSubmit={editingExpense ? handleUpdateExpense : handleAddExpense} className="customer-form">
          <input
            placeholder="Category"
            value={formData.category}
            onChange={e => setFormData({ ...formData, category: e.target.value })}
            required
          />
          <input
            placeholder="Description"
            value={formData.description}
            onChange={e => setFormData({ ...formData, description: e.target.value })}
            required
          />
          <input
            type="number"
            placeholder="Amount"
            value={formData.amount}
            onChange={e => setFormData({ ...formData, amount: e.target.value })}
            required
          />
          <input
            type="date"
            placeholder="Date"
            value={formData.expenseDate}
            onChange={e => setFormData({ ...formData, expenseDate: e.target.value })}
            required
          />
          <button type="submit" className="btn-primary">{editingExpense ? 'Update Expense' : 'Add Expense'}</button>
        </form>
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
  const [editing, setEditing] = useState(false)
  const [showPasswordForm, setShowPasswordForm] = useState(false)
  const [formData, setFormData] = useState({ firstName: '', lastName: '', email: '', mobileNumber: '', storeName: '', storeAddress: '' })
  const [passwordData, setPasswordData] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })

  useEffect(() => {
    businessApi.settings()
      .then(data => {
        setSettings(data.settings)
        setFormData(data.settings)
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load settings'))
      .finally(() => setLoading(false))
  }, [])

  const handleUpdateSettings = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const result = await businessApi.updateSettings(formData)
      setSettings(result.settings)
      setEditing(false)
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
    <section className="business-page">
      <h2>Settings</h2>
      <p>Configure store settings and preferences.</p>

      {error && <div className="dashboard-error">{error}</div>}

      {settings && (
        <>
          {!editing ? (
            <div className="settings-display">
              <button onClick={() => setEditing(true)} className="btn-primary" type="button">Edit Settings</button>
              <button onClick={() => setShowPasswordForm(!showPasswordForm)} className="btn-secondary" type="button">
                {showPasswordForm ? 'Cancel Password Change' : 'Change Password'}
              </button>
              <div className="customer-list">
                <div className="customer-card">
                  <div className="customer-info">
                    <h3>Owner</h3>
                    <p>{settings.firstName} {settings.lastName}</p>
                    <p>📱 {settings.mobileNumber}</p>
                    <p>✉️ {settings.email}</p>
                  </div>
                </div>
                <div className="customer-card">
                  <div className="customer-info">
                    <h3>Store</h3>
                    <p>{settings.storeName}</p>
                    <p>📍 {settings.storeAddress}</p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <form onSubmit={handleUpdateSettings} className="customer-form settings-form">
              <div>
                <label>First Name</label>
                <input
                  placeholder="First Name"
                  value={formData.firstName}
                  onChange={e => setFormData({ ...formData, firstName: e.target.value })}
                  required
                />
              </div>
              <div>
                <label>Last Name</label>
                <input
                  placeholder="Last Name"
                  value={formData.lastName}
                  onChange={e => setFormData({ ...formData, lastName: e.target.value })}
                  required
                />
              </div>
              <div>
                <label>Email</label>
                <input
                  placeholder="Email"
                  type="email"
                  value={formData.email}
                  onChange={e => setFormData({ ...formData, email: e.target.value })}
                  required
                />
              </div>
              <div>
                <label>Mobile Number</label>
                <input
                  placeholder="Mobile Number"
                  value={formData.mobileNumber}
                  onChange={e => setFormData({ ...formData, mobileNumber: e.target.value })}
                  required
                />
              </div>
              <div>
                <label>Store Name</label>
                <input
                  placeholder="Store Name"
                  value={formData.storeName}
                  onChange={e => setFormData({ ...formData, storeName: e.target.value })}
                  required
                />
              </div>
              <div>
                <label>Store Address</label>
                <input
                  placeholder="Store Address"
                  value={formData.storeAddress}
                  onChange={e => setFormData({ ...formData, storeAddress: e.target.value })}
                  required
                />
              </div>
              <div className="form-actions">
                <button type="submit" className="btn-primary">Save Settings</button>
                <button type="button" onClick={() => { setEditing(false); setFormData(settings) }} className="btn-secondary">Cancel</button>
              </div>
            </form>
          )}

          {showPasswordForm && (
            <form onSubmit={handleChangePassword} className="customer-form settings-form password-form">
              <h3>Change Password</h3>
              <div>
                <label>Current Password</label>
                <input
                  type="password"
                  placeholder="Current Password"
                  value={passwordData.currentPassword}
                  onChange={e => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                  required
                />
              </div>
              <div>
                <label>New Password</label>
                <input
                  type="password"
                  placeholder="New Password"
                  value={passwordData.newPassword}
                  onChange={e => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                  required
                />
              </div>
              <div>
                <label>Confirm New Password</label>
                <input
                  type="password"
                  placeholder="Confirm New Password"
                  value={passwordData.confirmPassword}
                  onChange={e => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                  required
                />
              </div>
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

      <button onClick={() => { setShowAddForm(!showAddForm); setEditingSupplier(null); setFormData({ name: '', contactNumber: '', address: '' }) }} className="btn-primary" type="button">
        {showAddForm || editingSupplier ? 'Cancel' : '+ Add Supplier'}
      </button>

      {(showAddForm || editingSupplier) && (
        <form onSubmit={editingSupplier ? handleUpdateSupplier : handleAddSupplier} className="customer-form">
          <input
            placeholder="Name"
            value={formData.name}
            onChange={e => setFormData({ ...formData, name: e.target.value })}
            required
          />
          <input
            placeholder="Contact Number"
            value={formData.contactNumber}
            onChange={e => setFormData({ ...formData, contactNumber: e.target.value })}
          />
          <input
            placeholder="Address"
            value={formData.address}
            onChange={e => setFormData({ ...formData, address: e.target.value })}
          />
          <button type="submit" className="btn-primary">{editingSupplier ? 'Update Supplier' : 'Add Supplier'}</button>
        </form>
      )}

      <div className="customer-list">
        {suppliers.length === 0 ? (
          <div className="empty-state">No suppliers yet.</div>
        ) : (
          suppliers.map(supplier => (
            <div key={supplier._id} className="customer-card">
              <div className="customer-info">
                <h3>{supplier.name}</h3>
                {supplier.contactNumber && <p>📱 {supplier.contactNumber}</p>}
                {supplier.address && <p>📍 {supplier.address}</p>}
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
