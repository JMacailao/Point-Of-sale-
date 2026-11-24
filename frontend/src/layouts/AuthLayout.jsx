import { Store } from 'lucide-react'

export function AuthLayout({ children, wide = false, logoUrl, storeName }) {
  return (
    <div className="flex min-h-dvh flex-col bg-slate-50">
      <div className="flex flex-1 items-start justify-center px-4 py-8 sm:items-center">
        <div className={`w-full ${wide ? 'max-w-xl' : 'max-w-sm'}`}>
          <div className="mb-5 flex items-center justify-center gap-2.5">
            {logoUrl
              ? <img src={logoUrl} alt="" className="size-10 rounded-md border border-slate-200 bg-white object-contain" />
              : <div className="flex size-10 items-center justify-center rounded-md bg-blue-600 text-white"><Store className="size-5" /></div>}
            <span className="text-base font-semibold text-slate-900">{storeName || 'Point of Sale'}</span>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6">{children}</div>
        </div>
      </div>
    </div>
  )
}

export function StepIndicator({ step }) {
  const steps = ['Administrator', 'Store', 'Done']
  return (
    <ol className="mb-5 flex items-center gap-2 text-xs">
      {steps.map((label, i) => (
        <li key={label} className="flex flex-1 items-center gap-2">
          <span className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
            i + 1 < step ? 'bg-emerald-600 text-white' : i + 1 === step ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-500'}`}>{i + 1}</span>
          <span className={i + 1 === step ? 'font-medium text-slate-900' : 'text-slate-500'}>{label}</span>
          {i < steps.length - 1 && <span className="h-px flex-1 bg-slate-200" />}
        </li>
      ))}
    </ol>
  )
}
