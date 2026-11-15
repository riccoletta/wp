import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { addTeamCoach, addTeamMember, getTeam, listDues, removeTeamCoach, removeTeamMember,
  type Due, type TeamDetail as TeamDetailData } from '../lib/data'
import { useAuth } from '../lib/auth'
import { Async, Badge, Button, Card, Table, useApi } from '../components/ui'
import PersonPicker from '../components/PersonPicker'
import { euro, formatDate } from '../lib/format'
import { duesByPerson, teamTotals, type PersonDues } from '../lib/dues'
import { DueBadge, MedicalBadge } from '../components/badges'

export default function TeamDetail() {
  const { id } = useParams<{ id: string }>()
  const { can } = useAuth()
  const state = useApi<TeamDetailData>(() => getTeam(id!), [id])
  const [picker, setPicker] = useState<null | 'atleta' | 'allenatore'>(null)

  /**
   * Le quote sono dati economici: le chiede soltanto la segreteria, e soltanto per
   * la stagione di questa squadra. Per gli altri ruoli la richiesta non parte
   * nemmeno — e se partisse la RLS non restituirebbe comunque nulla.
   */
  const isAdmin = can('admin')
  const seasonId = state.data?.seasonId
  const dues = useApi<Due[]>(isAdmin && seasonId ? () => listDues(seasonId) : null, [isAdmin, seasonId])
  const byPerson = useMemo(() => duesByPerson(dues.data ?? []), [dues.data])

  return (
    <Async state={state}>
      {(team) => (
        <>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h1 className="text-xl font-semibold text-slate-900">{team.name}</h1>
              <p className="flex items-center gap-2 text-sm text-slate-600">
                {team.season}
                {team.category && <Badge>{team.category}</Badge>}
                {team.seasonActive && <Badge tone="ok">stagione in corso</Badge>}
              </p>
            </div>
            <Link to="/squadre" className="text-sm text-acqua-700 hover:underline">← Squadre</Link>
          </div>

          <Card title="Allenatori" actions={can('admin') && (
            <Button variant="ghost" onClick={() => setPicker('allenatore')}>Assegna allenatore</Button>
          )}>
            {team.coaches.length === 0 ? (
              <p className="text-sm text-slate-600">Nessun allenatore assegnato.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {team.coaches.map((c) => (
                  <li key={c.id} className="flex items-center justify-between py-2">
                    <Link to={`/persone/${c.id}`} className="text-acqua-700 hover:underline">
                      {c.lastName} {c.firstName}
                    </Link>
                    {can('admin') && (
                      <Button variant="danger" onClick={async () => {
                        await removeTeamCoach(team.id, c.id); state.reload()
                      }}>Rimuovi</Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {isAdmin && (
            <Card title="Quote della rosa" actions={
              <Link to={`/quote?stagione=${team.seasonId}`} className="text-sm text-acqua-700 hover:underline">
                Gestisci quote →
              </Link>
            }>
              <Async state={dues}>
                {() => {
                  const t = teamTotals(team.roster.map((p) => p.id), byPerson)
                  return (
                    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Stat label="Totale dovuto" value={euro(t.amountCents)} />
                      <Stat label="Incassato" value={euro(t.paidCents)} />
                      <Stat label="Residuo" value={euro(t.remainingCents)} strong />
                      <Stat label="Senza quota" value={`${t.withoutDues} atleti`} />
                    </dl>
                  )
                }}
              </Async>
            </Card>
          )}

          <Card title={`Roster (${team.roster.length})`} actions={can('admin') && (
            <Button variant="ghost" onClick={() => setPicker('atleta')}>Aggiungi atleta</Button>
          )}>
            {team.roster.length === 0 ? (
              <p className="text-sm text-slate-600">Nessun atleta in rosa.</p>
            ) : (
              <Table head={['Atleta', 'Nascita', 'Certificato', ...(isAdmin ? ['Quota'] : []), '']}>
                {team.roster.map((p) => (
                  <tr key={p.id}>
                    <td className="px-2 py-2">
                      <Link to={`/persone/${p.id}`} className="font-medium text-acqua-700 hover:underline">
                        {p.lastName} {p.firstName}
                      </Link>
                    </td>
                    <td className="px-2 py-2 text-slate-600">{formatDate(p.birthDate)}</td>
                    <td className="px-2 py-2">
                      {p.medicalExpiresOn
                        ? <span className="flex items-center gap-2">
                            <MedicalBadge expiresOn={p.medicalExpiresOn} />
                            <span className="text-xs text-slate-500">{formatDate(p.medicalExpiresOn)}</span>
                          </span>
                        : <Badge tone="warn">Non registrato</Badge>}
                    </td>
                    {isAdmin && (
                      <td className="px-2 py-2">
                        {dues.data === undefined
                          ? <span className="text-xs text-slate-500">{dues.error ? '—' : 'Caricamento…'}</span>
                          : <DueCell dues={byPerson.get(p.id)} />}
                      </td>
                    )}
                    <td className="px-2 py-2 text-right">
                      {can('admin') && (
                        <Button variant="danger" onClick={async () => {
                          await removeTeamMember(team.id, p.id); state.reload()
                        }}>Togli</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>

          {picker && (
            <PersonPicker
              title={picker === 'atleta' ? 'Aggiungi atleta alla rosa' : 'Assegna un allenatore'}
              exclude={picker === 'atleta' ? team.roster.map((r) => r.id) : team.coaches.map((c) => c.id)}
              onClose={() => setPicker(null)}
              onPick={async (personId) => {
                await (picker === 'atleta' ? addTeamMember : addTeamCoach)(team.id, personId)
                setPicker(null); state.reload(); dues.reload()
              }}
            />
          )}
        </>
      )}
    </Async>
  )
}

const Stat = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
  <div className="rounded-lg bg-slate-50 p-3">
    <dt className="text-xs text-slate-500">{label}</dt>
    <dd className={`text-sm ${strong ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>{value}</dd>
  </div>
)

/** Quanto deve l'atleta nella stagione della squadra, sommando tutte le sue quote. */
function DueCell({ dues }: { dues: PersonDues | undefined }) {
  if (!dues) return <Badge>Nessuna quota</Badge>
  const detail = dues.status === 'saldata' ? euro(dues.amountCents)
    : dues.status === 'parziale' ? `${euro(dues.paidCents)} di ${euro(dues.amountCents)}`
    : `${euro(dues.remainingCents)} da versare`
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <DueBadge status={dues.status} />
      <span className="text-xs text-slate-500">
        {detail}{dues.count > 1 ? ` · ${dues.count} quote` : ''}
      </span>
    </span>
  )
}
