import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Check, ShieldCheck } from 'lucide-react'
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth'
import { auth, firebaseErrorMessage } from '../../services/firebase'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { useApi } from '../../hooks/useApi'
import { api } from '../../services/api'
import {
  Button, Checkbox, EmptyState, ErrorState, ImagePicker, Input, PageHeader, PageLoader, Pagination, Panel, PasswordInput,
  Select, Tabs, Textarea, TableWrap,
} from '../../components/ui'
import { BUSINESS_TYPES, formatDateTime, TIMEZONES } from '../../utils/format'
import { EMAIL_RE, passwordProblems } from '../../utils/validation'

function useStoreForm(fields) {
  const { store } = useAuth()
  const [form, setForm] = useState(() => Object.fromEntries(fields.map((k) => [k, store[k] ?? ''])))
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  return [form, set, setForm]
}

function useSaveStore() {
  const { session, applySession } = useAuth()
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  async function save(body) {
    setSaving(true)
    try {
      const { data } = await api.put('/settings/store', body)
      applySession({ ...session, store: data })
      toast.success('Settings saved')
      return true
    } catch (err) { toast.error(err); return false } finally { setSaving(false) }
  }
  return [save, saving]
}

function StoreInfo() {
  const { store } = useAuth()
  const [form, set] = useStoreForm(['store_name', 'store_address', 'contact_number', 'business_email', 'business_type'])
  const [logo, setLogo] = useState(store.logo_url)
  const [removeLogo, setRemoveLogo] = useState(false)
  const [errors, setErrors] = useState({})
  const [save, saving] = useSaveStore()
  async function submit(e) {
    e.preventDefault()
    const errs = {}
    if (!form.store_name.trim()) errs.store_name = 'Store name is required.'
    if (form.business_email && !EMAIL_RE.test(form.business_email)) errs.business_email = 'Enter a valid email address.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    const fd = new FormData()
    Object.entries(form).forEach(([k, v]) => fd.set(k, v ?? ''))
    if (logo instanceof File) fd.set('logo', logo)
    else if (removeLogo) fd.set('remove_logo', 'true')
    if (await save(fd)) setRemoveLogo(false)
  }
  return (
    <Panel title="Store Information" bodyClassName="p-4">
      <form onSubmit={submit} noValidate className="grid max-w-2xl gap-3 sm:grid-cols-2">
        <Input className="sm:col-span-2" label="Store Name" required value={form.store_name} onChange={set('store_name')} error={errors.store_name} maxLength={120} />
        <Input className="sm:col-span-2" label="Store Address" value={form.store_address} onChange={set('store_address')} maxLength={300} />
        <Input label="Contact Number" value={form.contact_number} onChange={set('contact_number')} maxLength={40} />
        <Input label="Business Email" type="email" value={form.business_email} onChange={set('business_email')} error={errors.business_email} />
        <Select label="Business Type" value={form.business_type} onChange={set('business_type')} placeholder="Select…" options={BUSINESS_TYPES} />
        <div className="sm:col-span-2">
          <ImagePicker label="Store Logo" value={logo} hint="Shown on the sign-in page and receipts. PNG, JPEG or WebP up to 2 MB."
            onChange={(f) => { setLogo(f); setRemoveLogo(false) }} onRemove={() => { setLogo(null); setRemoveLogo(true) }} />
        </div>
        <div className="sm:col-span-2"><Button type="submit" loading={saving}>Save Store Information</Button></div>
      </form>
    </Panel>
  )
}

