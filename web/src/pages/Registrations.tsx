import { Link, useSearchParams } from 'react-router-dom'
import { listRegistrations, listSeasons, type Registration, type Season } from '../lib/data'
import { Async, Card, Field, Select, Table, useApi } from '../components/ui'
import { REGISTRATION_LABELS, formatDate } from '../lib/format'
import { RegistrationBadge } from './PersonDetail'

export default function Registrations() {
  const [params, setParams] = useSearchParams()
  const status = params.get('stato') ?? ''
  const seasonId = params.get('stagione') ?? ''
  const seasons = useApi<Season[]>(listSeasons)
  const state = useApi<Registration[]>(() => listRegistrations(seasonId, status), [seasonId, status])

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    value ? next.set(key, value) : next.delete(key)
    setParams(next, { replace: true })
  }

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Tesseramenti</h1>
        <p className="text-sm text-slate-600">
          Stato per atleta e stagione. Si aggiorna dalla scheda della persona.
        </p>
      </div>

      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Stato">
            <Select value={status} onChange={(e) => setParam('stato', e.target.value)}>
              <option value="">Tutti</option>
              {Object.entries(REGISTRATION_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
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
          title: 'Nessun tesseramento.',
          hint: 'Apri la scheda di un atleta per registrarne lo stato.',
        }}>
          {(rows) => (
            <Table head={['Atleta', 'Stagione', 'Stato', 'Presentato', 'Valido fino al']}>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-2 py-2">
                    <Link to={`/persone/${r.personId}`} className="font-medium text-acqua-700 hover:underline">
                      {r.lastName} {r.firstName}
                    </Link>
                    {r.notes && <p className="text-xs text-slate-500">{r.notes}</p>}
                  </td>
                  <td className="px-2 py-2 text-slate-600">{r.season}</td>
                  <td className="px-2 py-2"><RegistrationBadge status={r.status} /></td>
                  <td className="px-2 py-2 text-slate-600">{formatDate(r.submittedOn)}</td>
                  <td className="px-2 py-2 text-slate-600">{formatDate(r.validUntil)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Async>
      </Card>
    </>
  )
}
