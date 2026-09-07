import { useState } from 'react'
import { AdminDashboard, AdminUsers } from './AdminPages'
import { authApi } from '../../services/authApi'
import './AdminPages.css'

export function AdminPanel() {
  const [activeNav, setActiveNav] = useState('Dashboard')

  const navItems = ['Dashboard', 'Users']

  const handleNavigation = (item: string) => {
    setActiveNav(item)
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
            <div className="brand-sub">Admin Panel</div>
          </div>
        </div>

        <div className="store-box">
          <div className="mini-label">Admin Access</div>
          <div className="store-name">System Administrator</div>
        </div>

        <nav className="nav-list">
          {navItems.map((item) => (
            <button key={item} className={activeNav === item ? 'nav-item active' : 'nav-item'} onClick={() => handleNavigation(item)} type="button">
              <span className="nav-icon">{item === 'Dashboard' ? '▣' : item === 'Users' ? '👥' : '⚙'}</span>
              {item}
            </button>
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
