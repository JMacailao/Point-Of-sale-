import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { api, ApiError } from '../../services/api'
import { firebaseErrorMessage } from '../../services/firebase'
import { AuthLayout, StepIndicator } from '../../layouts/AuthLayout'
import { Button, Input, PasswordInput, Select, Textarea, ImagePicker } from '../../components/ui'
import { EMAIL_RE, passwordProblems } from '../../utils/validation'
import { BUSINESS_TYPES, TIMEZONES } from '../../utils/format'

// ----------------------------------------------------------------- STEP 1
export function AdminStep() {
  const { login, refreshSetupStatus } = useAuth()
  const [form, setForm] = useState({ email: '', password: '', confirm: '' })
  const [errors, setErrors] = useState({})
  const [submitError, setSubmitError] = useState(null)
  const [loading, setLoading] = useState(false)

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  function validate() {
    const e = {}
    if (!EMAIL_RE.test(form.email.trim())) e.email = 'Enter a valid email address.'
    const problems = passwordProblems(form.password)
    if (problems.length) e.password = `Password needs ${problems.join(', ')}.`
    if (!form.confirm) e.confirm = 'Confirm your password.'
    else if (form.confirm !== form.password) e.confirm = 'Passwords do not match.'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function submit(e) {
    e.preventDefault()
    setSubmitError(null)
    if (!validate()) return
    setLoading(true)
    const email = form.email.trim().toLowerCase()
    try {
      await api.publicPost('/setup/initialize-admin', { email, password: form.password })
    } catch (err) {
      setLoading(false)
      if (err instanceof ApiError && err.code === 'SETUP_ALREADY_CLAIMED') {
        await refreshSetupStatus()
        return
      }
      setSubmitError(err.message)
      return
    }
    try {
      await refreshSetupStatus()
      await login(email, form.password, true)
      // AuthContext loads the session; the router then shows the store step.
    } catch (err) {
      setLoading(false)
      setSubmitError(firebaseErrorMessage(err))
    }
  }

  return (
    <AuthLayout>
      <StepIndicator step={1} />
      <h1 className="text-lg font-semibold text-slate-900">Welcome! Let&apos;s set up your POS.</h1>
      <p className="mb-5 text-sm text-slate-500">Create your administrator account to get started.</p>
      <form onSubmit={submit} noValidate className="space-y-3">
        <Input label="Email Address" type="email" autoComplete="email" value={form.email} onChange={set('email')} error={errors.email} required />
        <PasswordInput label="Password" autoComplete="new-password" value={form.password} onChange={set('password')} error={errors.password}
          hint="At least 8 characters with uppercase, lowercase and a number." />
        <PasswordInput label="Confirm Password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} error={errors.confirm} />
        {submitError && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{submitError}</p>}
        <Button type="submit" className="w-full" loading={loading}>Create Administrator Account</Button>
      </form>
    </AuthLayout>
  )
}

// ----------------------------------------------------------------- STEP 2
export function StoreStep() {
  const { applySession, refreshSetupStatus, user, logout } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({
    store_name: '', store_address: '', contact_number: '', business_email: '', business_type: '',
    timezone: 'Asia/Manila', date_format: 'DD/MM/YYYY', receipt_footer: 'Thank you for your purchase!',
  })
  const [logo, setLogo] = useState(null)
  const [errors, setErrors] = useState({})
  const [submitError, setSubmitError] = useState(null)
  const [loading, setLoading] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    const errs = {}
    if (!form.store_name.trim()) errs.store_name = 'Store name is required.'
    if (form.business_email && !EMAIL_RE.test(form.business_email.trim())) errs.business_email = 'Enter a valid email address.'
    if (logo && logo.size > 2 * 1024 * 1024) errs.logo = 'Logo must be 2 MB or smaller.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    setSubmitError(null)
    setLoading(true)
    try {
      const fd = new FormData()
      Object.entries({ ...form, currency: 'PHP' }).forEach(([k, v]) => fd.set(k, v))
      if (logo) fd.set('logo', logo)
      const { data } = await api.post('/setup/store', fd)
      applySession(data)
      await refreshSetupStatus()
      navigate('/welcome', { replace: true })
    } catch (err) {
      setSubmitError(err.message)
      setLoading(false)
    }
  }

  return (
    <AuthLayout wide>
      <StepIndicator step={2} />
      <h1 className="text-lg font-semibold text-slate-900">Set Up Your Store</h1>
      <p className="mb-5 text-sm text-slate-500">Tell us a little about your business.</p>
      <form onSubmit={submit} noValidate className="space-y-3">
        <Input label="Store Name" required value={form.store_name} onChange={set('store_name')} error={errors.store_name} maxLength={120} />
        <Input label="Store Address" value={form.store_address} onChange={set('store_address')} maxLength={300} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Contact Number" type="tel" value={form.contact_number} onChange={set('contact_number')} maxLength={40} />
          <Input label="Business Email" type="email" value={form.business_email} onChange={set('business_email')} error={errors.business_email} />
        </div>
        <Select label="Business Type" value={form.business_type} onChange={set('business_type')} placeholder="Select…" options={BUSINESS_TYPES} />
        <ImagePicker label="Store Logo" value={logo} onChange={setLogo} onRemove={() => setLogo(null)} hint={errors.logo || 'PNG, JPEG or WebP, up to 2 MB.'} />

        <fieldset className="rounded-md border border-slate-200 p-3">
          <legend className="px-1 text-xs font-medium text-slate-600">Additional settings</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            <Select label="Currency" value="PHP" disabled options={[['PHP', 'Philippine Peso (₱)']]} />
            <Select label="Time Zone" value={form.timezone} onChange={set('timezone')} options={TIMEZONES.map((t) => [t, t])} />
            <Select label="Date Format" value={form.date_format} onChange={set('date_format')}
              options={[['DD/MM/YYYY', 'DD/MM/YYYY'], ['MM/DD/YYYY', 'MM/DD/YYYY'], ['YYYY-MM-DD', 'YYYY-MM-DD']]} />
          </div>
          <Textarea className="mt-3" label="Receipt Footer Message" value={form.receipt_footer} onChange={set('receipt_footer')} maxLength={300} />
        </fieldset>

        {submitError && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{submitError}</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500">Signed in as {user?.email} · <button type="button" className="text-blue-600 hover:underline" onClick={logout}>Sign out</button></p>
          <Button type="submit" loading={loading}>Complete Store Setup</Button>
        </div>
      </form>
    </AuthLayout>
  )
}

// ----------------------------------------------------------------- STEP 3
export function WelcomeStep() {
  const { store, user } = useAuth()
  const navigate = useNavigate()
  return (
    <AuthLayout logoUrl={store?.logo_url} storeName={store?.store_name}>
      <StepIndicator step={3} />
      <div className="text-center">
        <CheckCircle2 className="mx-auto mb-3 size-10 text-emerald-600" />
        {store?.logo_url && <img src={store.logo_url} alt={`${store.store_name} logo`} className="mx-auto mb-3 size-16 rounded-md border border-slate-200 object-contain" />}
        <h1 className="text-lg font-semibold text-slate-900">Your store is ready!</h1>
        <p className="mt-1 text-sm font-medium text-slate-700">{store?.store_name}</p>
        <p className="mt-3 text-sm text-slate-500">You can now manage your products, inventory, sales, and business operations.</p>
        <dl className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-left text-xs text-slate-600">
          <div className="flex justify-between py-0.5"><dt>Administrator</dt><dd className="font-medium text-slate-800">{user?.email}</dd></div>
          <div className="flex justify-between py-0.5"><dt>Currency</dt><dd>Philippine Peso (₱)</dd></div>
          <div className="flex justify-between py-0.5"><dt>Time zone</dt><dd>{store?.timezone}</dd></div>
          <div className="flex justify-between py-0.5"><dt>Date format</dt><dd>{store?.date_format}</dd></div>
        </dl>
        <Button className="mt-5 w-full" onClick={() => navigate('/dashboard', { replace: true })}>Go to Dashboard</Button>
      </div>
    </AuthLayout>
  )
}
