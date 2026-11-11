import { Link, useSearchParams } from 'react-router-dom'
import type { MedicalRow } from '../lib/api'
import { Async, Button, Card, Table, useApi } from '../components/ui'
import { MEDICAL_LABELS, formatDate } from '../lib/format'
import { MedicalBadge } from './PersonDetail'

const FILTERS = [
  { value: '', label: 'Tutti' },
  { value: 'scaduti', label: 'Scaduti' },
  { value: 'in_scadenza', label: 'In scadenza (30 gg)' },
]

export default function Medical() {
  const [params, setParams] = useSearchParams()
  const filter = params.get('filtro') ?? ''
  const state = useApi<MedicalRow[]>(`/api/medical?filter=${filter}`)

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Scadenze certificati</h1>
        <p className="text-sm text-slate-600">
          Solo la data di validità: nessun documento e nessuna informazione sanitaria è conservata qui.
        </p>
      </div>

      <Card>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Button key={f.value} variant={filter === f.value ? 'primary' : 'ghost'}
              onClick={() => {
                const next = new URLSearchParams(params)
                f.value ? next.set('filtro', f.value) : next.delete('filtro')
                setParams(next, { replace: true })
              }}>
              {f.label}
            </Button>
          ))}
        </div>
      </Card>

      <Card>
        <Async state={state} empty={{
          title: filter === 'scaduti' ? 'Nessun certificato scaduto.'
            : filter === 'in_scadenza' ? 'Nessun certificato in scadenza nei prossimi 30 giorni.'
            : 'Nessuna scadenza registrata.',
          hint: filter === '' ? 'Le scadenze si registrano dalla scheda della persona.' : undefined,
        }}>
          {(rows) => (
            <Table head={['Persona', 'Stato', 'Scadenza', 'Giorni', 'Tipo']}>
              {rows.map((m) => (
                <tr key={m.personId}>
                  <td className="px-2 py-2">
                    <Link to={`/persone/${m.personId}`} className="font-medium text-acqua-700 hover:underline">
                      {m.lastName} {m.firstName}
                    </Link>
                  </td>
                  <td className="px-2 py-2"><MedicalBadge expiresOn={m.expiresOn} /></td>
                  <td className="px-2 py-2 text-slate-600">{formatDate(m.expiresOn)}</td>
                  <td className="px-2 py-2 text-slate-600">
                    {m.daysLeft < 0 ? `scaduto da ${-m.daysLeft} gg` : `tra ${m.daysLeft} gg`}
                  </td>
                  <td className="px-2 py-2 text-slate-600">{m.kind ? MEDICAL_LABELS[m.kind] : '—'}</td>
                </tr>
              ))}
            </Table>
          )}
        </Async>
      </Card>
    </>
  )
}
