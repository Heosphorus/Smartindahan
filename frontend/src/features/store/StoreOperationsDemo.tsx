import { useEffect, useState } from 'react'
import { POSFlow } from '../pos/POSFlow'
import { storeApi, type DashboardSummary } from '../../services/storeApi'
import { authApi } from '../../services/authApi'
import { AlertsPage, CustomersPage, ExpensesPage, ReportsPage, SalesPage, SettingsPage, SuppliersPage } from '../business/BusinessPages'
import { PriceListPage } from './PriceListPage'
import { InventoryPage } from '../inventory/InventoryPage'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { pagePath, storePageFromPath, storePageSlugs } from '../../services/pageRoutes'
import './DashboardControls.css'

const formatPeso = (value: number) => `₱${value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
// Until the dashboard has loaded, show a dash instead of a zero that could be mistaken for real figures.
const NOT_LOADED = '—'

export function StoreOperationsDemo() {
  const activeNav = storePageFromPath(window.location.pathname)
  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null)
  const [dashboardError, setDashboardError] = useState('')
  const [showLogoutModal, setShowLogoutModal] = useState(false)
  useEscapeKey(showLogoutModal, () => setShowLogoutModal(false))
  const [salesPeriod, setSalesPeriod] = useState<'weekly' | 'monthly'>('weekly')

  const [reloadCount, setReloadCount] = useState(0)

  // Reload whenever the Dashboard is shown, so sales recorded in the POS appear without a manual refresh.
  useEffect(() => {
    if (activeNav !== 'Dashboard') return undefined
    let currentRequest = true
    storeApi.dashboard(salesPeriod)
      .then((data) => { if (currentRequest) { setDashboard(data); setDashboardError('') } })
      .catch((error: unknown) => { if (currentRequest) setDashboardError(error instanceof Error ? error.message : 'Unable to load dashboard data.') })
    return () => { currentRequest = false }
  }, [salesPeriod, activeNav, reloadCount])

  useEffect(() => {
    const syncStoreName = (event: Event) => {
      const detail = (event as CustomEvent<{ storeName?: string }>).detail
      if (!detail?.storeName) return
      setDashboard((current) => current ? { ...current, store: { ...current.store, name: detail.storeName! } } : current)
    }
    window.addEventListener('smarTindahan:store-profile-updated', syncStoreName)
    return () => window.removeEventListener('smarTindahan:store-profile-updated', syncStoreName)
  }, [])

  const chartData = dashboard?.salesOverview ?? []
  const chartMax = Math.max(...chartData.map((point) => point.sales), 1)
  const chartPath = chartData.length > 0
    ? chartData.map((point, index) => `${index === 0 ? 'M' : 'L'} ${(index / Math.max(chartData.length - 1, 1)) * 760} ${190 - (point.sales / chartMax) * 150}`).join(' ')
    : 'M0 190 L760 190'
  const chartAreaPath = `${chartPath} L760 220 L0 220 Z`

  const navItems = ['Dashboard', 'POS', 'Inventory', 'Price List', 'Sales', 'Customers', 'Suppliers', 'Expenses', 'Reports', 'Alerts', 'Settings']

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
      window.location.assign(import.meta.env.BASE_URL)
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-mark">◫</div>
          <div>
            <div className="brand-name">smarTindahan</div>
            <div className="brand-sub">Smarter tools for your tindahan</div>
          </div>
        </div>

        <div className="store-box">
          <div className="mini-label">Current Store</div>
          <div className="store-name">{dashboard?.store.name ?? 'Your Store'}</div>
        </div>

        <nav className="nav-list">
          {navItems.map((item) => (
            <a key={item} href={pagePath(storePageSlugs[item]!)} className={activeNav === item ? 'nav-item active' : 'nav-item'} aria-current={activeNav === item ? 'page' : undefined}>
              <span className="nav-icon">{item === 'Dashboard' ? '▣' : item === 'POS' ? '◫' : item === 'Price List' ? '₱' : item === 'Sales' ? '₱' : item === 'Inventory' ? '▤' : item === 'Customers' ? '◔' : item === 'Suppliers' ? '◍' : item === 'Expenses' ? '▦' : item === 'Reports' ? '▥' : item === 'Alerts' ? '⚑' : '⚙'}</span>
              {item}
            </a>
          ))}
          <button className="nav-item logout-btn" onClick={() => setShowLogoutModal(true)} type="button">
            <span className="nav-icon">⏻</span>
            Logout
          </button>
        </nav>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="page-title">{dashboard?.store.name ?? 'Your Store'}</div>
        </header>

        {activeNav === 'Sales' && <SalesPage />}
        {activeNav === 'Customers' && <CustomersPage />}
        {activeNav === 'Suppliers' && <SuppliersPage />}
        {activeNav === 'Reports' && <ReportsPage />}
        {activeNav === 'Inventory' && <InventoryPage />}
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
            <div className="kpi-value">{dashboard ? formatPeso(dashboard.kpis.todaysSales) : NOT_LOADED}</div>
            <div className="kpi-sub">{dashboard ? `${dashboard.kpis.transactions} ${dashboard.kpis.transactions === 1 ? 'transaction' : 'transactions'} today` : 'Loading…'}</div>
          </div>

          <div className="kpi-card">
            <div className="kpi-header">
              <span className="kpi-label">Today's Profit (est.)</span>
              <span className="kpi-icon neutral">◫</span>
            </div>
            <div className="kpi-value">{dashboard ? formatPeso(dashboard.kpis.estimatedProfit) : NOT_LOADED}</div>
            <div className="kpi-sub">Sales minus cost of goods</div>
          </div>

          <div className="kpi-card">
            <div className="kpi-header">
              <span className="kpi-label">Outstanding Utang</span>
              <span className="kpi-icon warning">₱</span>
            </div>
            <div className="kpi-value">{dashboard ? formatPeso(dashboard.kpis.outstandingUtang) : NOT_LOADED}</div>
            <div className="kpi-sub"> </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-header">
              <span className="kpi-label">Inventory Value</span>
              <span className="kpi-icon pastel">◧</span>
            </div>
            <div className="kpi-value">{dashboard ? formatPeso(dashboard.kpis.inventoryValue) : NOT_LOADED}</div>
            <div className="kpi-sub">Stock on hand, at cost price</div>
          </div>
        </div>

        <div className="content-grid">
          <section className="panel chart-panel">
            <div className="panel-header">
              <h3>Sales Overview</h3>
              <label className="sales-period-control">
                <span className="sr-only">Sales overview period</span>
                <select value={salesPeriod} onChange={(event) => {
                  setDashboardError('')
                  setSalesPeriod(event.target.value as 'weekly' | 'monthly')
                }} aria-label="Sales overview period">
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </label>
            </div>
            <p className="chart-summary">{dashboard ? `Best day: ${formatPeso(chartMax === 1 && !chartData.some((point) => point.sales > 0) ? 0 : chartMax)} · Total: ${formatPeso(chartData.reduce((sum, point) => sum + point.sales, 0))}` : 'Loading…'}</p>
            {dashboard && !chartData.some((point) => point.sales > 0) && <p className="chart-empty">No sales in this period yet. The chart fills in as you complete sales in the POS.</p>}
            <svg viewBox="0 0 760 220" className="chart-svg" role="img" aria-label={`Sales chart, ${salesPeriod}: ${chartData.map((point) => `${point.date} ${formatPeso(point.sales)}`).join(', ')}`}>
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
            <div className={`chart-labels ${salesPeriod}`}>
              {chartData.map((point, index) => {
                if (salesPeriod === 'monthly' && index !== 0 && index % 5 !== 0 && index !== chartData.length - 1) return null
                const date = new Date(`${point.date}T00:00:00Z`)
                const label = salesPeriod === 'weekly'
                  ? date.toLocaleDateString('en-PH', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'UTC' })
                  : date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: 'UTC' })
                return <span key={point.date}>{label}</span>
              })}
            </div>
          </section>

          <section className="panel sales-panel">
            <div className="panel-header">
              <h3>Top Selling (all time)</h3>
            </div>
            <div className="top-list">
              {(dashboard?.topSelling ?? []).map((item) => (
                <div key={item.name} className="rank-row">
                  <div className="rank-badge">{item.rank}</div>
                  <div className="rank-name">{item.name}</div>
                  <div className="rank-count">{item.sold} sold</div>
                </div>
              ))}
              {dashboard && !dashboard.topSelling.length && <div className="empty-state">No completed sales yet.</div>}
              {!dashboard && <div className="empty-state">Loading…</div>}
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
              {dashboard && !dashboard.lowStock.length && <div className="empty-state">No low-stock products.</div>}
              {!dashboard && <div className="empty-state">Loading…</div>}
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
                    <div className="tx-id" title={transaction.id}>#{transaction.id.replace(/^TXN-/, '').slice(0, 8).toUpperCase()}</div>
                    <div className="tx-meta">{new Date(transaction.createdAt).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })} · {transaction.paymentMethod}</div>
                  </div>
                  <div className="tx-amount">{formatPeso(transaction.amount)}</div>
                </div>
              ))}
              {dashboard && !dashboard.recentTransactions.length && <div className="empty-state">No recent transactions.</div>}
              {!dashboard && <div className="empty-state">Loading…</div>}
            </div>
          </section>
        </div>

        {dashboardError && <div className="dashboard-error" role="alert">{dashboardError} <button type="button" className="btn-secondary" onClick={() => { setDashboardError(''); setReloadCount((count) => count + 1) }}>Try again</button></div>}
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
