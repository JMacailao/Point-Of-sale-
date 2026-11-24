import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'

const ToastContext = createContext(null)

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), [])
  const push = useCallback((type, message) => {
    const id = Math.random().toString(36).slice(2)
    setToasts((t) => [...t.slice(-3), { id, type, message }])
    setTimeout(() => dismiss(id), type === 'error' ? 6000 : 3500)
  }, [dismiss])

  const value = useMemo(() => ({
    success: (m) => push('success', m),
    error: (m) => push('error', m?.message || m),
    info: (m) => push('info', m),
  }), [push])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-4" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} role={t.type === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-md border bg-white px-3 py-2.5 text-sm shadow-lg ${
              t.type === 'error' ? 'border-red-200' : t.type === 'success' ? 'border-emerald-200' : 'border-slate-200'}`}>
            {t.type === 'success' && <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />}
            {t.type === 'error' && <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-600" />}
            {t.type === 'info' && <Info className="mt-0.5 size-4 shrink-0 text-blue-600" />}
            <p className="flex-1 text-slate-800">{t.message}</p>
            <button onClick={() => dismiss(t.id)} className="text-slate-400 hover:text-slate-600" aria-label="Dismiss">
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}
