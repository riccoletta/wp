import { Link } from 'react-router-dom'
import { useApi, Async, Card, Badge } from '../components/ui'
import { useAuth } from '../lib/auth'
import { euro, formatDate } from '../lib/format'

interface DashboardData {
  roles: string[]
  season: { id: string; name: string; startDate: string; endDate: string } | null
  teams: { id: string; name: string; category: string | null; rosterSize: number }[]
  counts: {
    medicalExpired: number
    medicalSoon: number
    peopleActive: number
    duesOpen: number
    duesRemainingCents: number
    registrationsPending: number
  }
}

export default function Dashboard() {
  const { me, can } = useAuth()
  const state = useApi<DashboardData>('/api/dashboard')

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Ciao {me?.firstName}</h1>
        <p className="text-sm text-slate-600">Scadenze e situazioni da seguire.</p>
      </div>

      <Async state={state}>
        {(d) => (
          <div className="space-y-4">
            <Card title={d.season ? `Stagione ${d.season.name}` : 'Stagione'}>
              {d.season ? (
                <p className="text-sm text-slate-600">
                  Dal {formatDate(d.season.startDate)} al {formatDate(d.season.endDate)}
                </p>
              ) : (
                <p className="text-sm text-slate-600">
                  Nessuna stagione attiva.{' '}
                  {can('admin') && <Link className="text-acqua-700 underline" to="/squadre">Creane una</Link>}
                </p>
              )}
            </Card>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile to="/scadenze?filtro=scaduti" label="Certificati scaduti"
                value={d.counts.medicalExpired} tone={d.counts.medicalExpired > 0 ? 'danger' : 'ok'} />
              <Tile to="/scadenze?filtro=in_scadenza" label="In scadenza (30 gg)"
                value={d.counts.medicalSoon} tone={d.counts.medicalSoon > 0 ? 'warn' : 'ok'} />
              {can('admin', 'athlete', 'guardian') && (
                <Tile to="/quote" label="Quote non saldate" value={d.counts.duesOpen}
                  sub={euro(d.counts.duesRemainingCents)} tone={d.counts.duesOpen > 0 ? 'warn' : 'ok'} />
              )}
              {can('admin') && (
                <Tile to="/tesseramenti?stato=da_completare" label="Tesseramenti da completare"
                  value={d.counts.registrationsPending}
                  tone={d.counts.registrationsPending > 0 ? 'warn' : 'ok'} />
              )}
            </div>

            {can('admin', 'coach') && (
              <Card title="Squadre della stagione">
                {d.teams.length === 0 ? (
                  <p className="text-sm text-slate-600">Nessuna squadra nella stagione attiva.</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {d.teams.map((t) => (
                      <li key={t.id} className="flex items-center justify-between py-2">
                        <Link to={`/squadre/${t.id}`} className="text-sm font-medium text-acqua-700 hover:underline">
                          {t.name}
                        </Link>
                        <span className="flex items-center gap-2 text-xs text-slate-500">
                          {t.category && <Badge>{t.category}</Badge>}
                          {t.rosterSize} atleti
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )}
          </div>
        )}
      </Async>
    </>
  )
}

function Tile({ to, label, value, sub, tone }: {
  to: string; label: string; value: number; sub?: string; tone: 'ok' | 'warn' | 'danger'
}) {
  const ring = { ok: 'border-slate-200', warn: 'border-amber-300', danger: 'border-red-300' }[tone]
  const color = { ok: 'text-slate-900', warn: 'text-amber-900', danger: 'text-red-800' }[tone]
  return (
    <Link to={to} className={`rounded-xl border bg-white p-4 shadow-sm transition hover:shadow ${ring}`}>
      <p className={`text-2xl font-semibold ${color}`}>{value}</p>
      <p className="mt-1 text-xs font-medium text-slate-600">{label}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub} da incassare</p>}
    </Link>
  )
}
