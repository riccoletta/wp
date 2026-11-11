import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes } from 'react'
import { useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'

export function Button({
  variant = 'primary', className = '', ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const styles = {
    primary: 'bg-acqua-600 text-white hover:bg-acqua-700',
    ghost: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50',
    danger: 'bg-white text-red-700 border border-red-300 hover:bg-red-50',
  }[variant]
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium
        transition disabled:cursor-not-allowed disabled:opacity-50
        focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acqua-600 ${styles} ${className}`}
    />
  )
}

const fieldStyles = `w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900
  focus:border-acqua-600 focus:outline-2 focus:outline-offset-0 focus:outline-acqua-600 disabled:bg-slate-100`

export function Field({ label, error, children, hint }: {
  label: string; error?: string; hint?: string; children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-700">{error}</span>}
    </label>
  )
}

export const Input = (props: InputHTMLAttributes<HTMLInputElement>) => (
  <input {...props} className={`${fieldStyles} ${props.className ?? ''}`} />
)

export const Select = (props: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select {...props} className={`${fieldStyles} ${props.className ?? ''}`} />
)

export function Card({ title, actions, children, className = '' }: {
  title?: string; actions?: ReactNode; children: ReactNode; className?: string
}) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          {title && <h2 className="text-sm font-semibold text-slate-800">{title}</h2>}
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  )
}

const badgeTones: Record<string, string> = {
  neutral: 'bg-slate-100 text-slate-700',
  ok: 'bg-emerald-100 text-emerald-800',
  warn: 'bg-amber-100 text-amber-900',
  danger: 'bg-red-100 text-red-800',
  info: 'bg-acqua-100 text-acqua-700',
}

export const Badge = ({ tone = 'neutral', children }: { tone?: keyof typeof badgeTones; children: ReactNode }) => (
  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${badgeTones[tone]}`}>{children}</span>
)

export const Spinner = () => (
  <div role="status" aria-live="polite" className="flex items-center gap-2 py-8 text-sm text-slate-500">
    <span className="size-4 animate-spin rounded-full border-2 border-slate-300 border-t-acqua-600" />
    Caricamento…
  </div>
)

export const EmptyState = ({ title, hint }: { title: string; hint?: string }) => (
  <div className="py-10 text-center">
    <p className="text-sm font-medium text-slate-700">{title}</p>
    {hint && <p className="mt-1 text-sm text-slate-500">{hint}</p>}
  </div>
)

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof ApiError ? error.message : 'Impossibile contattare il server.'
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4">
      <p className="text-sm font-medium text-red-800">{message}</p>
      {onRetry && (
        <Button variant="ghost" className="mt-3" onClick={onRetry}>Riprova</Button>
      )}
    </div>
  )
}

/** Blocco standard: caricamento, errore con riprova, vuoto, contenuto. */
export function Async<T>({ state, empty, children }: {
  state: AsyncState<T>
  empty?: { title: string; hint?: string }
  children: (data: T) => ReactNode
}) {
  if (state.loading && state.data === undefined) return <Spinner />
  if (state.error && state.data === undefined) return <ErrorState error={state.error} onRetry={state.reload} />
  if (state.data === undefined) return null
  if (empty && Array.isArray(state.data) && state.data.length === 0) {
    return <EmptyState title={empty.title} hint={empty.hint} />
  }
  return <>{children(state.data)}</>
}

export interface AsyncState<T> {
  data: T | undefined
  loading: boolean
  error: unknown
  reload: () => void
}

/** Carica dati dall'API e riespone sempre stato di caricamento, errore e ricarica. */
export function useApi<T>(path: string | null, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | undefined>(undefined)
  const [loading, setLoading] = useState(path !== null)
  const [error, setError] = useState<unknown>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (path === null) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    api.get<T>(path)
      .then((d) => { if (!cancelled) { setData(d); setError(null) } })
      .catch((e) => { if (!cancelled) setError(e) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, nonce, ...deps])

  return { data, loading, error, reload: () => setNonce((n) => n + 1) }
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4">
      <div role="dialog" aria-modal="true" aria-label={title}
        className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white sm:max-w-lg sm:rounded-2xl">
        <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <Button variant="ghost" onClick={onClose} aria-label="Chiudi">✕</Button>
        </header>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}

export const Table = ({ head, children }: { head: ReactNode[]; children: ReactNode }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
          {head.map((h, i) => <th key={i} scope="col" className="px-2 py-2 font-medium">{h}</th>)}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">{children}</tbody>
    </table>
  </div>
)
