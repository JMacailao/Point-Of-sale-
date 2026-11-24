import { lazy, Suspense } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import AppLayout from './layouts/AppLayout'
import { homePath } from './layouts/navigation'
import { AdminStep, StoreStep, WelcomeStep } from './pages/setup/SetupWizard'
import LoginPage from './pages/auth/LoginPage'
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage'
import { Button, PageLoader, Spinner } from './components/ui'
import { firebaseConfigured } from './services/firebase'

const DashboardPage = lazy(() => import('./pages/dashboard/DashboardPage'))
const CashierPage = lazy(() => import('./pages/cashier/CashierPage'))
const ProductsPage = lazy(() => import('./pages/products/ProductsPage'))
const InventoryPage = lazy(() => import('./pages/inventory/InventoryPage'))
const UsersPage = lazy(() => import('./pages/users/UsersPage'))
const SalesPage = lazy(() => import('./pages/sales/SalesPage'))
const ExpensesPage = lazy(() => import('./pages/expenses/ExpensesPage'))
const ReportsPage = lazy(() => import('./pages/reports/ReportsPage'))
const SettingsPage = lazy(() => import('./pages/settings/SettingsPage'))

function Splash() {
  return <div className="flex min-h-dvh items-center justify-center"><Spinner className="size-6" /></div>
}

function ConfigError({ title, message, onRetry }) {
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center">
        <h1 className="text-base font-semibold text-slate-900">{title}</h1>
        <p className="mt-2 text-sm text-slate-600">{message}</p>
        {onRetry && <Button className="mt-4" variant="secondary" onClick={onRetry}>Try again</Button>}
      </div>
    </div>
  )
}

/** Routes for the protected application. */
function RequireSession() {
  const { setupStatus, session } = useAuth()
  const location = useLocation()
  if (!setupStatus.adminClaimed) return <Navigate to="/setup" replace />
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (session.setup.pendingStoreSetup) return <Navigate to="/setup" replace />
  return <Outlet />
}

function RequirePermission({ perms, children }) {
  const { can } = useAuth()
  if (perms && !can(...perms)) return <Navigate to={homePath(can)} replace />
  return children
}

function SetupGate() {
  const { setupStatus, session, can } = useAuth()
  if (!setupStatus.adminClaimed) return <AdminStep />
  if (session?.setup.pendingStoreSetup) return <StoreStep />
  if (session) return <Navigate to={homePath(can)} replace />
  // The administrator exists: never show registration again. Sign in to resume.
  return <Navigate to="/login" replace />
}

function LoginGate() {
  const { setupStatus, session, can } = useAuth()
  const location = useLocation()
  if (!setupStatus.adminClaimed) return <Navigate to="/setup" replace />
  if (session?.setup.pendingStoreSetup) return <Navigate to="/setup" replace />
  if (session) return <Navigate to={location.state?.from || homePath(can)} replace />
  return <LoginPage />
}

function Home() {
  const { setupStatus, session, can } = useAuth()
  if (!setupStatus.adminClaimed) return <Navigate to="/setup" replace />
  if (!session) return <Navigate to="/login" replace />
  if (session.setup.pendingStoreSetup) return <Navigate to="/setup" replace />
  return <Navigate to={homePath(can)} replace />
}

const page = (Component, perms) => (
  <RequirePermission perms={perms}>
    <Suspense fallback={<PageLoader />}><Component /></Suspense>
  </RequirePermission>
)

export default function App() {
  const { setupStatus, statusError, refreshSetupStatus, firebaseUser, session, sessionLoading } = useAuth()

  if (!firebaseConfigured) {
    return <ConfigError title="Firebase is not configured"
      message="Set the VITE_FIREBASE_* variables in frontend/.env (see .env.example) and restart the app." />
  }
  if (statusError) {
    return <ConfigError title="Cannot reach the POS server" message={statusError.message} onRetry={refreshSetupStatus} />
  }
  if (!setupStatus || firebaseUser === undefined || (firebaseUser && sessionLoading)) return <Splash />

  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/setup" element={<SetupGate />} />
      <Route path="/welcome" element={session ? <WelcomeStep /> : <Navigate to="/" replace />} />
      <Route path="/login" element={<LoginGate />} />
      <Route path="/forgot-password" element={session ? <Navigate to="/" replace /> : <ForgotPasswordPage />} />
      <Route element={<RequireSession />}>
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={page(DashboardPage, ['dashboard.view'])} />
          <Route path="/cashier" element={page(CashierPage, ['pos.use'])} />
          <Route path="/products" element={page(ProductsPage, ['products.view'])} />
          <Route path="/inventory" element={page(InventoryPage, ['inventory.view'])} />
          <Route path="/users" element={page(UsersPage, ['users.manage'])} />
          <Route path="/sales" element={page(SalesPage, ['sales.view_all', 'sales.view_own'])} />
          <Route path="/expenses" element={page(ExpensesPage, ['expenses.view'])} />
          <Route path="/reports" element={page(ReportsPage, ['reports.view'])} />
          <Route path="/settings" element={page(SettingsPage)} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
