import { AdminDashboard, AdminUsers } from './AdminPages'
import { authApi } from '../../services/authApi'
import { adminPageFromPath, adminPageSlugs, pagePath } from '../../services/pageRoutes'
import './AdminPages.css'

export function AdminPanel() {
  const activeNav = adminPageFromPath(window.location.pathname)

  const navItems = ['Dashboard', 'Users']

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
            <div className="brand-name">SariManager</div>
            <div className="brand-sub">Admin Panel</div>
          </div>
        </div>

        <div className="store-box">
          <div className="mini-label">Admin Access</div>
          <div className="store-name">System Administrator</div>
        </div>

        <nav className="nav-list">
          {navItems.map((item) => (
            <a key={item} href={pagePath(adminPageSlugs[item]!)} className={activeNav === item ? 'nav-item active' : 'nav-item'} aria-current={activeNav === item ? 'page' : undefined}>
              <span className="nav-icon">{item === 'Dashboard' ? '▣' : item === 'Users' ? '👥' : '⚙'}</span>
              {item}
            </a>
          ))}
          <button className="nav-item logout-btn" onClick={handleLogout} type="button">
            <span className="nav-icon">⏻</span>
            Logout
          </button>
        </nav>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="page-title">Admin {activeNav}</div>
        </header>

        {activeNav === 'Dashboard' && <AdminDashboard />}
        {activeNav === 'Users' && <AdminUsers />}
      </main>
    </div>
  )
}
