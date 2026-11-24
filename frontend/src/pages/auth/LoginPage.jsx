import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { firebaseErrorMessage } from '../../services/firebase'
import { AuthLayout } from '../../layouts/AuthLayout'
import { Button, Input, PasswordInput, Checkbox } from '../../components/ui'
import { EMAIL_RE } from '../../utils/validation'

export default function LoginPage() {
  const { login, setupStatus, authMessage, setAuthMessage } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [errors, setErrors] = useState({})
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  async function submit(e) {
    e.preventDefault()
    const errs = {}
    if (!EMAIL_RE.test(email.trim())) errs.email = 'Enter a valid email address.'
    if (!password) errs.password = 'Enter your password.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    setError(null)
    setAuthMessage(null)
    setLoading(true)
    try {
      await login(email.trim(), password, remember)
    } catch (err) {
      setError(firebaseErrorMessage(err))
      setLoading(false)
    }
  }

  const store = setupStatus?.store
  const message = error || authMessage
  return (
    <AuthLayout logoUrl={store?.logo_url} storeName={store?.store_name}>
      <h1 className="text-lg font-semibold text-slate-900">Welcome back</h1>
      <p className="mb-5 text-sm text-slate-500">Sign in to continue to your POS.</p>
      <form onSubmit={submit} noValidate className="space-y-3">
        <Input label="Email Address" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
        <PasswordInput label="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} />
        <div className="flex items-center justify-between">
          <Checkbox label="Remember session" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <Link to="/forgot-password" className="text-sm text-blue-600 hover:underline">Forgot password?</Link>
        </div>
        {message && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p>}
        <Button type="submit" className="w-full" loading={loading}>Sign In</Button>
      </form>
    </AuthLayout>
  )
}
