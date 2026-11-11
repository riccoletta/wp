import { useAuth } from '../lib/auth'
import { Card } from '../components/ui'

const ROLE_LABELS: Record<string, string> = {
  admin: 'Segreteria',
  coach: 'Allenatore',
  athlete: 'Atleta',
  guardian: 'Genitore o tutore',
}

export default function Profile() {
  const { me } = useAuth()
  if (!me) return null
  return (
    <>
      <h1 className="text-xl font-semibold text-slate-900">Profilo</h1>
      <Card title="Il tuo accesso">
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-xs text-slate-500">Nome</dt>
            <dd className="text-slate-800">{me.firstName} {me.lastName}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Email</dt>
            <dd className="text-slate-800">{me.email}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Ruoli</dt>
            <dd className="text-slate-800">{me.roles.map((r) => ROLE_LABELS[r] ?? r).join(', ')}</dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-slate-500">
          Per cambiare i tuoi dati anagrafici o i ruoli, rivolgiti alla segreteria.
        </p>
      </Card>
    </>
  )
}
