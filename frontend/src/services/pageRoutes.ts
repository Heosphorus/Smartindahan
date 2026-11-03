const BASE_PATH = import.meta.env.BASE_URL.replace(/\/+$/, '')

export const storePageSlugs: Record<string, string> = {
  Dashboard: 'dashboard',
  POS: 'pos',
  Inventory: 'inventory',
  'Price List': 'price-list',
  Sales: 'sales',
  Customers: 'customers',
  Suppliers: 'suppliers',
  Expenses: 'expenses',
  Reports: 'reports',
  Alerts: 'alerts',
  Settings: 'settings',
}

export const adminPageSlugs: Record<string, string> = {
  Dashboard: 'admin',
  Users: 'admin/users',
}

export function pagePath(slug: string): string {
  // GitHub Pages does not rewrite unknown paths to index.html, so use hash routes there.
  return BASE_PATH ? `${BASE_PATH}/#/${slug}` : `/${slug}`
}

function routeFromPath(pathname: string): string {
  const hashRoute = window.location.hash.replace(/^#\/?/, '')
  if (hashRoute) return hashRoute
  const path = pathname.replace(/\/+$/, '')
  if (BASE_PATH && (path === BASE_PATH || path.startsWith(`${BASE_PATH}/`))) {
    return path.slice(BASE_PATH.length).replace(/^\/+/, '')
  }
  return path.replace(/^\/+/, '')
}

export function storePageFromPath(pathname: string): string {
  const route = routeFromPath(pathname)
  return Object.entries(storePageSlugs).find(([, slug]) => slug === route)?.[0] ?? 'Dashboard'
}

export function isAdminPath(pathname: string): boolean {
  return routeFromPath(pathname) === 'admin' || routeFromPath(pathname).startsWith('admin/')
}

export function adminPageFromPath(pathname: string): string {
  const route = routeFromPath(pathname)
  return Object.entries(adminPageSlugs).find(([, slug]) => slug === route)?.[0] ?? 'Dashboard'
}
