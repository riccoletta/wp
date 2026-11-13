import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError, addTeamCoach, addTeamMember, getTeam, listPeople, removeTeamCoach,
  removeTeamMember, type Person, type TeamDetail as TeamDetailData } from '../lib/data'
import { useAuth } from '../lib/auth'
import { Async, Badge, Button, Card, Field, Modal, Select, Table, useApi } from '../components/ui'
import { formatDate } from '../lib/format'
import { MedicalBadge } from './PersonDetail'

export default function TeamDetail() {
  const { id } = useParams<{ id: string }>()
  const { can } = useAuth()
  const state = useApi<TeamDetailData>(() => getTeam(id!), [id])
  const [picker, setPicker] = useState<null | 'atleta' | 'allenatore'>(null)

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

          <Card title={`Roster (${team.roster.length})`} actions={can('admin') && (
            <Button variant="ghost" onClick={() => setPicker('atleta')}>Aggiungi atleta</Button>
          )}>
            {team.roster.length === 0 ? (
              <p className="text-sm text-slate-600">Nessun atleta in rosa.</p>
            ) : (
              <Table head={['Atleta', 'Nascita', 'Certificato', '']}>
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
                setPicker(null); state.reload()
              }}
            />
          )}
        </>
      )}
    </Async>
  )
}

function PersonPicker({ title, exclude, onClose, onPick }: {
  title: string; exclude: string[]; onClose: () => void; onPick: (personId: string) => Promise<void>
}) {
  const people = useApi<Person[]>(() => listPeople())
  const [selected, setSelected] = useState('')
  const [error, setError] = useState<string | null>(null)
  return (
    <Modal title={title} onClose={onClose}>
      <Async state={people} empty={{ title: 'Nessuna persona disponibile.' }}>
        {(list) => {
          const options = list.filter((p) => !exclude.includes(p.id))
          return (
            <form className="space-y-3" onSubmit={async (e) => {
              e.preventDefault()
              setError(null)
              try { await onPick(selected) } catch (err) {
                setError(err instanceof ApiError ? err.message : 'Server non raggiungibile.')
              }
            }}>
              <Field label="Persona">
                <Select value={selected} required onChange={(e) => setSelected(e.target.value)}>
                  <option value="">Scegli…</option>
                  {options.map((p) => (
                    <option key={p.id} value={p.id}>{p.lastName} {p.firstName}</option>
                  ))}
                </Select>
              </Field>
              {options.length === 0 && (
                <p className="text-sm text-slate-600">Tutte le persone disponibili sono già assegnate.</p>
              )}
              {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={onClose}>Annulla</Button>
                <Button type="submit" disabled={!selected}>Conferma</Button>
              </div>
            </form>
          )
        }}
      </Async>
    </Modal>
  )
}
