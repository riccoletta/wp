import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  errorMessage, addGuardian, createDue, deleteMedical, getPerson, invitePerson,
  listSeasons, removeGuardian, saveMedical, saveRegistration, updatePerson,
  type PersonDetail as Detail, type Role, type Season,
} from '../lib/data'
import { useAuth } from '../lib/auth'
import { Async, Badge, Button, Card, Field, Input, Modal, Select, useApi } from '../components/ui'
import PersonPicker from '../components/PersonPicker'
import { DueBadge, MedicalBadge, RegistrationBadge } from '../components/badges'
import {
  KIND_LABELS, MEDICAL_LABELS, REGISTRATION_LABELS,
  euro, formatDate, formatDateTime, isMinor, parseEuro,
} from '../lib/format'

export default function PersonDetail() {
  const { id } = useParams<{ id: string }>()
  const { can } = useAuth()
  const state = useApi<Detail>(() => getPerson(id!), [id])
  const [modal, setModal] = useState<null | 'anagrafica' | 'certificato' | 'tesseramento' | 'quota' | 'invito'>(null)

  return (
    <Async state={state}>
      {(p) => (
        <>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h1 className="text-xl font-semibold text-slate-900">{p.lastName} {p.firstName}</h1>
              <p className="flex items-center gap-2 text-sm text-slate-600">
                {KIND_LABELS[p.kind]}
                {isMinor(p.birthDate) && <Badge tone="info">minore</Badge>}
                {p.archived && <Badge tone="warn">archiviato</Badge>}
              </p>
            </div>
            <Link to="/persone" className="text-sm text-acqua-700 hover:underline">← Persone</Link>
          </div>

          <Card title="Anagrafica" actions={can('admin') && (
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setModal('anagrafica')}>Modifica</Button>
              <Button variant={p.archived ? 'ghost' : 'danger'}
                onClick={async () => {
                  await updatePerson(p.id, { archived: !p.archived })
                  state.reload()
                }}>
                {p.archived ? 'Ripristina' : 'Archivia'}
              </Button>
            </div>
          )}>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Info label="Data di nascita" value={formatDate(p.birthDate)} />
              <Info label="Email" value={p.email || '—'} />
              <Info label="Telefono" value={p.phone || '—'} />
              <Info label="Accesso"
                value={p.account ? `${p.account.email}${p.account.active ? '' : ' (disattivo)'}` : 'Nessun account'} />
            </dl>
            {can('admin') && !p.account && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <p className="mb-2 text-sm text-slate-600">
                  Questa persona è in anagrafica senza accesso al software. L'invito è facoltativo.
                </p>
                <Button variant="ghost" onClick={() => setModal('invito')}>Genera invito</Button>
              </div>
            )}
          </Card>

          <Card title="Squadre">
            {p.teams.length === 0 ? (
              <p className="text-sm text-slate-600">Non assegnata a nessuna squadra.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {p.teams.map((t) => (
                  <li key={t.id} className="flex items-center justify-between py-2">
                    <Link to={`/squadre/${t.id}`} className="font-medium text-acqua-700 hover:underline">{t.name}</Link>
                    <span className="flex items-center gap-2 text-slate-500">
                      {t.season}{t.seasonActive && <Badge tone="ok">in corso</Badge>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {(p.guardians.length > 0 || p.wards.length > 0 || (can('admin') && isMinor(p.birthDate))) && (
            <Guardians person={p} onChange={state.reload} />
          )}

          <Card title="Certificato medico" actions={can('admin') && (
            <Button variant="ghost" onClick={() => setModal('certificato')}>
              {p.medical ? 'Aggiorna scadenza' : 'Registra scadenza'}
            </Button>
          )}>
            {p.medical ? (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <MedicalBadge expiresOn={p.medical.expiresOn} />
                <span className="text-slate-700">Scade il {formatDate(p.medical.expiresOn)}</span>
                {p.medical.kind && <Badge>{MEDICAL_LABELS[p.medical.kind]}</Badge>}
                <span className="text-xs text-slate-500">
                  aggiornato il {formatDateTime(p.medical.updatedAt)}
                </span>
              </div>
            ) : (
              <p className="text-sm text-slate-600">Nessuna scadenza registrata.</p>
            )}
            <p className="mt-3 text-xs text-slate-500">
              Si registra soltanto la data di validità: il documento e ogni informazione sanitaria
              restano fuori dal gestionale.
            </p>
          </Card>

          <Card title="Tesseramenti" actions={can('admin') && (
            <Button variant="ghost" onClick={() => setModal('tesseramento')}>Aggiorna</Button>
          )}>
            {p.registrations.length === 0 ? (
              <p className="text-sm text-slate-600">Nessun tesseramento registrato.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {p.registrations.map((r) => (
                  <li key={r.id} className="py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-800">{r.season}</span>
                      <RegistrationBadge status={r.status} />
                    </div>
                    <p className="text-xs text-slate-500">
                      Presentato il {formatDate(r.submittedOn)} · valido fino al {formatDate(r.validUntil)}
                    </p>
                    {r.notes && <p className="mt-1 text-xs text-slate-600">{r.notes}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Quote" actions={can('admin') && (
            <Button variant="ghost" onClick={() => setModal('quota')}>Nuova quota</Button>
          )}>
            {p.dues.length === 0 ? (
              <p className="text-sm text-slate-600">Nessuna quota a carico.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {p.dues.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div>
                      <Link to={`/quote?quota=${d.id}`} className="font-medium text-acqua-700 hover:underline">
                        {d.description}
                      </Link>
                      <p className="text-xs text-slate-500">
                        {d.season} · scadenza {formatDate(d.dueDate)}
                      </p>
                    </div>
                    <div className="text-right">
                      <DueBadge status={d.status} />
                      <p className="text-xs text-slate-600">
                        {euro(d.paidCents)} di {euro(d.amountCents)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {modal === 'anagrafica' && (
            <PersonFormLazy person={p} onClose={() => setModal(null)}
              onSaved={() => { setModal(null); state.reload() }} />
          )}
          {modal === 'certificato' && (
            <MedicalForm person={p} onClose={() => setModal(null)}
              onSaved={() => { setModal(null); state.reload() }} />
          )}
          {modal === 'tesseramento' && (
            <RegistrationForm person={p} onClose={() => setModal(null)}
              onSaved={() => { setModal(null); state.reload() }} />
          )}
          {modal === 'quota' && (
            <DueForm personId={p.id} onClose={() => setModal(null)}
              onSaved={() => { setModal(null); state.reload() }} />
          )}
          {modal === 'invito' && (
            <InviteForm person={p} onClose={() => setModal(null)}
              onSaved={() => { setModal(null); state.reload() }} />
          )}
        </>
      )}
    </Async>
  )
}

const Info = ({ label, value }: { label: string; value: string }) => (
  <div>
    <dt className="text-xs text-slate-500">{label}</dt>
    <dd className="text-slate-800">{value}</dd>
  </div>
)

/** Il form anagrafica vive nella pagina elenco: lo riusiamo qui senza duplicarlo. */
import { PersonForm } from './People'
const PersonFormLazy = PersonForm

function Guardians({ person, onChange }: { person: Detail; onChange: () => void }) {
  const { can } = useAuth()
  const [adding, setAdding] = useState(false)
  return (
    <Card title={person.wards.length > 0 ? 'Minori collegati' : 'Tutori'}
      actions={can('admin') && isMinor(person.birthDate) && (
        <Button variant="ghost" onClick={() => setAdding(true)}>Collega tutore</Button>
      )}>
      {person.wards.length > 0 && (
        <ul className="divide-y divide-slate-100 text-sm">
          {person.wards.map((w) => (
            <li key={w.id} className="py-2">
              <Link to={`/persone/${w.id}`} className="text-acqua-700 hover:underline">
                {w.lastName} {w.firstName}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {person.wards.length === 0 && (
        person.guardians.length === 0 ? (
          <p className="text-sm text-slate-600">Nessun tutore collegato.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {person.guardians.map((g) => (
              <li key={g.id} className="flex items-center justify-between py-2">
                <Link to={`/persone/${g.id}`} className="text-acqua-700 hover:underline">
                  {g.lastName} {g.firstName}
                </Link>
                {can('admin') && (
                  <Button variant="danger" onClick={async () => {
                    await removeGuardian(person.id, g.id)
                    onChange()
                  }}>Scollega</Button>
                )}
              </li>
            ))}
          </ul>
        )
      )}
      {adding && (
        <PersonPicker title="Collega un tutore" confirmLabel="Collega" exclude={[person.id]}
          onClose={() => setAdding(false)}
          onPick={async (guardianId) => {
            await addGuardian(person.id, guardianId)
            setAdding(false); onChange()
          }} />
      )}
    </Card>
  )
}

function MedicalForm({ person, onClose, onSaved }: { person: Detail; onClose: () => void; onSaved: () => void }) {
  const [expiresOn, setExpiresOn] = useState(person.medical?.expiresOn ?? '')
  const [kind, setKind] = useState(person.medical?.kind ?? '')
  const [error, setError] = useState<string | null>(null)
  return (
    <Modal title="Scadenza certificato" onClose={onClose}>
      <form className="space-y-3" onSubmit={async (e: FormEvent) => {
        e.preventDefault()
        setError(null)
        try {
          await saveMedical(person.id, expiresOn, kind || null)
          onSaved()
        } catch (err) {
          setError(errorMessage(err))
        }
      }}>
        <Field label="Data di scadenza">
          <Input type="date" required value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
        </Field>
        <Field label="Tipologia" hint="Facoltativa.">
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">Non specificata</option>
            <option value="agonistico">Agonistico</option>
            <option value="non_agonistico">Non agonistico</option>
          </Select>
        </Field>
        <p className="text-xs text-slate-500">
          Non allegare referti né annotare informazioni cliniche: serve solo la validità.
        </p>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          {person.medical && (
            <Button type="button" variant="danger" onClick={async () => {
              await deleteMedical(person.id); onSaved()
            }}>Rimuovi</Button>
          )}
          <Button type="button" variant="ghost" onClick={onClose}>Annulla</Button>
          <Button type="submit">Salva</Button>
        </div>
      </form>
    </Modal>
  )
}

function RegistrationForm({ person, onClose, onSaved }: {
  person: Detail; onClose: () => void; onSaved: () => void
}) {
  const seasons = useApi<Season[]>(listSeasons)
  const [form, setForm] = useState({ seasonId: '', status: 'in_corso', submittedOn: '', validUntil: '', notes: '' })
  const [error, setError] = useState<string | null>(null)

  return (
    <Modal title="Tesseramento" onClose={onClose}>
      <Async state={seasons} empty={{ title: 'Nessuna stagione definita.', hint: 'Creane una in Squadre.' }}>
        {(list) => {
          const seasonId = form.seasonId || list.find((s) => s.isActive)?.id || list[0]?.id || ''
          const existing = person.registrations.find((r) => r.seasonId === seasonId)
          return (
            <form className="space-y-3" onSubmit={async (e: FormEvent) => {
              e.preventDefault()
              setError(null)
              try {
                await saveRegistration({
                  personId: person.id,
                  seasonId,
                  status: form.status as Detail['registrations'][number]['status'],
                  submittedOn: form.submittedOn || null,
                  validUntil: form.validUntil || null,
                  notes: form.notes || null,
                })
                onSaved()
              } catch (err) {
                setError(errorMessage(err))
              }
            }}>
              <Field label="Stagione">
                <Select value={seasonId} onChange={(e) => setForm((f) => ({ ...f, seasonId: e.target.value }))}>
                  {list.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
              {existing && (
                <p className="text-xs text-amber-800">
                  Esiste già un tesseramento per questa stagione ({REGISTRATION_LABELS[existing.status]}):
                  salvando lo aggiorni.
                </p>
              )}
              <Field label="Stato">
                <Select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                  {Object.entries(REGISTRATION_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Presentato il">
                  <Input type="date" value={form.submittedOn}
                    onChange={(e) => setForm((f) => ({ ...f, submittedOn: e.target.value }))} />
                </Field>
                <Field label="Valido fino al">
                  <Input type="date" value={form.validUntil}
                    onChange={(e) => setForm((f) => ({ ...f, validUntil: e.target.value }))} />
                </Field>
              </div>
              <Field label="Note amministrative" hint="Solo informazioni di segreteria.">
                <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
              </Field>
              {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={onClose}>Annulla</Button>
                <Button type="submit">Salva</Button>
              </div>
            </form>
          )
        }}
      </Async>
    </Modal>
  )
}

export function DueForm({ personId, onClose, onSaved }: {
  personId: string; onClose: () => void; onSaved: () => void
}) {
  const seasons = useApi<Season[]>(listSeasons)
  const [form, setForm] = useState({ seasonId: '', description: '', amount: '', dueDate: '' })
  const [error, setError] = useState<string | null>(null)

  return (
    <Modal title="Nuova quota" onClose={onClose}>
      <Async state={seasons} empty={{ title: 'Nessuna stagione definita.' }}>
        {(list) => {
          const seasonId = form.seasonId || list.find((s) => s.isActive)?.id || list[0]?.id || ''
          return (
            <form className="space-y-3" onSubmit={async (e: FormEvent) => {
              e.preventDefault()
              setError(null)
              const amountCents = parseEuro(form.amount)
              if (amountCents === null || amountCents <= 0) return setError('Importo non valido.')
              try {
                await createDue({
                  personId, seasonId, description: form.description, amountCents,
                  dueDate: form.dueDate || null,
                })
                onSaved()
              } catch (err) {
                setError(errorMessage(err))
              }
            }}>
              <Field label="Stagione">
                <Select value={seasonId} onChange={(e) => setForm((f) => ({ ...f, seasonId: e.target.value }))}>
                  {list.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
              <Field label="Descrizione">
                <Input required value={form.description} placeholder="Quota annuale"
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Importo" hint="In euro, es. 450,00">
                  <Input required inputMode="decimal" value={form.amount}
                    onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
                </Field>
                <Field label="Scadenza">
                  <Input type="date" value={form.dueDate}
                    onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} />
                </Field>
              </div>
              {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={onClose}>Annulla</Button>
                <Button type="submit">Crea quota</Button>
              </div>
            </form>
          )
        }}
      </Async>
    </Modal>
  )
}

/**
 * L'invito è un atto separato dall'anagrafica: la persona esiste già, qui le si apre
 * un accesso. Lo manda Supabase Auth per email — nessun link da consegnare a mano,
 * nessuna registrazione pubblica.
 */
function InviteForm({ person, onClose, onSaved }: { person: Detail; onClose: () => void; onSaved: () => void }) {
  const [email, setEmail] = useState(person.email ?? '')
  const [roles, setRoles] = useState<Role[]>(['athlete'])
  const [sent, setSent] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = (role: Role) =>
    setRoles((r) => (r.includes(role) ? r.filter((x) => x !== role) : [...r, role]))

  if (sent) {
    return (
      <Modal title="Invito inviato" onClose={() => { onSaved() }}>
        <p className="text-sm text-slate-700">
          Abbiamo mandato a <strong>{sent}</strong> un'email con il link per impostare la
          password e attivare l'accesso. Il link scade: se non arriva o scade, l'invito
          si può rifare da qui.
        </p>
        <div className="mt-4 flex justify-end">
          <Button onClick={() => onSaved()}>Chiudi</Button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Genera invito" onClose={onClose}>
      <form className="space-y-3" onSubmit={async (e: FormEvent) => {
        e.preventDefault()
        setBusy(true); setError(null)
        try {
          await invitePerson(person.id, email, roles)
          setSent(email)
        } catch (err) {
          setError(errorMessage(err))
        } finally { setBusy(false) }
      }}>
        <Field label="Email di accesso">
          <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-slate-700">Ruoli</legend>
          <div className="space-y-1">
            {([['admin', 'Segreteria'], ['coach', 'Allenatore'], ['athlete', 'Atleta'],
               ['guardian', 'Tutore']] as [Role, string][]).map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={roles.includes(value)} onChange={() => toggle(value)}
                    className="size-4 rounded border-slate-300" />
                  {label}
                </label>
              ))}
          </div>
        </fieldset>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Annulla</Button>
          <Button type="submit" disabled={busy || roles.length === 0}>
            {busy ? 'Invio…' : 'Invia invito'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
