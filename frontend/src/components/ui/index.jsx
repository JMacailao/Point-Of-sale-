import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, X, Eye, EyeOff, ChevronLeft, ChevronRight, Inbox, ImagePlus, Trash2 } from 'lucide-react'

const BTN = {
  primary: 'bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300',
  secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:text-slate-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-300',
  ghost: 'text-slate-600 hover:bg-slate-100 disabled:text-slate-300',
  link: 'text-blue-600 hover:underline px-0 py-0',
}
const SIZE = { sm: 'h-8 px-2.5 text-xs', md: 'h-9 px-3 text-sm', lg: 'h-11 px-4 text-base' }

export function Button({ variant = 'primary', size = 'md', loading, icon: Icon, className = '', children, disabled, ...props }) {
  return (
    <button disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed ${BTN[variant]} ${variant === 'link' ? '' : SIZE[size]} ${className}`}
      {...props}>
      {loading ? <Loader2 className="size-4 animate-spin" /> : Icon ? <Icon className="size-4" /> : null}
      {children}
    </button>
  )
}

export function IconButton({ icon: Icon, label, className = '', ...props }) {
  return (
    <button type="button" title={label} aria-label={label}
      className={`inline-flex size-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-40 ${className}`} {...props}>
      <Icon className="size-4" />
    </button>
  )
}

export function Spinner({ className = '' }) {
  return <Loader2 className={`size-5 animate-spin text-slate-400 ${className}`} />
}

export function PageLoader({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
      <Spinner /> {label}
    </div>
  )
}

export function Field({ label, error, hint, children, required, className = '' }) {
  return (
    <div className={className}>
      {label && <span className="label">{label}{required && <span className="text-red-600"> *</span>}</span>}
      {children}
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  )
}

export function Input({ label, error, hint, required, className = '', inputClassName = '', ...props }) {
  const id = useId()
  return (
    <Field label={label && <label htmlFor={id}>{label}</label>} error={error} hint={hint} required={required} className={className}>
      <input id={id} aria-invalid={Boolean(error)} className={`input ${error ? 'input-error' : ''} ${inputClassName}`} {...props} />
    </Field>
  )
}

export function Textarea({ label, error, hint, className = '', ...props }) {
  const id = useId()
  return (
    <Field label={label && <label htmlFor={id}>{label}</label>} error={error} hint={hint} className={className}>
      <textarea id={id} rows={3} className={`input ${error ? 'input-error' : ''}`} {...props} />
    </Field>
  )
}

export function Select({ label, error, hint, required, options = [], className = '', placeholder, ...props }) {
  const id = useId()
  return (
    <Field label={label && <label htmlFor={id}>{label}</label>} error={error} hint={hint} required={required} className={className}>
      <select id={id} className={`input pr-8 ${error ? 'input-error' : ''}`} {...props}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
      </select>
    </Field>
  )
}

export function PasswordInput({ label, error, hint, className = '', ...props }) {
  const [show, setShow] = useState(false)
  const id = useId()
  return (
    <Field label={label && <label htmlFor={id}>{label}</label>} error={error} hint={hint} className={className}>
      <div className="relative">
        <input id={id} type={show ? 'text' : 'password'} className={`input pr-9 ${error ? 'input-error' : ''}`} {...props} />
        <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}
          className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-slate-400 hover:text-slate-600">
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    </Field>
  )
}

export function Checkbox({ label, hint, className = '', ...props }) {
  return (
    <label className={`flex items-start gap-2 text-sm text-slate-700 ${className}`}>
      <input type="checkbox" className="mt-0.5 size-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600" {...props} />
      <span>{label}{hint && <span className="block text-xs text-slate-500">{hint}</span>}</span>
    </label>
  )
}

export function Badge({ tone = 'slate', children }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700', green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    red: 'bg-red-50 text-red-700 ring-red-600/20', amber: 'bg-amber-50 text-amber-800 ring-amber-600/20',
    blue: 'bg-blue-50 text-blue-700 ring-blue-600/20',
  }
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ring-transparent ${tones[tone]}`}>{children}</span>
}

