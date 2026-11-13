import { Badge } from './ui'
import { DUE_LABELS, REGISTRATION_LABELS, todayISO } from '../lib/format'

/**
 * Pastiglie di stato condivise fra elenchi e schede. Gli stati che mostrano sono
 * tutti DERIVATI (giorni alla scadenza, versamenti registrati): qui non si decide
 * niente, si colora soltanto quello che il database ha già calcolato.
 */

export function MedicalBadge({ expiresOn }: { expiresOn: string }) {
  const days = Math.round((Date.parse(expiresOn) - Date.parse(todayISO())) / 864e5)
  if (days < 0) return <Badge tone="danger">Scaduto</Badge>
  if (days <= 30) return <Badge tone="warn">In scadenza</Badge>
  return <Badge tone="ok">Valido</Badge>
}

export const RegistrationBadge = ({ status }: { status: string }) => (
  <Badge tone={status === 'attivo' ? 'ok' : status === 'scaduto' ? 'danger' : 'warn'}>
    {REGISTRATION_LABELS[status] ?? status}
  </Badge>
)

export const DueBadge = ({ status }: { status: string }) => (
  <Badge tone={status === 'saldata' ? 'ok' : status === 'parziale' ? 'warn' : 'danger'}>
    {DUE_LABELS[status] ?? status}
  </Badge>
)
