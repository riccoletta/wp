import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError, type Person } from '../lib/api'
import { useAuth } from '../lib/auth'
import { Async, Badge, Button, Card, Field, Input, Modal, Select, Table, useApi } from '../components/ui'
import { KIND_LABELS, formatDate, isMinor } from '../lib/format'

export default function People() {
  const { can } = useAuth()
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('')
  const [archived, setArchived] = useState(false)
  const [creating, setCreating] = useState(false)
  const path = `/api/people?q=${encodeURIComponent(q)}&kind=${kind}&archived=${archived}`
  const state = useApi<Person[]>(path)

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-slate-900">Persone</h1>
        {can('admin') && <Button onClick={() => setCreating(true)}>Nuova persona</Button>}
      </div>

      <Card>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Cerca">
            <Input value={q} placeholder="Nome o cognome" onChange={(e) => setQ(e.target.value)} />
          </Field>
          <Field label="Tipo">
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">Tutti</option>
              <option value="atleta">Atleti</option>
              <option value="socio">Soci</option>
              <option value="staff">Staff</option>
            </Select>
          </Field>
          <Field label="Stato">
            <Select value={archived ? 'si' : 'no'} onChange={(e) => setArchived(e.target.value === 'si')}>
              <option value="no">Attivi</option>
              <option value="si">Archiviati</option>
            </Select>
          </Field>
        </div>
      </Card>

      <Card>
        <Async state={state} empty={{
          title: archived ? 'Nessuna persona archiviata.' : 'Nessuna persona trovata.',
          hint: q || kind ? 'Prova a modificare i filtri.' : can('admin')
            ? 'Inizia creando la prima anagrafica.' : undefined,
        }}>
          {(people) => (
            <Table head={['Nome', 'Tipo', 'Nascita', '']}>
              {people.map((p) => (
                <tr key={p.id}>
                  <td className="px-2 py-2">
                    <Link to={`/persone/${p.id}`} className="font-medium text-acqua-700 hover:underline">
                      {p.lastName} {p.firstName}
                    </Link>
                    {isMinor(p.birthDate) && <span className="ml-2"><Badge tone="info">minore</Badge></span>}
                  </td>
                  <td className="px-2 py-2 text-slate-600">{KIND_LABELS[p.kind]}</td>
                  <td className="px-2 py-2 text-slate-600">{formatDate(p.birthDate)}</td>
                  <td className="px-2 py-2 text-right">
                    <Link to={`/persone/${p.id}`} className="text-sm text-acqua-700 hover:underline">Apri</Link>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Async>
      </Card>

      {creating && (
        <PersonForm onClose={() => setCreating(false)} onSaved={() => { setCreating(false); state.reload() }} />
      )}
    </>
  )
}

export function PersonForm({ person, onClose, onSaved }: {
  person?: Person; onClose: () => void; onSaved: () => void
}) {
  const [form, setForm] = useState({
    firstName: person?.firstName ?? '',
    lastName: person?.lastName ?? '',
    birthDate: person?.birthDate ?? '',
    email: person?.email ?? '',
    phone: person?.phone ?? '',
    kind: person?.kind ?? 'atleta',
  })
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null); setFieldErrors({})
    const payload = {
      ...form,
      birthDate: form.birthDate || null,
      email: form.email || null,
      phone: form.phone || null,
    }
    try {
      if (person) await api.patch(`/api/people/${person.id}`, payload)
      else await api.post('/api/people', payload)
      onSaved()
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
        setFieldErrors(err.details ?? {})
      } else setError('Server non raggiungibile.')
      setBusy(false)
    }
  }

  return (
    <Modal title={person ? 'Modifica anagrafica' : 'Nuova persona'} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3" noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome" error={fieldErrors.firstName?.[0]}>
            <Input value={form.firstName} required onChange={set('firstName')} />
          </Field>
          <Field label="Cognome" error={fieldErrors.lastName?.[0]}>
            <Input value={form.lastName} required onChange={set('lastName')} />
          </Field>
        </div>
        <Field label="Data di nascita" error={fieldErrors.birthDate?.[0]}>
          <Input type="date" value={form.birthDate ?? ''} onChange={set('birthDate')} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Email" hint="Facoltativa: non crea un accesso." error={fieldErrors.email?.[0]}>
            <Input type="email" value={form.email ?? ''} onChange={set('email')} />
          </Field>
          <Field label="Telefono" error={fieldErrors.phone?.[0]}>
            <Input value={form.phone ?? ''} onChange={set('phone')} />
          </Field>
        </div>
        <Field label="Tipo">
          <Select value={form.kind} onChange={set('kind')}>
            <option value="atleta">Atleta</option>
            <option value="socio">Socio</option>
            <option value="staff">Staff</option>
          </Select>
        </Field>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Annulla</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Salvataggio…' : 'Salva'}</Button>
        </div>
      </form>
    </Modal>
  )
}
