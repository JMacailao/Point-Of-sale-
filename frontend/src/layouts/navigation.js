import {
  LayoutDashboard, ShoppingCart, Package, Boxes, Users, Receipt, Wallet, BarChart3, Settings,
} from 'lucide-react'

export const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, perms: ['dashboard.view'] },
  { to: '/cashier', label: 'Cashier', icon: ShoppingCart, perms: ['pos.use'] },
  { to: '/products', label: 'Products', icon: Package, perms: ['products.view'] },
  { to: '/inventory', label: 'Stock / Inventory', icon: Boxes, perms: ['inventory.view'] },
  { to: '/users', label: 'Users', icon: Users, perms: ['users.manage'] },
  { to: '/sales', label: 'Revenue & Sales', icon: Receipt, perms: ['sales.view_all', 'sales.view_own'] },
  { to: '/expenses', label: 'Expenses', icon: Wallet, perms: ['expenses.view'] },
  { to: '/reports', label: 'Reports', icon: BarChart3, perms: ['reports.view'] },
  { to: '/settings', label: 'Settings', icon: Settings, perms: null },
]

export const BOTTOM_NAV = ['/dashboard', '/cashier', '/products', '/sales']

export function allowedNav(can) {
  return NAV_ITEMS.filter((i) => !i.perms || can(...i.perms))
}

export function homePath(can) {
  return allowedNav(can)[0]?.to || '/settings'
}
