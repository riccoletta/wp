import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import type { Role } from '../lib/api'
import { Button } from './ui'
import LicenseBanner from './LicenseBanner'

interface NavItem { to: string; label: string; roles: Role[] }

/** Le voci di menù seguono i ruoli. È comodità di navigazione: i permessi veri stanno nel database. */
const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', roles: ['admin', 'coach', 'athlete', 'guardian'] },
  { to: '/persone', label: 'Persone', roles: ['admin', 'coach', 'guardian'] },
  { to: '/squadre', label: 'Squadre', roles: ['admin', 'coach'] },
  { to: '/tesseramenti', label: 'Tesseramenti', roles: ['admin'] },
  { to: '/scadenze', label: 'Scadenze', roles: ['admin', 'coach', 'athlete', 'guardian'] },
  { to: '/quote', label: 'Quote', roles: ['admin', 'athlete', 'guardian'] },
  { to: '/profilo', label: 'Profilo', roles: ['admin', 'coach', 'athlete', 'guardian'] },
]

export default function Layout() {
  const { me, logout, can } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const items = NAV.filter((i) => can(...i.roles))

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `block rounded-lg px-3 py-2 text-sm font-medium ${
      isActive ? 'bg-acqua-600 text-white' : 'text-slate-700 hover:bg-acqua-50'
    }`

  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Button variant="ghost" className="md:hidden" aria-expanded={open}
            aria-controls="menu-principale" onClick={() => setOpen((v) => !v)}>
            <span aria-hidden>☰</span> Menù
          </Button>
          <span className="font-semibold text-acqua-700">Gestionale Pallanuoto</span>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm text-slate-600 sm:inline">
              {me?.firstName} {me?.lastName}
            </span>
            <Button variant="ghost" onClick={async () => { await logout(); navigate('/accedi') }}>Esci</Button>
          </div>
        </div>
      </header>

      <LicenseBanner />

      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 md:flex-row">
        <nav id="menu-principale" aria-label="Navigazione principale"
          className={`${open ? 'block' : 'hidden'} md:block md:w-52 md:shrink-0`}>
          <ul className="space-y-1">
            {items.map((i) => (
              <li key={i.to}>
                <NavLink to={i.to} end={i.to === '/'} className={linkClass} onClick={() => setOpen(false)}>
                  {i.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <main className="min-w-0 flex-1 space-y-4">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
