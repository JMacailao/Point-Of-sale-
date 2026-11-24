import { useState } from 'react'
import { UserPlus, Pencil, Power, Eye, Copy } from 'lucide-react'
import { sendPasswordResetEmail } from 'firebase/auth'
import { auth } from '../../services/firebase'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { useApi } from '../../hooks/useApi'
import { api } from '../../services/api'
import {
  Badge, Button, ConfirmDialog, EmptyState, ErrorState, IconButton, Input, Modal, PageHeader, PageLoader, Pagination, Select, TableWrap,
} from '../../components/ui'
import { formatDateTime } from '../../utils/format'
import { EMAIL_RE } from '../../utils/validation'

const ROLES = [['cashier', 'Cashier'], ['administrator', 'Administrator']]

function UserForm({ open, user, onClose, onSaved }) {
  const toast = useToast()
  const [form, setForm] = useState({ email: '', full_name: '', role: 'cashier' })
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [last, setLast] = useState(false)
  if (open !== last) {
    setLast(open)
    if (open) { setForm(user ? { email: user.email, full_name: user.full_name || '', role: user.role } : { email: '', full_name: '', role: 'cashier' }); setErrors({}) }
  }
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    const errs = {}
    if (!user && !EMAIL_RE.test(form.email.trim())) errs.email = 'Enter a valid email address.'
    if (!form.full_name.trim()) errs.full_name = 'Full name is required.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    setSaving(true)
    try {
      if (user) {
        const { data } = await api.put(`/users/${user.id}`, { full_name: form.full_name.trim(), role: form.role })
        toast.success('User updated')
        onSaved(data, null)
      } else {
        const { data } = await api.post('/users', { email: form.email.trim(), full_name: form.full_name.trim(), role: form.role })
        let emailed = false
        if (!data.existingAccount) {
          try { await sendPasswordResetEmail(auth, data.email); emailed = true } catch { emailed = false }
        }
        onSaved(data, { link: data.passwordSetupLink, emailed, existing: data.existingAccount, email: data.email })
      }
    } catch (err) { toast.error(err) } finally { setSaving(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title={user ? 'Edit User' : 'Create User'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="user-form" loading={saving}>{user ? 'Save' : 'Create User'}</Button></>}>
      <form id="user-form" onSubmit={submit} noValidate className="space-y-3">
        <Input label="Email Address" type="email" value={form.email} onChange={set('email')} error={errors.email} disabled={Boolean(user)} required />
        <Input label="Full Name" value={form.full_name} onChange={set('full_name')} error={errors.full_name} maxLength={120} required />
        <Select label="Role" value={form.role} onChange={set('role')} options={ROLES}
          hint={form.role === 'administrator' ? 'Administrators have full access, including users and settings.' : 'Cashiers can sell, print receipts and view their own sales.'} />
        {!user && <p className="text-xs text-slate-500">A sign-in account is created in Firebase Authentication. The user sets their own password using a secure link — no password is stored in the database.</p>}
      </form>
    </Modal>
  )
}

function UserDetail({ user, onClose }) {
  const { store, can } = useAuth()
  const [page, setPage] = useState(1)
  const activity = useApi(user ? `/users/${user.id}/activity` : null, { page, pageSize: 15 }, { enabled: Boolean(user) && can('audit.view') })
  if (!user) return null
  return (
    <Modal open onClose={onClose} title="User Details" size="lg">
      <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        <div><dt className="text-xs text-slate-500">Name</dt><dd className="font-medium">{user.full_name || '—'}</dd></div>
        <div><dt className="text-xs text-slate-500">Email</dt><dd className="break-all">{user.email}</dd></div>
        <div><dt className="text-xs text-slate-500">Role</dt><dd>{user.role_name}</dd></div>
        <div><dt className="text-xs text-slate-500">Status</dt><dd>{user.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="red">Inactive</Badge>}</dd></div>
        <div><dt className="text-xs text-slate-500">Member since</dt><dd>{formatDateTime(user.member_since, store)}</dd></div>
        <div><dt className="text-xs text-slate-500">Last login</dt><dd>{user.last_login_at ? formatDateTime(user.last_login_at, store) : 'Never'}</dd></div>
        <div><dt className="text-xs text-slate-500">Sales processed</dt><dd>{user.sales_count}</dd></div>
      </dl>
      <h3 className="mb-2 text-sm font-semibold">Activity</h3>
      {activity.error ? <ErrorState error={activity.error} /> : !activity.data ? <PageLoader /> : !activity.data.length ? <EmptyState title="No activity yet" /> : (
        <div className="rounded-md border border-slate-200">
          <TableWrap>
            <table className="table">
              <thead><tr><th>Date & Time</th><th>Action</th><th>Module</th><th className="hidden sm:table-cell">Details</th></tr></thead>
              <tbody>
                {activity.data.map((a) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap text-slate-600">{formatDateTime(a.created_at, store)}</td>
                    <td className="capitalize">{a.action.replace(/_/g, ' ')}</td>
                    <td className="capitalize">{a.module.replace(/_/g, ' ')}</td>
                    <td className="hidden max-w-72 truncate text-xs text-slate-500 sm:table-cell">{a.new_values ? Object.entries(a.new_values).filter(([k]) => !k.endsWith('_id') && k !== 'id').slice(0, 3).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ') : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <Pagination meta={activity.meta} onPage={setPage} />
        </div>
      )}
    </Modal>
  )
}

export default function UsersPage() {
  const { user: me, store } = useAuth()
  const toast = useToast()
  const list = useApi('/users')
  const [form, setForm] = useState({ open: false, user: null })
  const [detail, setDetail] = useState(null)
  const [statusTarget, setStatusTarget] = useState(null)
  const [setupInfo, setSetupInfo] = useState(null)
  const [busy, setBusy] = useState(false)

  async function toggleStatus() {
    setBusy(true)
    try {
      await api.put(`/users/${statusTarget.id}/status`, { is_active: !statusTarget.is_active })
      toast.success(statusTarget.is_active ? 'User deactivated and signed out' : 'User activated')
      setStatusTarget(null)
      list.reload()
    } catch (err) { toast.error(err) } finally { setBusy(false) }
  }

  return (
    <div>
      <PageHeader title="Users" description="Create staff accounts, assign roles and control access."
        actions={<Button icon={UserPlus} onClick={() => setForm({ open: true, user: null })}>Create User</Button>} />
      <div className="rounded-md border border-slate-200 bg-white">
        {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : !list.data ? <PageLoader /> : !list.data.length ? <EmptyState title="No users" /> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Name</th><th className="hidden sm:table-cell">Email</th><th>Role</th><th>Status</th><th className="hidden md:table-cell">Last login</th><th className="w-28"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {list.data.map((u) => {
                  const self = u.id === me.id
                  return (
                    <tr key={u.id}>
                      <td><p className="font-medium">{u.full_name || '—'} {self && <span className="text-xs font-normal text-slate-500">(you)</span>}</p><p className="text-xs text-slate-500 sm:hidden">{u.email}</p></td>
                      <td className="hidden text-slate-600 sm:table-cell">{u.email}</td>
                      <td>{u.role === 'administrator' ? <Badge tone="blue">Administrator</Badge> : <Badge>Cashier</Badge>}</td>
                      <td>{u.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="red">Inactive</Badge>}</td>
                      <td className="hidden text-xs text-slate-500 md:table-cell">{u.last_login_at ? formatDateTime(u.last_login_at, store) : 'Never'}</td>
                      <td className="whitespace-nowrap text-right">
                        <IconButton icon={Eye} label={`View ${u.email}`} onClick={() => setDetail(u)} />
                        <IconButton icon={Pencil} label={`Edit ${u.email}`} onClick={() => setForm({ open: true, user: u })} />
                        <IconButton icon={Power} label={u.is_active ? `Deactivate ${u.email}` : `Activate ${u.email}`} disabled={self}
                          className={u.is_active ? 'hover:text-red-600' : 'hover:text-emerald-600'} onClick={() => setStatusTarget(u)} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </div>

      <UserForm open={form.open} user={form.user} onClose={() => setForm({ open: false, user: null })}
        onSaved={(_, info) => { setForm({ open: false, user: null }); list.reload(); if (info) setSetupInfo(info) }} />
      <UserDetail user={detail} onClose={() => setDetail(null)} />
      <ConfirmDialog open={Boolean(statusTarget)} loading={busy} onClose={() => setStatusTarget(null)} onConfirm={toggleStatus}
        variant={statusTarget?.is_active ? 'danger' : 'success'}
        title={statusTarget?.is_active ? 'Deactivate user?' : 'Activate user?'} confirmLabel={statusTarget?.is_active ? 'Deactivate' : 'Activate'}
        message={statusTarget?.is_active ? `${statusTarget?.email} will be signed out immediately and will not be able to sign in.` : `${statusTarget?.email} will be able to sign in again.`} />

      <Modal open={Boolean(setupInfo)} onClose={() => setSetupInfo(null)} title="User created" size="md"
        footer={<Button onClick={() => setSetupInfo(null)}>Done</Button>}>
        {setupInfo?.existing ? (
          <p className="text-sm text-slate-600">{setupInfo.email} already had a verified sign-in account and was added to this store. They can sign in with their existing password.</p>
        ) : (
          <div className="space-y-3 text-sm text-slate-600">
            <p>{setupInfo?.emailed ? <>A password setup email was sent to <b>{setupInfo?.email}</b>.</> : <>The setup email could not be sent automatically.</>} You can also share this secure link with them directly:</p>
            {setupInfo?.link ? (
              <div className="flex gap-2">
                <input readOnly value={setupInfo.link} className="input text-xs" aria-label="Password setup link" onFocus={(e) => e.target.select()} />
                <Button variant="secondary" icon={Copy} onClick={async () => { await navigator.clipboard.writeText(setupInfo.link); toast.success('Link copied') }}>Copy</Button>
              </div>
            ) : <p className="text-xs">No link available — the user can use “Forgot password” on the sign-in page.</p>}
            <p className="text-xs text-slate-500">The link lets them choose their own password. Treat it like a password.</p>
          </div>
        )}
      </Modal>
    </div>
  )
}
