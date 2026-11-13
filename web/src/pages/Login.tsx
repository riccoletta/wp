import { useState, type FormEvent, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { ApiError } from '../lib/data'
import { Button, Field, Input, Spinner } from '../components/ui'

/**
 * Supabase recapita inviti e recuperi password con un link che porta qui e che
 * contiene il token nel frammento dell'URL. Il tipo va letto subito: `supabase-js`
 * consuma il frammento e lo ripulisce appena avvia la sessione.
 */
const linkType = new URLSearchParams(window.location.hash.slice(1)).get('type')
const arrivedFromLink = linkType === 'invite' || linkType === 'recovery'

export default function Login() {
  const { me, loading } = useAuth()
  const [mode, setMode] = useState<'login' | 'recupero' | 'nuova-password'>(
    arrivedFromLink ? 'nuova-password' : 'login',
  )

  if (loading) return <div className="p-8"><Spinner /></div>
  if (mode === 'nuova-password') return <SetPassword invito={linkType === 'invite'} />
  if (me) return <Navigate to="/" replace />
  if (mode === 'recupero') return <ForgotPassword onBack={() => setMode('login')} />
  return <SignIn onForgot={() => setMode('recupero')} />
}

function SignIn({ onForgot }: { onForgot: () => void }) {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await login(email, password)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Server non raggiungibile.')
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
        <Button type="button" variant="ghost" className="w-full" onClick={onForgot}>
          Password dimenticata?
        </Button>
        <p className="text-center text-xs text-slate-500">
          L'accesso è riservato: gli account si creano solo su invito della segreteria.
        </p>
      </form>
    </Shell>
  )
}

function ForgotPassword({ onBack }: { onBack: () => void }) {
  const { resetPassword } = useAuth()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await resetPassword(email)
      setSent(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Server non raggiungibile.')
    } finally { setBusy(false) }
  }

  if (sent) {
    return (
      <Shell title="Controlla la tua email">
        <p className="text-sm text-slate-600">
          Se l'indirizzo <strong>{email}</strong> corrisponde a un account, riceverai un link
          per impostare una nuova password. Il link vale un'ora sola.
        </p>
        <Button variant="ghost" className="mt-4 w-full" onClick={onBack}>Torna all'accesso</Button>
      </Shell>
    )
  }

  return (
    <Shell title="Recupera l'accesso">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Email" hint="Ti mandiamo un link per impostare una nuova password.">
          <Input type="email" value={email} autoComplete="username" required
            onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? 'Invio in corso…' : 'Invia il link'}
        </Button>
        <Button type="button" variant="ghost" className="w-full" onClick={onBack}>
          Torna all'accesso
        </Button>
      </form>
    </Shell>
  )
}

function SetPassword({ invito }: { invito: boolean }) {
  const { setPassword } = useAuth()
  const [password, setPwd] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (password !== confirm) return setError('Le due password non coincidono.')
    if (password.length < 8) return setError('La password deve avere almeno 8 caratteri.')
    setBusy(true); setError(null)
    try {
      await setPassword(password)
      setDone(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Server non raggiungibile.')
      setBusy(false)
    }
  }

  if (done) return <Navigate to="/" replace />

  return (
    <Shell title={invito ? 'Attiva il tuo accesso' : 'Imposta una nuova password'}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Nuova password" hint="Almeno 8 caratteri.">
          <Input type="password" value={password} autoComplete="new-password" required
            onChange={(e) => setPwd(e.target.value)} />
        </Field>
        <Field label="Ripeti la password">
          <Input type="password" value={confirm} autoComplete="new-password" required
            onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? 'Salvataggio…' : invito ? 'Attiva accesso' : 'Salva la password'}
        </Button>
      </form>
    </Shell>
  )
}

const Shell = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="flex min-h-dvh items-center justify-center bg-slate-50 p-4">
    <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="mb-1 text-lg font-semibold text-acqua-700">Gestionale Pallanuoto</h1>
      <p className="mb-5 text-sm text-slate-600">{title}</p>
      {children}
    </div>
  </div>
)
