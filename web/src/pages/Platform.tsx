import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { createClub, errorMessage, listPlatformClubs, setSubscription,
  type PlatformClub, type SubscriptionAction } from '../lib/data'
import { Async, Badge, Button, Card, Field, Input, Modal, Table, useApi } from '../components/ui'
import { formatDate, todayISO } from '../lib/format'

/**
 * Portale del proprietario della piattaforma: l'elenco dei clienti e nient'altro.
 *
 * Qui non si amministra nessuna società: per farlo ci si entra, e da quel momento
 * vale l'interfaccia di sempre. Le operazioni di questa pagina sono chiuse dalle
 * policy e dalle funzioni `api_platform_*`, che verificano `platform_owners`:
 * un amministratore di società che chiamasse le stesse RPC riceverebbe 42501.
 */
const PHASE_TONE: Record<string, 'ok' | 'warn' | 'danger'> = {
  attiva: 'ok', in_scadenza: 'warn', tolleranza: 'warn', scaduta: 'danger', sospesa: 'danger',
}
const PHASE_LABEL: Record<string, string> = {
  attiva: 'Attivo', in_scadenza: 'In scadenza', tolleranza: 'In tolleranza',
  scaduta: 'Scaduto', sospesa: 'Sospeso',
}

export default function Platform() {
  const navigate = useNavigate()
  const state = useApi<PlatformClub[]>(listPlatformClubs)
  const [creating, setCreating] = useState(false)
  const [renewing, setRenewing] = useState<PlatformClub | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function act(club: PlatformClub, action: SubscriptionAction, expiresOn: string | null = null) {
    setBusy(club.id); setError(null)
    try {
      await setSubscription(club.id, action, expiresOn)
      state.reload()
    } catch (err) {
      setError(errorMessage(err))
    } finally { setBusy(null) }
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Società</h1>
          <p className="text-sm text-slate-600">
            I clienti della piattaforma, il loro abbonamento e la via d'ingresso.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>Nuova società</Button>
      </div>

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

      <Card>
        <Async state={state} empty={{
          title: 'Nessuna società registrata.',
          hint: 'Crea la prima con “Nuova società”.',
        }}>
          {(clubs) => (
            <Table head={['Società', 'Abbonamento', 'Scadenza', 'Atleti', 'Squadre', '']}>
              {clubs.map((c) => (
                <tr key={c.id}>
                  <td className="px-2 py-2">
                    <span className="font-medium text-slate-900">{c.name}</span>
                    <p className="text-xs text-slate-500">/{c.slug}</p>
                  </td>
                  <td className="px-2 py-2">
                    <Badge tone={PHASE_TONE[c.subscription.phase] ?? 'neutral'}>
                      {PHASE_LABEL[c.subscription.phase] ?? c.subscription.phase}
                    </Badge>
                  </td>
                  <td className="px-2 py-2 text-slate-600">{formatDate(c.subscription.expiresOn)}</td>
                  <td className="px-2 py-2 text-slate-700">{c.athletes}</td>
                  <td className="px-2 py-2 text-slate-700">{c.teams}</td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button onClick={() => navigate(`/club/${c.slug}`)}>Entra nella società</Button>
                      <Button variant="ghost" disabled={busy === c.id}
                        onClick={() => setRenewing(c)}>Rinnova</Button>
                      {c.subscription.status === 'sospesa' ? (
                        <Button variant="ghost" disabled={busy === c.id}
                          onClick={() => act(c, 'riattivata')}>Riattiva</Button>
                      ) : (
                        <Button variant="danger" disabled={busy === c.id}
                          onClick={() => act(c, 'sospesa')}>Sospendi</Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Async>
      </Card>

      {creating && (
        <NewClub onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); state.reload() }} />
      )}
      {renewing && (
        <Renew club={renewing} onClose={() => setRenewing(null)}
          onDone={(date) => { const c = renewing; setRenewing(null); act(c, 'rinnovata', date) }} />
      )}
    </>
  )
}

/** Dallo stesso nome esce lo slug dell'indirizzo: `Pallanuoto Milano` → `pallanuoto-milano`. */
const toSlug = (name: string) =>
  name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

function NewClub({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [expiresOn, setExpiresOn] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const finalSlug = slug || toSlug(name)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError('Il nome è obbligatorio.')
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(finalSlug)) {
      return setError('L\'indirizzo può contenere solo lettere minuscole, numeri e trattini.')
    }
    setBusy(true); setError(null)
    try {
      await createClub({ name: name.trim(), slug: finalSlug, expiresOn: expiresOn || null })
      onCreated()
    } catch (err) {
      setError(errorMessage(err)); setBusy(false)
    }
  }

  return (
    <Modal title="Nuova società" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Nome">
          <Input required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Indirizzo" hint={`La società starà su /club/${finalSlug || '…'}`}>
          <Input value={slug} placeholder={toSlug(name)} onChange={(e) => setSlug(e.target.value)} />
        </Field>
        <Field label="Scadenza dell'abbonamento" hint="Vuoto: un anno da oggi.">
          <Input type="date" min={todayISO()} value={expiresOn}
            onChange={(e) => setExpiresOn(e.target.value)} />
        </Field>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Annulla</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Creazione…' : 'Crea'}</Button>
        </div>
      </form>
    </Modal>
  )
}

/** Rinnovo: sposta la scadenza. Non riattiva una società sospesa, che è un atto a parte (D14). */
function Renew({ club, onClose, onDone }: {
  club: PlatformClub; onClose: () => void; onDone: (date: string) => void
}) {
  const [date, setDate] = useState(club.subscription.expiresOn)
  return (
    <Modal title={`Rinnova ${club.name}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); onDone(date) }} className="space-y-3">
        <Field label="Nuova scadenza">
          <Input type="date" required value={date} min={todayISO()}
            onChange={(e) => setDate(e.target.value)} />
        </Field>
        {club.subscription.status === 'sospesa' && (
          <p className="text-xs text-slate-500">
            La società è sospesa: il rinnovo sposta la scadenza, la riattivazione è un atto a parte.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Annulla</Button>
          <Button type="submit">Rinnova</Button>
        </div>
      </form>
    </Modal>
  )
}