export function Modal({ open, onClose, title, children, footer, size = 'md', dismissible = true }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const prev = document.activeElement
    const onKey = (e) => { if (e.key === 'Escape' && dismissible) onClose?.() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    setTimeout(() => ref.current?.querySelector('input,select,textarea,button:not([data-close])')?.focus(), 30)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      prev?.focus?.()
    }
  }, [open, onClose, dismissible])
  if (!open) return null
  const widths = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' }
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-slate-900/40" onClick={() => dismissible && onClose?.()} />
      <div ref={ref} className={`relative flex max-h-[92dvh] w-full flex-col rounded-t-lg bg-white shadow-xl sm:rounded-lg ${widths[size]}`}>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {dismissible && <IconButton data-close icon={X} label="Close" onClick={onClose} />}
        </div>
        <div className="overflow-y-auto px-4 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-4 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', variant = 'danger', loading, onConfirm, onClose, children }) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm"
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
        <Button variant={variant} onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
      </>}>
      {message && <p className="text-sm text-slate-600">{message}</p>}
      {children}
    </Modal>
  )
}

export function EmptyState({ icon: Icon = Inbox, title, message, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
      <Icon className="mb-2 size-8 text-slate-300" />
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {message && <p className="mt-1 max-w-sm text-sm text-slate-500">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center text-sm">
      <p className="text-red-600">{error?.message || 'Failed to load data.'}</p>
      {onRetry && <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button>}
    </div>
  )
}

export function Pagination({ meta, onPage }) {
  if (!meta || meta.total === 0) return null
  const from = (meta.page - 1) * meta.pageSize + 1
  const to = Math.min(meta.total, meta.page * meta.pageSize)
  return (
    <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-3 py-2 text-xs text-slate-600">
      <span>{from}–{to} of {meta.total}</span>
      <div className="flex items-center gap-1">
        <IconButton icon={ChevronLeft} label="Previous page" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)} />
        <span className="px-1">Page {meta.page} of {meta.totalPages}</span>
        <IconButton icon={ChevronRight} label="Next page" disabled={meta.page >= meta.totalPages} onClick={() => onPage(meta.page + 1)} />
      </div>
    </div>
  )
}

export function PageHeader({ title, description, actions }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
        {description && <p className="text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Panel({ title, actions, children, className = '', bodyClassName = '' }) {
  return (
    <section className={`rounded-md border border-slate-200 bg-white ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          {actions}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  )
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
      {tabs.map(([key, label]) => (
        <button key={key} role="tab" aria-selected={value === key} onClick={() => onChange(key)}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap ${value === key
            ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
          {label}
        </button>
      ))}
    </div>
  )
}

export function ImagePicker({ label, value, onChange, onRemove, hint }) {
  const inputRef = useRef(null)
  const [preview, setPreview] = useState(null)
  useEffect(() => {
    if (value instanceof File) {
      const url = URL.createObjectURL(value)
      setPreview(url)
      return () => URL.revokeObjectURL(url)
    }
    setPreview(typeof value === 'string' ? value : null)
    return undefined
  }, [value])
  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-3">
        <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-50">
          {preview ? <img src={preview} alt="" className="size-full object-contain" /> : <ImagePlus className="size-5 text-slate-300" />}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => inputRef.current?.click()}>
            {preview ? 'Change image' : 'Upload image'}
          </Button>
          {preview && <Button type="button" variant="ghost" size="sm" icon={Trash2} onClick={() => { onRemove?.(); if (inputRef.current) inputRef.current.value = '' }}>Remove</Button>}
        </div>
        <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onChange(f) }} />
      </div>
    </Field>
  )
}

export function Stat({ label, value, sub, tone }) {
  return (
    <div className="min-w-0 bg-white px-4 py-3">
      <p className="truncate text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-0.5 truncate text-lg font-semibold tabular-nums ${tone === 'red' ? 'text-red-600' : tone === 'green' ? 'text-emerald-700' : 'text-slate-900'}`}>{value}</p>
      {sub && <p className="truncate text-xs text-slate-500">{sub}</p>}
    </div>
  )
}

export function StatRow({ children, cols = 4 }) {
  const grid = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-4', 5: 'sm:grid-cols-5' }[cols]
  return (
    <div className={`mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-slate-200 bg-slate-200 ${grid}`}>
      {children}
    </div>
  )
}

/** Horizontally scrollable table wrapper for small screens. */
export function TableWrap({ children }) {
  return <div className="overflow-x-auto">{children}</div>
}