function BusinessSettings() {
  const [form, set] = useStoreForm(['timezone', 'date_format', 'receipt_footer', 'receipt_paper', 'tax_enabled', 'tax_name', 'tax_rate',
    'tax_inclusive', 'allow_cashier_discount', 'max_discount_percent'])
  const [save, saving] = useSaveStore()
  async function submit(e) {
    e.preventDefault()
    await save({ ...form, tax_rate: Number(form.tax_rate), max_discount_percent: Number(form.max_discount_percent), tax_inclusive: form.tax_inclusive === true || form.tax_inclusive === 'true' })
  }
  return (
    <form onSubmit={submit} noValidate className="max-w-2xl space-y-4">
      <Panel title="Regional & Receipt" bodyClassName="grid gap-3 p-4 sm:grid-cols-2">
        <Select label="Currency" value="PHP" disabled options={[['PHP', 'Philippine Peso (₱)']]} />
        <Select label="Time Zone" value={form.timezone} onChange={set('timezone')} options={TIMEZONES.map((t) => [t, t])} />
        <Select label="Date Format" value={form.date_format} onChange={set('date_format')} options={[['DD/MM/YYYY', 'DD/MM/YYYY'], ['MM/DD/YYYY', 'MM/DD/YYYY'], ['YYYY-MM-DD', 'YYYY-MM-DD']]} />
        <Select label="Receipt Paper" value={form.receipt_paper} onChange={set('receipt_paper')} options={[['58mm', '58mm thermal'], ['80mm', '80mm thermal'], ['a4', 'A4 / Letter (standard printer)']]} />
        <Textarea className="sm:col-span-2" label="Receipt Footer" value={form.receipt_footer} onChange={set('receipt_footer')} maxLength={300} />
      </Panel>
      <Panel title="Tax Settings" bodyClassName="grid gap-3 p-4 sm:grid-cols-3">
        <Checkbox className="sm:col-span-3" label="Apply tax to sales" checked={Boolean(form.tax_enabled)} onChange={set('tax_enabled')} />
        <Input label="Tax name" value={form.tax_name} onChange={set('tax_name')} maxLength={20} disabled={!form.tax_enabled} />
        <Input label="Tax rate (%)" type="number" min={0} max={100} step="0.01" value={form.tax_rate} onChange={set('tax_rate')} disabled={!form.tax_enabled} />
        <Select label="Prices are" value={String(form.tax_inclusive)} onChange={set('tax_inclusive')} disabled={!form.tax_enabled}
          options={[['true', 'Tax inclusive'], ['false', 'Tax exclusive (added at checkout)']]} />
      </Panel>
      <Panel title="Default Discount Settings" bodyClassName="grid gap-3 p-4 sm:grid-cols-2">
        <Checkbox className="sm:col-span-2" label="Allow cashiers to apply discounts" hint="Administrators can always apply discounts." checked={Boolean(form.allow_cashier_discount)} onChange={set('allow_cashier_discount')} />
        <Input label="Maximum cashier discount (%)" type="number" min={0} max={100} step="0.01" value={form.max_discount_percent} onChange={set('max_discount_percent')} disabled={!form.allow_cashier_discount} />
      </Panel>
      <Button type="submit" loading={saving}>Save Business Settings</Button>
    </form>
  )
}

function InventorySettings() {
  const [form, set] = useStoreForm(['default_low_stock_threshold', 'low_stock_alerts'])
  const [save, saving] = useSaveStore()
  return (
    <form onSubmit={async (e) => { e.preventDefault(); await save({ ...form, default_low_stock_threshold: Number(form.default_low_stock_threshold) }) }}
      noValidate className="max-w-2xl space-y-4">
      <Panel title="Inventory Settings" bodyClassName="space-y-3 p-4">
        <Input className="max-w-xs" label="Default low stock threshold" type="number" min={0} value={form.default_low_stock_threshold}
          onChange={set('default_low_stock_threshold')} hint="Used as the minimum stock for new products." />
        <Checkbox label="Show low stock warnings" hint="Alerts on the dashboard when products reach their minimum stock." checked={Boolean(form.low_stock_alerts)} onChange={set('low_stock_alerts')} />
        <div className="flex items-start gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
          <p><b>Negative stock prevention is always enforced.</b> Sales and stock-outs that exceed available stock are rejected by the database, and every stock change is recorded as a movement.</p>
        </div>
      </Panel>
      <Button type="submit" loading={saving}>Save Inventory Settings</Button>
    </form>
  )
}

