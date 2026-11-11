import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import Layout from './components/Layout'
import { Spinner } from './components/ui'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import People from './pages/People'
import PersonDetail from './pages/PersonDetail'
import Teams from './pages/Teams'
import TeamDetail from './pages/TeamDetail'
import Registrations from './pages/Registrations'
import Medical from './pages/Medical'
import Dues from './pages/Dues'
import Profile from './pages/Profile'

function Protected() {
  const { me, loading } = useAuth()
  if (loading) return <div className="p-8"><Spinner /></div>
  if (!me) return <Navigate to="/accedi" replace />
  return <Layout />
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/accedi" element={<Login />} />
        <Route element={<Protected />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/persone" element={<People />} />
          <Route path="/persone/:id" element={<PersonDetail />} />
          <Route path="/squadre" element={<Teams />} />
          <Route path="/squadre/:id" element={<TeamDetail />} />
          <Route path="/tesseramenti" element={<Registrations />} />
          <Route path="/scadenze" element={<Medical />} />
          <Route path="/quote" element={<Dues />} />
          <Route path="/profilo" element={<Profile />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}
