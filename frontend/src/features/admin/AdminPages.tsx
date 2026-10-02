import { useEffect, useState } from 'react'
import { authApi } from '../../services/authApi'
import './AdminPages.css'

type AdminUser = {
  _id: string
  email: string
  maskedEmail?: string
  status: string
  createdAt: string
  storeName?: string
}

type AdminStats = {
  totalUsers: number
  activeUsers: number
  pendingUsers: number
}

export function AdminDashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const token = localStorage.getItem('sarismart_token')
    if (!token) {
      setError('You must be logged in as admin')
      setLoading(false)
      return
    }
    authApi.adminGetStats(token)
      .then(data => setStats(data.stats ?? null))
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load admin stats'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="admin-page"><p>Loading admin dashboard...</p></div>

  return (
    <section className="admin-page">
      <div className="business-eyebrow">ADMIN DASHBOARD</div>
      <h2>Admin Dashboard</h2>
      <p>Overview of all registered users and system statistics.</p>

      {error && <div className="dashboard-error">{error}</div>}

      {stats && (
        <div className="admin-stats-grid">
          <div className="admin-stat-card">
            <div className="stat-label">Total Users</div>
            <div className="stat-value">{stats.totalUsers}</div>
          </div>
          <div className="admin-stat-card active">
            <div className="stat-label">Active Users</div>
            <div className="stat-value">{stats.activeUsers}</div>
          </div>
          <div className="admin-stat-card pending">
            <div className="stat-label">Pending Users</div>
            <div className="stat-value">{stats.pendingUsers}</div>
          </div>
        </div>
      )}
    </section>
  )
}

export function AdminUsers() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null)
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [showEmailModal, setShowEmailModal] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [newEmail, setNewEmail] = useState('')

  useEffect(() => {
    const token = localStorage.getItem('sarismart_token')
    if (!token) {
      setError('You must be logged in as admin')
      setLoading(false)
      return
    }
    authApi.adminGetUsers(token)
      .then(data => setUsers(data.users || []))
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load users'))
      .finally(() => setLoading(false))
  }, [])

  const handleChangePassword = async () => {
    const token = localStorage.getItem('sarismart_token')
    if (!token || !selectedUser) return
    try {
      await authApi.adminChangeUserPassword(token, selectedUser._id, newPassword)
      setShowPasswordModal(false)
      setNewPassword('')
      setSelectedUser(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change password')
    }
  }

  const handleChangeEmail = async () => {
    const token = localStorage.getItem('sarismart_token')
    if (!token || !selectedUser) return
    try {
      await authApi.adminChangeUserEmail(token, selectedUser._id, newEmail)
      setShowEmailModal(false)
      setNewEmail('')
      setSelectedUser(null)
      // Refresh user list
      authApi.adminGetUsers(token)
        .then(data => setUsers(data.users || []))
        .catch(err => setError(err instanceof Error ? err.message : 'Failed to refresh users'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change email')
    }
  }

  const handleImpersonate = async (user: AdminUser) => {
    const token = localStorage.getItem('sarismart_token')
    if (!token) return
    try {
      const result = await authApi.adminImpersonateUser(token, user._id)
      if (result.token) {
        localStorage.setItem('sarismart_token', result.token)
        window.location.href = '/dashboard'
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to access account')
    }
  }

  if (loading) return <div className="admin-page"><p>Loading users...</p></div>

  return (
    <section className="admin-page">
      <div className="business-eyebrow">ADMIN USERS</div>
      <h2>User Management</h2>
      <p>Manage all registered user accounts.</p>

      {error && <div className="dashboard-error">{error}</div>}

      <div className="admin-users-list">
        {users.length === 0 ? (
          <div className="empty-state">No users found.</div>
        ) : (
          users.map(user => (
            <div key={user._id} className="admin-user-card">
              <div className="user-info">
                <h3>{user.maskedEmail || user.email}</h3>
                {user.storeName && <p>🏪 {user.storeName}</p>}
                <p className="user-date">Registered: {new Date(user.createdAt).toLocaleDateString()}</p>
              </div>
              <div className="user-status">
                <span className={`status-badge status-${user.status.toLowerCase()}`}>
                  {user.status}
                </span>
              </div>
              <div className="user-actions">
                <button onClick={() => { setSelectedUser(user); setShowPasswordModal(true) }} className="btn-secondary" type="button">Change Password</button>
                <button onClick={() => { setSelectedUser(user); setShowEmailModal(true) }} className="btn-secondary" type="button">Change Email</button>
                <button onClick={() => handleImpersonate(user)} className="btn-primary" type="button">Access Account</button>
              </div>
            </div>
          ))
        )}
      </div>

      {showPasswordModal && selectedUser && (
        <div className="delete-backdrop">
          <div className="delete-dialog">
            <div className="delete-icon">!</div>
            <h3>Change Password</h3>
            <p>Change password for {selectedUser.maskedEmail || selectedUser.email}</p>
            <input
              type="password"
              placeholder="New Password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              className="modal-input"
            />
            <div className="delete-actions">
              <button onClick={() => { setShowPasswordModal(false); setNewPassword(''); setSelectedUser(null) }} className="btn-secondary">Cancel</button>
              <button onClick={handleChangePassword} className="danger-button">Change Password</button>
            </div>
          </div>
        </div>
      )}

      {showEmailModal && selectedUser && (
        <div className="delete-backdrop">
          <div className="delete-dialog">
            <div className="delete-icon">!</div>
            <h3>Change Email</h3>
            <p>Change email for {selectedUser.maskedEmail || selectedUser.email}</p>
            <input
              type="email"
              placeholder="New Email"
              value={newEmail}
              onChange={e => setNewEmail(e.target.value)}
              className="modal-input"
            />
            <div className="delete-actions">
              <button onClick={() => { setShowEmailModal(false); setNewEmail(''); setSelectedUser(null) }} className="btn-secondary">Cancel</button>
              <button onClick={handleChangeEmail} className="danger-button">Change Email</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
