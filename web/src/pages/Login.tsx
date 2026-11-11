import { useState, type FormEvent } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { api, ApiError } from '../lib/api'
import { Button, Field, Input, Spinner } from '../components/ui'

export default function Login() {
  const { me, loading, login, refresh } = useAuth()
  const [params] = useSearchParams()
  const inviteToken = params.get('invito')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (loading) return <div className="p-8"><Spinner /></div>
  if (me) return <Navigate to="/" replace />
  if (inviteToken) return <AcceptInvite token={inviteToken} onDone={refresh} />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await login(email, password)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Server non raggiungibile.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell title="Accedi">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Email">
          <Input type="email" value={email} autoComplete="username" required
            onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <Input type="password" value={password} autoComplete="current-password" required
            onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? 'Accesso in corso…' : 'Accedi'}
        </Button>
        <p className="text-center text-xs text-slate-500">
          L'accesso è riservato: gli account si creano solo su invito della segreteria.
        </p>
      </form>
    </Shell>
  )
}

function AcceptInvite({ token, onDone }: { token: string; onDone: () => Promise<void> }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (password !== confirm) return setError('Le due password non coincidono.')
    if (password.length < 8) return setError('La password deve avere almeno 8 caratteri.')
    setBusy(true); setError(null)
    try {
      await api.post('/api/auth/accept-invite', { token, password })
      await onDone()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Server non raggiungibile.')
      setBusy(false)
    }
  }

  return (
    <Shell title="Attiva il tuo accesso">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Nuova password" hint="Almeno 8 caratteri.">
          <Input type="password" value={password} autoComplete="new-password" required
            onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Ripeti la password">
          <Input type="password" value={confirm} autoComplete="new-password" required
            onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? 'Attivazione…' : 'Attiva accesso'}
        </Button>
      </form>
    </Shell>
  )
}

const Shell = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="flex min-h-dvh items-center justify-center bg-slate-50 p-4">
    <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="mb-1 text-lg font-semibold text-acqua-700">Gestionale Pallanuoto</h1>
      <p className="mb-5 text-sm text-slate-600">{title}</p>
      {children}
    </div>
  </div>
)
