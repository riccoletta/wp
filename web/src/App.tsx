import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { ClubProvider } from './lib/club'
import Layout from './components/Layout'
import PlatformLayout from './components/PlatformLayout'
import { Spinner } from './components/ui'
import Login from './pages/Login'
import Platform from './pages/Platform'
import NoClub from './pages/NoClub'
import Dashboard from './pages/Dashboard'
import People from './pages/People'
import PersonDetail from './pages/PersonDetail'
import Teams from './pages/Teams'
import TeamDetail from './pages/TeamDetail'
import Registrations from './pages/Registrations'
import Medical from './pages/Medical'
import Dues from './pages/Dues'
import Profile from './pages/Profile'

/**
 * Due ambienti, una sola applicazione:
 *   `/admin`        portale del proprietario della piattaforma;
 *   `/club/<slug>`  il gestionale di una società, identico a prima.
 * Lo smistamento è comodità di navigazione. Che cosa si veda davvero lo decidono
 * le policy RLS a partire dalla società in cui si è dichiarato di entrare.
 */
function ClubArea() {
  const { me, loading } = useAuth()
  if (loading) return <div className="p-8"><Spinner /></div>
  if (!me) return <Navigate to="/accedi" replace />
  return (
    <ClubProvider>
      <Layout />
    </ClubProvider>
  )
}

function PlatformArea() {
  const { me, loading } = useAuth()
  if (loading) return <div className="p-8"><Spinner /></div>
  if (!me) return <Navigate to="/accedi" replace />
  // Il portale è del proprietario: gli altri tornano a casa propria. Non è questa
  // riga a proteggerlo — le RPC `api_platform_*` rifiutano chiunque altro.
  if (!me.platformOwner) return <Navigate to="/" replace />
  return <PlatformLayout />
}

/** Dopo l'accesso: il proprietario al portale, l'utente di società nella sua società. */
function Home() {
  const { me, loading } = useAuth()
  if (loading) return <div className="p-8"><Spinner /></div>
  if (!me) return <Navigate to="/accedi" replace />
  if (me.platformOwner) return <Navigate to="/admin" replace />
  if (me.club) return <Navigate to={`/club/${me.club.slug}`} replace />
  return <NoClub />
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/accedi" element={<Login />} />

        <Route path="/admin" element={<PlatformArea />}>
          <Route index element={<Platform />} />
        </Route>

        <Route path="/club/:slug" element={<ClubArea />}>
          <Route index element={<Dashboard />} />
          <Route path="persone" element={<People />} />
          <Route path="persone/:id" element={<PersonDetail />} />
          <Route path="squadre" element={<Teams />} />
          <Route path="squadre/:id" element={<TeamDetail />} />
          <Route path="tesseramenti" element={<Registrations />} />
          <Route path="scadenze" element={<Medical />} />
          <Route path="quote" element={<Dues />} />
          <Route path="profilo" element={<Profile />} />
        </Route>

        <Route path="/" element={<Home />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}
