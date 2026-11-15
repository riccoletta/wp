import { Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { Button } from './ui'

/**
 * Testata del portale della piattaforma: minima di proposito. L'interfaccia di
 * società resta quella di sempre, questa è un'altra cosa e si vede.
 */
export default function PlatformLayout() {
  const { me, logout } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-900 text-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <span className="font-semibold">Piattaforma</span>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm text-slate-300 sm:inline">{me?.email}</span>
            <Button variant="ghost" onClick={async () => { await logout(); navigate('/accedi') }}>
              Esci
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-4 px-4 py-4">
        <Outlet />
      </main>
    </div>
  )
}
