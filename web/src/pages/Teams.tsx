import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { errorMessage, activateSeason, createSeason, createTeam, listSeasons, listTeams,
  type Season, type Team } from '../lib/data'
import { useAuth } from '../lib/auth'
import { Async, Badge, Button, Card, Field, Input, Modal, Select, useApi } from '../components/ui'
import { formatDate } from '../lib/format'

export default function Teams() {
  const { can } = useAuth()
  const [seasonId, setSeasonId] = useState('')
  const [modal, setModal] = useState<null | 'squadra' | 'stagione'>(null)
  const seasons = useApi<Season[]>(listSeasons)
  const teams = useApi<Team[]>(() => listTeams(seasonId), [seasonId])

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-slate-900">Squadre</h1>
        {can('admin') && (
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setModal('stagione')}>Nuova stagione</Button>
            <Button onClick={() => setModal('squadra')}>Nuova squadra</Button>
          </div>
        )}
      </div>

      <Card title="Stagioni">
        <Async state={seasons} empty={{
          title: 'Nessuna stagione definita.',
          hint: can('admin') ? 'Crea la prima stagione per iniziare.' : undefined,
        }}>
          {(list) => (
            <ul className="divide-y divide-slate-100 text-sm">
              {list.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <span className="font-medium text-slate-800">{s.name}</span>
                    {s.isActive && <span className="ml-2"><Badge tone="ok">attiva</Badge></span>}
                    <p className="text-xs text-slate-500">
                      {formatDate(s.startDate)} – {formatDate(s.endDate)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={() => setSeasonId(s.id)}>Filtra squadre</Button>
                    {can('admin') && !s.isActive && (
                      <Button variant="ghost" onClick={async () => {
                        await activateSeason(s.id)
                        seasons.reload(); teams.reload()
                      }}>Rendi attiva</Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Async>
      </Card>

      <Card title={seasonId ? 'Squadre della stagione scelta' : 'Tutte le squadre'}
        actions={seasonId && <Button variant="ghost" onClick={() => setSeasonId('')}>Mostra tutte</Button>}>
        <Async state={teams} empty={{
          title: 'Nessuna squadra.',
          hint: can('admin') ? 'Creane una e assegnale gli atleti.' : 'Non ti è stata assegnata alcuna squadra.',
        }}>
          {(list) => (
            <ul className="divide-y divide-slate-100 text-sm">
              {list.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Link to={`/squadre/${t.id}`} className="font-medium text-acqua-700 hover:underline">{t.name}</Link>
                  <span className="flex items-center gap-2 text-slate-500">
                    {t.category && <Badge>{t.category}</Badge>}
                    {t.season}
                    {t.seasonActive && <Badge tone="ok">in corso</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Async>
      </Card>

      {modal === 'stagione' && (
        <SeasonForm onClose={() => setModal(null)} onSaved={() => { setModal(null); seasons.reload() }} />
      )}
      {modal === 'squadra' && (
        <TeamForm seasons={seasons.data ?? []} onClose={() => setModal(null)}
          onSaved={() => { setModal(null); teams.reload() }} />
      )}
    </>
  )
}

function SeasonForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: '', startDate: '', endDate: '' })
  const [error, setError] = useState<string | null>(null)
  return (
    <Modal title="Nuova stagione" onClose={onClose}>
      <form className="space-y-3" onSubmit={async (e: FormEvent) => {
        e.preventDefault()
        setError(null)
        if (form.endDate <= form.startDate) return setError('La fine deve seguire l\'inizio.')
        try {
          await createSeason(form)
          onSaved()
        } catch (err) {
          setError(errorMessage(err))
        }
      }}>
        <Field label="Nome" hint="Es. 2025/2026">
          <Input required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Inizio">
            <Input type="date" required value={form.startDate}
              onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
          </Field>
          <Field label="Fine">
            <Input type="date" required value={form.endDate}
              onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
          </Field>
        </div>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Annulla</Button>
          <Button type="submit">Crea</Button>
        </div>
      </form>
    </Modal>
  )
}

function TeamForm({ seasons, onClose, onSaved }: {
  seasons: Season[]; onClose: () => void; onSaved: () => void
}) {
  const [form, setForm] = useState({
    name: '', category: '', seasonId: seasons.find((s) => s.isActive)?.id ?? seasons[0]?.id ?? '',
  })
  const [error, setError] = useState<string | null>(null)
  if (seasons.length === 0) {
    return (
      <Modal title="Nuova squadra" onClose={onClose}>
        <p className="text-sm text-slate-700">Prima di creare una squadra serve almeno una stagione.</p>
        <div className="mt-4 flex justify-end"><Button onClick={onClose}>Ho capito</Button></div>
      </Modal>
    )
  }
  return (
    <Modal title="Nuova squadra" onClose={onClose}>
      <form className="space-y-3" onSubmit={async (e: FormEvent) => {
        e.preventDefault()
        setError(null)
        try {
          await createTeam({ ...form, category: form.category || null })
          onSaved()
        } catch (err) {
          setError(errorMessage(err))
        }
      }}>
        <Field label="Stagione">
          <Select value={form.seasonId} onChange={(e) => setForm((f) => ({ ...f, seasonId: e.target.value }))}>
            {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Nome">
          <Input required value={form.name} placeholder="Under 16"
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </Field>
        <Field label="Categoria" hint="Facoltativa.">
          <Input value={form.category} placeholder="U16"
            onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} />
        </Field>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Annulla</Button>
          <Button type="submit">Crea</Button>
        </div>
      </form>
    </Modal>
  )
}
