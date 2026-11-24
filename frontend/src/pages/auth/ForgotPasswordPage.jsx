import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { firebaseErrorMessage } from '../../services/firebase'
import { AuthLayout } from '../../layouts/AuthLayout'
import { Button, Input } from '../../components/ui'
import { EMAIL_RE } from '../../utils/validation'

export default function ForgotPasswordPage() {
  const { resetPassword, setupStatus } = useAuth()
  const [email, setEmail] = useState('')
  const [error, setError] = useState(null)
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (!EMAIL_RE.test(email.trim())) return setError('Enter a valid email address.')
    setError(null)
    setLoading(true)
    try {
      await resetPassword(email.trim())
      setSent(true)
    } catch (err) {
      // Do not reveal whether an account exists.
      if (err?.code === 'auth/user-not-found') setSent(true)
      else setError(firebaseErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout logoUrl={setupStatus?.store?.logo_url} storeName={setupStatus?.store?.store_name}>
      <h1 className="text-lg font-semibold text-slate-900">Reset your password</h1>
      {sent ? (
        <>
          <p className="mt-2 text-sm text-slate-600">If an account exists for <b>{email}</b>, a password reset link has been sent. Check your inbox and spam folder.</p>
          <Link to="/login" className="mt-5 inline-block text-sm text-blue-600 hover:underline">Back to sign in</Link>
        </>
      ) : (
        <form onSubmit={submit} noValidate className="mt-4 space-y-3">
          <p className="text-sm text-slate-500">Enter your email address and we&apos;ll send you a link to reset your password.</p>
          <Input label="Email Address" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={error} />
          <Button type="submit" className="w-full" loading={loading}>Send reset link</Button>
          <Link to="/login" className="block text-center text-sm text-blue-600 hover:underline">Back to sign in</Link>
        </form>
      )}
    </AuthLayout>
  )
}
