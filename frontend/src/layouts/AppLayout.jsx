import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, Link } from 'react-router-dom'
import { LogOut, Menu, Store, UserCircle2, X, MoreHorizontal } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { allowedNav, BOTTOM_NAV } from './navigation'

function SidebarContent({ onNavigate }) {
  const { store, user, session, logout, can } = useAuth()
  const items = allowedNav(can)
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2.5 border-b border-slate-200 px-4">
        {store?.logo_url
          ? <img src={store.logo_url} alt="" className="size-8 rounded border border-slate-200 object-contain" />
          : <div className="flex size-8 items-center justify-center rounded bg-blue-600 text-white"><Store className="size-4" /></div>}
        <span className="truncate text-sm font-semibold text-slate-900">{store?.store_name}</span>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Main">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} onClick={onNavigate}
            className={({ isActive }) => `mb-0.5 flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm ${isActive
              ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}>
            <Icon className="size-4 shrink-0" /> {label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-slate-200 p-3">
        <div className="mb-2 flex items-center gap-2.5 px-1">
          <UserCircle2 className="size-8 shrink-0 text-slate-400" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-900">{user?.fullName || user?.email}</p>
            <p className="truncate text-xs text-slate-500">{session?.role?.name}</p>
          </div>
        </div>
        <div className="flex gap-1">
          <Link to="/settings?tab=profile" onClick={onNavigate} className="flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-100">
            <UserCircle2 className="size-3.5" /> Profile
          </Link>
          <button onClick={logout} className="flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-red-600 hover:bg-red-50">
            <LogOut className="size-3.5" /> Logout
          </button>
        </div>
      </div>
    </div>
  )
}

export default function AppLayout() {
  const { can, store } = useAuth()
  const [drawer, setDrawer] = useState(false)
  const location = useLocation()
  useEffect(() => { setDrawer(false) }, [location.pathname])

  const items = allowedNav(can)
  const bottom = items.filter((i) => BOTTOM_NAV.includes(i.to))
  const current = items.find((i) => location.pathname.startsWith(i.to))
  const isCashier = location.pathname.startsWith('/cashier')

  return (
    <div className="min-h-dvh bg-slate-50 lg:pl-60">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-slate-200 bg-white lg:block">
        <SidebarContent />
      </aside>

      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85%] bg-white shadow-xl">
            <button className="absolute top-3 right-3 rounded p-1 text-slate-500 hover:bg-slate-100" onClick={() => setDrawer(false)} aria-label="Close menu">
              <X className="size-5" />
            </button>
            <SidebarContent onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      )}

      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4">
        <button className="-ml-1 rounded p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setDrawer(true)} aria-label="Open menu">
          <Menu className="size-5" />
        </button>
        <h1 className="truncate text-sm font-semibold text-slate-900">{current?.label || 'Point of Sale'}</h1>
        <span className="ml-auto truncate text-xs text-slate-500 lg:hidden">{store?.store_name}</span>
      </header>

      <main className={`mx-auto w-full ${isCashier ? 'max-w-none p-0 lg:p-4' : 'max-w-7xl p-4'} pb-24 lg:pb-6`}>
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Quick">
        {bottom.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to}
            className={({ isActive }) => `flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${isActive ? 'text-blue-700' : 'text-slate-500'}`}>
            <Icon className="size-5" /> {label.replace('Revenue & ', '')}
          </NavLink>
        ))}
        <button onClick={() => setDrawer(true)} className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] text-slate-500">
          <MoreHorizontal className="size-5" /> More
        </button>
      </nav>
    </div>
  )
}
