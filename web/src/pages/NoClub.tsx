import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { Async, Button, Card, useApi } from '../components/ui'
import { listMyClubs, type Club } from '../lib/data'

/**
 * Nessuna società aperta per questa identità, oppure più d'una: qui si sceglie.
 * L'elenco arriva dalla policy di `clubs`, non da un filtro del browser.
 */
export default function NoClub() {
  const { me, logout } = useAuth()
  const navigate = useNavigate()
  const state = useApi<Club[]>(listMyClubs)

  return (
    <div className="min-h-dvh bg-slate-50 p-4">
      <div className="mx-auto max-w-lg pt-10">
        <Card title="Le tue società">
          <Async state={state} empty={{
            title: 'Nessuna società collegata a questo accesso.',
            hint: 'Contatta la segreteria della tua società.',
          }}>
            {(clubs) => (
              <ul className="divide-y divide-slate-100">
                {clubs.map((c) => (
                  <li key={c.id} className="flex items-center justify-between py-2">
                    <span className="text-sm font-medium text-slate-800">{c.name}</span>
                    <Button onClick={() => navigate(`/club/${c.slug}`)}>Entra</Button>
                  </li>
                ))}
              </ul>
            )}
          </Async>
          <p className="mt-4 text-xs text-slate-500">Accesso: {me?.email}</p>
          <Button variant="ghost" className="mt-2"
            onClick={async () => { await logout(); navigate('/accedi') }}>Esci</Button>
        </Card>
      </div>
    </div>
  )
}
