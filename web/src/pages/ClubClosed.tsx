import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { Button, Card } from '../components/ui'
import { formatDate } from '../lib/format'
import type { Club, Subscription } from '../lib/data'

/**
 * Società non operativa: abbonamento scaduto oltre la tolleranza, oppure sospeso.
 *
 * Non è una pagina vuota per finta: il database non restituisce i dati della società
 * a nessun ruolo del club finché l'abbonamento non torna in piedi (D27). Restano
 * l'accesso, il motivo e l'uscita. **Nessun dato viene cancellato o archiviato.**
 */
export default function ClubClosed({ club, subscription }: {
  club: Club; subscription: Subscription
}) {
  const { logout } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="min-h-dvh bg-slate-50 p-4">
      <div className="mx-auto max-w-lg pt-10">
        <Card title={club.name}>
          <div className="space-y-4">
            <p className="text-sm font-semibold text-red-800">
              {subscription.status === 'sospesa' ? 'Abbonamento sospeso' : 'Abbonamento scaduto'}
            </p>
            <p className="text-sm text-slate-700">{subscription.message}</p>
            <dl className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-sm">
              <div>
                <dt className="text-xs text-slate-500">Scadenza</dt>
                <dd>{formatDate(subscription.expiresOn)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Fine tolleranza</dt>
                <dd>{formatDate(subscription.graceUntil)}</dd>
              </div>
            </dl>
            <p className="text-xs text-slate-500">
              I dati della società restano al loro posto: tornano consultabili appena
              il fornitore riattiva il servizio.
            </p>
            <Button variant="ghost" onClick={async () => { await logout(); navigate('/accedi') }}>
              Esci
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
