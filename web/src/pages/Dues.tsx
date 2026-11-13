import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { errorMessage, addPayment, deletePayment, getDue, listDues, listSeasons,
  type Due, type DueDetail as DueDetailData, type Season } from '../lib/data'
import { useAuth } from '../lib/auth'
import { Async, Button, Card, Field, Input, Modal, Select, Table, useApi } from '../components/ui'
import { DUE_LABELS, euro, formatDate, parseEuro, todayISO } from '../lib/format'
import { DueBadge } from '../components/badges'

export default function Dues() {
  const { can } = useAuth()
  const [params, setParams] = useSearchParams()
  const status = params.get('stato') ?? ''
  const seasonId = params.get('stagione') ?? ''
  const openDue = params.get('quota')
  const seasons = useApi<Season[]>(listSeasons)
  const state = useApi<Due[]>(() => listDues(seasonId, status), [seasonId, status])

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    value ? next.set(key, value) : next.delete(key)
    setParams(next, { replace: true })
  }

  const totals = (state.data ?? []).reduce(
    (acc, d) => ({ dovuto: acc.dovuto + d.amountCents, incassato: acc.incassato + d.paidCents }),
    { dovuto: 0, incassato: 0 },
  )

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Quote</h1>
        <p className="text-sm text-slate-600">
          {can('admin')
            ? 'Quote dovute e versamenti registrati a mano dalla segreteria.'
            : 'La tua posizione. I versamenti vengono registrati dalla segreteria.'}
        </p>
      </div>

      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Stato">
            <Select value={status} onChange={(e) => setParam('stato', e.target.value)}>
              <option value="">Tutte</option>
              {Object.entries(DUE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
          <Field label="Stagione">
            <Select value={seasonId} onChange={(e) => setParam('stagione', e.target.value)}>
              <option value="">Tutte</option>
              {(seasons.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
        </div>
      </Card>

      <Card>
        <Async state={state} empty={{
          title: 'Nessuna quota.',
          hint: can('admin') ? 'Le quote si creano dalla scheda della persona.' : 'Non risultano quote a tuo carico.',
        }}>
          {(rows) => (
            <>
              <Table head={['Persona', 'Quota', 'Importo', 'Versato', 'Residuo', 'Stato', '']}>
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td className="px-2 py-2">
                      <Link to={`/persone/${d.personId}`} className="font-medium text-acqua-700 hover:underline">
                        {d.lastName} {d.firstName}
                      </Link>
                    </td>
                    <td className="px-2 py-2 text-slate-600">
                      {d.description}
                      <p className="text-xs text-slate-500">{d.season} · scadenza {formatDate(d.dueDate)}</p>
                    </td>
                    <td className="px-2 py-2 text-slate-700">{euro(d.amountCents)}</td>
                    <td className="px-2 py-2 text-slate-700">{euro(d.paidCents)}</td>
                    <td className="px-2 py-2 font-medium text-slate-900">{euro(d.remainingCents)}</td>
                    <td className="px-2 py-2"><DueBadge status={d.status} /></td>
                    <td className="px-2 py-2 text-right">
                      <Link to={`?quota=${d.id}`} className="text-sm text-acqua-700 hover:underline">Dettaglio</Link>
                    </td>
                  </tr>
                ))}
              </Table>
              <p className="mt-3 text-xs text-slate-500">
                Totale dovuto {euro(totals.dovuto)} · incassato {euro(totals.incassato)} ·
                residuo {euro(totals.dovuto - totals.incassato)}
              </p>
            </>
          )}
        </Async>
      </Card>

      {openDue && (
        <DueDetail id={openDue} onClose={() => setParam('quota', '')} onChange={state.reload} />
      )}
    </>
  )
}

function DueDetail({ id, onClose, onChange }: { id: string; onClose: () => void; onChange: () => void }) {
  const { can } = useAuth()
  const state = useApi<DueDetailData>(() => getDue(id), [id])
  const [adding, setAdding] = useState(false)

  return (
    <Modal title="Dettaglio quota" onClose={onClose}>
      <Async state={state}>
        {(d) => (
          <div className="space-y-4">
            <div>
              <p className="font-medium text-slate-900">{d.description}</p>
              <p className="text-sm text-slate-600">{d.lastName} {d.firstName} · {d.season}</p>
            </div>
            <dl className="grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-3 text-sm">
              <div><dt className="text-xs text-slate-500">Importo</dt><dd>{euro(d.amountCents)}</dd></div>
              <div><dt className="text-xs text-slate-500">Versato</dt><dd>{euro(d.paidCents)}</dd></div>
              <div>
                <dt className="text-xs text-slate-500">Residuo</dt>
                <dd className="font-medium">{euro(d.remainingCents)}</dd>
              </div>
            </dl>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800">Versamenti</h3>
              <DueBadge status={d.status} />
            </div>
            {d.payments.length === 0 ? (
              <p className="text-sm text-slate-600">Nessun versamento registrato.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {d.payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between py-2">
                    <div>
                      <span className="font-medium text-slate-800">{euro(p.amountCents)}</span>
                      <p className="text-xs text-slate-500">
                        {formatDate(p.paidOn)} · {p.method}{p.note ? ` · ${p.note}` : ''}
                      </p>
                    </div>
                    {can('admin') && (
                      <Button variant="danger" onClick={async () => {
                        await deletePayment(d.id, p.id)
                        state.reload(); onChange()
                      }}>Elimina</Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {can('admin') && (
              adding ? (
                <PaymentForm dueId={d.id} suggested={d.remainingCents}
                  onCancel={() => setAdding(false)}
                  onSaved={() => { setAdding(false); state.reload(); onChange() }} />
              ) : (
                <Button onClick={() => setAdding(true)} disabled={d.remainingCents <= 0}>
                  {d.remainingCents > 0 ? 'Registra versamento' : 'Quota saldata'}
                </Button>
              )
            )}
          </div>
        )}
      </Async>
    </Modal>
  )
}

function PaymentForm({ dueId, suggested, onCancel, onSaved }: {
  dueId: string; suggested: number; onCancel: () => void; onSaved: () => void
}) {
  const [amount, setAmount] = useState((suggested / 100).toFixed(2).replace('.', ','))
  const [paidOn, setPaidOn] = useState(todayISO())
  const [method, setMethod] = useState('contanti')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const amountCents = parseEuro(amount)
    if (amountCents === null || amountCents <= 0) return setError('Importo non valido.')
    if (amountCents > suggested) return setError(`Il residuo è ${euro(suggested)}.`)
    setBusy(true); setError(null)
    try {
      await addPayment(dueId, { amountCents, paidOn, method: method as any, note: note || null })
      onSaved()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-lg border border-slate-200 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Importo">
          <Input required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Data">
          <Input type="date" required value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
        </Field>
      </div>
      <Field label="Modalità">
        <Select value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="contanti">Contanti</option>
          <option value="bonifico">Bonifico</option>
          <option value="assegno">Assegno</option>
          <option value="altro">Altro</option>
        </Select>
      </Field>
      <Field label="Nota" hint="Facoltativa.">
        <Input value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Annulla</Button>
        <Button type="submit" disabled={busy}>{busy ? 'Salvataggio…' : 'Registra'}</Button>
      </div>
    </form>
  )
}