function RolesSettings() {
  const { data, error, reload } = useApi('/roles')
  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!data) return <PageLoader />
  return (
    <div className="space-y-4">
      <Panel title="User Management" bodyClassName="p-4 text-sm text-slate-600">
        Create users, assign roles and activate or deactivate accounts in the <Link to="/users" className="font-medium text-blue-600 hover:underline">Users module</Link>.
      </Panel>
      <Panel title="Roles & Permissions">
        <TableWrap>
          <table className="table">
            <thead><tr><th>Permission</th>{data.roles.map((r) => <th key={r.key} className="text-center">{r.name}</th>)}</tr></thead>
            <tbody>
              {data.permissions.map((p) => (
                <tr key={p.permission_key}>
                  <td><p>{p.description}</p><p className="text-xs text-slate-400">{p.permission_key}</p></td>
                  {data.roles.map((r) => (
                    <td key={r.key} className="text-center">{r.permissions.includes(p.permission_key) ? <Check className="mx-auto size-4 text-emerald-600" aria-label="Allowed" /> : <span className="text-slate-300" aria-label="Not allowed">—</span>}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        <p className="border-t border-slate-200 px-3 py-2 text-xs text-slate-500">Permissions are enforced by the API and by database row-level security. Users cannot change their own role or status.</p>
      </Panel>
    </div>
  )
}

function ProfileSettings() {
  const { user, session, applySession } = useAuth()
  const toast = useToast()
  const [name, setName] = useState(user.fullName || '')
  const [savingName, setSavingName] = useState(false)
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' })
  const [pwErrors, setPwErrors] = useState({})
  const [savingPw, setSavingPw] = useState(false)

  async function saveName(e) {
    e.preventDefault()
    if (!name.trim()) return toast.error('Enter your name')
    setSavingName(true)
    try {
      await api.put('/auth/profile', { full_name: name.trim() })
      applySession({ ...session, user: { ...session.user, fullName: name.trim() } })
      toast.success('Profile updated')
    } catch (err) { toast.error(err) } finally { setSavingName(false) }
  }

  async function changePassword(e) {
    e.preventDefault()
    const errs = {}
    if (!pw.current) errs.current = 'Enter your current password.'
    const problems = passwordProblems(pw.next)
    if (problems.length) errs.next = `Password needs ${problems.join(', ')}.`
    if (pw.confirm !== pw.next) errs.confirm = 'Passwords do not match.'
    setPwErrors(errs)
    if (Object.keys(errs).length) return
    setSavingPw(true)
    try {
      const cred = EmailAuthProvider.credential(auth.currentUser.email, pw.current)
      await reauthenticateWithCredential(auth.currentUser, cred)
      await updatePassword(auth.currentUser, pw.next)
      setPw({ current: '', next: '', confirm: '' })
      toast.success('Password changed')
    } catch (err) {
      if (['auth/invalid-credential', 'auth/wrong-password', 'auth/invalid-login-credentials'].includes(err?.code)) setPwErrors({ current: 'Current password is incorrect.' })
      else toast.error(firebaseErrorMessage(err))
    } finally { setSavingPw(false) }
  }

  return (
    <div className="grid max-w-3xl gap-4 md:grid-cols-2">
      <Panel title="My Profile" bodyClassName="p-4">
        <form onSubmit={saveName} className="space-y-3">
          <Input label="Email" value={user.email} disabled />
          <Input label="Role" value={session.role?.name || ''} disabled />
          <Input label="Full Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          <Button type="submit" loading={savingName}>Save Profile</Button>
        </form>
      </Panel>
      <Panel title="Change Password" bodyClassName="p-4">
        <form onSubmit={changePassword} noValidate className="space-y-3">
          <PasswordInput label="Current password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} error={pwErrors.current} />
          <PasswordInput label="New password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} error={pwErrors.next} />
          <PasswordInput label="Confirm new password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} error={pwErrors.confirm} />
          <Button type="submit" loading={savingPw}>Change Password</Button>
        </form>
      </Panel>
    </div>
  )
}

function AuditLog() {
  const { store } = useAuth()
  const [module, setModule] = useState('')
  const [page, setPage] = useState(1)
  const { data, meta, error, reload } = useApi('/settings/audit-logs', { module, page, pageSize: 25 })
  return (
    <Panel title="Audit Log" actions={
      <select className="input h-8 w-auto" value={module} onChange={(e) => { setModule(e.target.value); setPage(1) }} aria-label="Module">
        <option value="">All modules</option>
        {['auth', 'sales', 'products', 'categories', 'expenses', 'store_members', 'stores', 'profiles'].map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
      </select>}>
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <PageLoader /> : !data.length ? <EmptyState title="No audit entries" /> : (
        <TableWrap>
          <table className="table">
            <thead><tr><th>Date & Time</th><th>User</th><th>Action</th><th>Module</th><th className="hidden md:table-cell">Changes</th></tr></thead>
            <tbody>
              {data.map((a) => (
                <tr key={a.id}>
                  <td className="whitespace-nowrap text-slate-600">{formatDateTime(a.created_at, store)}</td>
                  <td>{a.user_name || 'System'}</td>
                  <td className="capitalize">{a.action.replace(/_/g, ' ')}</td>
                  <td className="capitalize">{a.module.replace(/_/g, ' ')}</td>
                  <td className="hidden max-w-md truncate text-xs text-slate-500 md:table-cell" title={JSON.stringify(a.new_values)}>
                    {a.new_values ? Object.entries(a.new_values).filter(([k]) => !['id', 'store_id', 'created_at', 'updated_at'].includes(k)).slice(0, 4)
                      .map(([k, v]) => `${k}: ${typeof v === 'object' && v !== null ? JSON.stringify(v) : v}`).join(', ') : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      <Pagination meta={meta} onPage={setPage} />
    </Panel>
  )
}

export default function SettingsPage() {
  const { can } = useAuth()
  const [params, setParams] = useSearchParams()
  const admin = can('settings.manage')
  const tabs = [
    ...(admin ? [['store', 'Store Information'], ['business', 'Business'], ['inventory', 'Inventory']] : []),
    ...(can('users.manage') ? [['roles', 'Users & Roles']] : []),
    ['profile', 'My Profile'],
    ...(can('audit.view') ? [['audit', 'Audit Log']] : []),
  ]
  const requested = params.get('tab')
  const tab = tabs.some(([k]) => k === requested) ? requested : tabs[0][0]
  return (
    <div>
      <PageHeader title="Settings" />
      <Tabs tabs={tabs} value={tab} onChange={(t) => setParams({ tab: t })} />
      {tab === 'store' && <StoreInfo />}
      {tab === 'business' && <BusinessSettings />}
      {tab === 'inventory' && <InventorySettings />}
      {tab === 'roles' && <RolesSettings />}
      {tab === 'profile' && <ProfileSettings />}
      {tab === 'audit' && <AuditLog />}
    </div>
  )
}
