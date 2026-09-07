import { useEffect, useState } from 'react'
import { POSFlow } from '../pos/POSFlow'
import { storeApi, type DashboardSummary } from '../../services/storeApi'
import { authApi } from '../../services/authApi'
import { AlertsPage, CustomersPage, ExpensesPage, ReportsPage, SalesPage, SettingsPage, SuppliersPage } from '../business/BusinessPages'
import { PriceListPage } from './PriceListPage'

const formatPeso = (value: number) => `₱${value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function StoreOperationsDemo() {
  const [activeNav, setActiveNav] = useState('Dashboard')
  const [navNotice, setNavNotice] = useState('')
  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null)
  const [dashboardError, setDashboardError] = useState('')
  const [showLogoutModal, setShowLogoutModal] = useState(false)

  useEffect(() => {
    storeApi.dashboard()
      .then(setDashboard)
      .catch((error: unknown) => setDashboardError(error instanceof Error ? error.message : 'Unable to load dashboard data.'))
  }, [])

  const chartData = dashboard?.salesOverview ?? []
  const chartMax = Math.max(...chartData.map((point) => point.sales), 1)
  const chartPath = chartData.length > 0
    ? chartData.map((point, index) => `${index === 0 ? 'M' : 'L'} ${(index / Math.max(chartData.length - 1, 1)) * 760} ${190 - (point.sales / chartMax) * 150}`).join(' ')
    : 'M0 190 L760 190'
  const chartAreaPath = `${chartPath} L760 220 L0 220 Z`

  const navItems = ['Dashboard', 'POS', 'Price List', 'Sales', 'Customers', 'Suppliers', 'Expenses', 'Reports', 'Alerts', 'Settings']

  const handleNavigation = (item: string) => {
    setActiveNav(item)
    setNavNotice('')
    if (item === 'Dashboard') window.scrollTo({ top: 0, behavior: 'smooth' })
    if (item === 'POS') {
      return
    }
  }

  const handleLogout = async () => {
    const token = localStorage.getItem('sarismart_token')
    try {
      if (token) {
        await authApi.logout(token)
      }
    } catch (err) {
      console.error('Logout error:', err)
    } finally {
      localStorage.removeItem('sarismart_token')
      window.location.href = '/login'
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-mark">◫</div>
          <div>
            <div className="brand-name">SariManager</div>
            <div className="brand-sub">Smarter sari-sari</div>
          </div>
        </div>

        <div className="store-box">
          <div className="mini-label">Current Store</div>
          <div className="store-name">{dashboard?.store.name ?? 'Your Store'}</div>
        </div>

        <nav className="nav-list">
          {navItems.map((item) => (
            <button key={item} className={activeNav === item ? 'nav-item active' : 'nav-item'} onClick={() => handleNavigation(item)} type="button">
              <span className="nav-icon">{item === 'Dashboard' ? '▣' : item === 'POS' ? '◫' : item === 'Price List' ? '₱' : item === 'Sales' ? '₱' : item === 'Inventory' ? '▤' : item === 'Customers' ? '◔' : item === 'Suppliers' ? '◍' : item === 'Expenses' ? '▦' : item === 'Reports' ? '▥' : item === 'Alerts' ? '⚑' : '⚙'}</span>
              {item}
            </button>
          ))}
          <button className="nav-item logout-btn" onClick={() => setShowLogoutModal(true)} type="button">
            <span className="nav-icon">⏻</span>
            Logout
          </button>
        </nav>
      </aside>

      <main className="main-panel">
        {navNotice && <div className="dashboard-error">{navNotice}</div>}
        <header className="topbar">
          <div className="page-title">{dashboard?.store.name ?? 'Your Store'}</div>
        </header>

        {activeNav === 'Sales' && <SalesPage />}
        {activeNav === 'Customers' && <CustomersPage />}
        {activeNav === 'Suppliers' && <SuppliersPage />}
        {activeNav === 'Reports' && <ReportsPage />}
          {activeNav === 'Price List' && <PriceListPage />}
        {activeNav === 'Expenses' && <ExpensesPage />}
        {activeNav === 'Alerts' && <AlertsPage />}
        {activeNav === 'Settings' && <SettingsPage />}
        {activeNav === 'POS' && <section className="pos-page"><div className="pos-page-heading"><div><p className="business-eyebrow">POINT OF SALE</p><h2>POS</h2><p>Scan products, build a cart, and complete checkout.</p></div></div><POSFlow /></section>}

        <div className={activeNav === 'Dashboard' ? '' : 'hidden-dashboard'}>
        <div className="kpi-grid">
          <div className="kpi-card">
            <div className="kpi-header">
              <span className="kpi-label">Today's Sales</span>
              <span className="kpi-icon positive">↗</span>
            </div>
            <div className="kpi-value">{formatPeso(dashboard?.kpis.todaysSales ?? 0)}</div>
            <div className="kpi-sub">{dashboard?.kpis.transactions ?? 0} transactions</div>
          </div>

          <div className="kpi-card">
            <div className="kpi-header">
              <span className="kpi-label">Est. Profit</span>
              <span className="kpi-icon neutral">◫</span>
            </div>
            <div className="kpi-value">{formatPeso(dashboard?.kpis.estimatedProfit ?? 0)}</div>
            <div className="kpi-sub"> </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-header">
              <span className="kpi-label">Outstanding Utang</span>
              <span className="kpi-icon warning">₱</span>
            </div>
            <div className="kpi-value">{formatPeso(dashboard?.kpis.outstandingUtang ?? 0)}</div>
            <div className="kpi-sub"> </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-header">
              <span className="kpi-label">Inventory Value</span>
              <span className="kpi-icon pastel">◧</span>
            </div>
            <div className="kpi-value">{formatPeso(dashboard?.kpis.inventoryValue ?? 0)}</div>
            <div className="kpi-sub"> </div>
          </div>
        </div>

        <div className="content-grid">
          <section className="panel chart-panel">
            <div className="panel-header">
              <h3>Sales Overview</h3>
              <span className="panel-chip">Last 7 days</span>
            </div>
            <svg viewBox="0 0 760 220" className="chart-svg" aria-label="Sales chart">
              <path d={chartAreaPath} fill="rgba(59, 130, 246, 0.18)" />
              <path d={chartPath} fill="none" stroke="#3b82f6" strokeWidth="3" strokeLinecap="round" />
              <g className="chart-grid-lines">
                <line x1="0" y1="30" x2="760" y2="30" />
                <line x1="0" y1="70" x2="760" y2="70" />
                <line x1="0" y1="110" x2="760" y2="110" />
                <line x1="0" y1="150" x2="760" y2="150" />
                <line x1="0" y1="190" x2="760" y2="190" />
              </g>
            </svg>
            <div className="chart-labels">
              {(dashboard?.salesOverview ?? []).map((point) => <span key={point.date}>{new Date(`${point.date}T00:00:00`).toLocaleDateString('en-PH', { weekday: 'short' })}</span>)}
            </div>
          </section>

          <section className="panel sales-panel">
            <div className="panel-header">
              <h3>Top Selling</h3>
            </div>
            <div className="top-list">
              {(dashboard?.topSelling ?? []).map((item) => (
                <div key={item.name} className="rank-row">
                  <div className="rank-badge">{item.rank}</div>
                  <div className="rank-name">{item.name}</div>
                  <div className="rank-count">{item.sold} sold</div>
                </div>
              ))}
              {!dashboard?.topSelling.length && <div className="empty-state">No completed sales yet.</div>}
            </div>
          </section>
        </div>

        <div className="bottom-grid">
          <section className="panel low-stock-panel">
            <div className="panel-header">
              <h3>Low Stock</h3>
              <span className="panel-chip danger">{dashboard?.lowStock.length ?? 0}</span>
            </div>
            <div className="stock-list">
              {(dashboard?.lowStock ?? []).map((item) => (
                <div key={item.id} className="stock-row">
                  <span className="stock-name">{item.name}</span>
                  <span className="stock-left">{item.currentStock} left</span>
                </div>
              ))}
              {!dashboard?.lowStock.length && <div className="empty-state">No low-stock products.</div>}
            </div>
          </section>

          <section className="panel transactions-panel">
            <div className="panel-header">
              <h3>Recent Transactions</h3>
            </div>
            <div className="transaction-list">
              {(dashboard?.recentTransactions ?? []).map((transaction) => (
                <div key={transaction.id} className="transaction-row">
                  <div>
                    <div className="tx-id">#{transaction.id}</div>
                    <div className="tx-meta">{new Date(transaction.createdAt).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })} · {transaction.paymentMethod}</div>
                  </div>
                  <div className="tx-amount">{formatPeso(transaction.amount)}</div>
                </div>
              ))}
              {!dashboard?.recentTransactions.length && <div className="empty-state">No recent transactions.</div>}
            </div>
          </section>
        </div>

        {dashboardError && <div className="dashboard-error">{dashboardError}</div>}
        </div>
      </main>

      {showLogoutModal && (
        <div className="delete-backdrop">
          <div className="delete-dialog">
            <div className="delete-icon">!</div>
            <h3>Logout?</h3>
            <p>Are you sure you want to logout? You will need to log in again to access your store.</p>
            <div className="delete-actions">
              <button onClick={() => setShowLogoutModal(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleLogout} className="danger-button">Logout</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default StoreOperationsDemo
