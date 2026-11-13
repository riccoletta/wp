import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { AuthError } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { getMe, ApiError, type Me, type Role } from './data'

interface AuthValue {
  me: Me | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  resetPassword: (email: string) => Promise<void>
  setPassword: (password: string) => Promise<void>
  refresh: () => Promise<void>
  can: (...roles: Role[]) => boolean
}

const AuthContext = createContext<AuthValue | null>(null)

/** I messaggi di Supabase Auth sono in inglese: qui diventano italiani. */
function italiano(err: AuthError): string {
  const m = err.message.toLowerCase()
  if (m.includes('invalid login credentials')) return 'Email o password non corretti'
  if (m.includes('email not confirmed')) return "Accesso non ancora attivato: apri il link che hai ricevuto via email."
  if (m.includes('too many requests') || err.status === 429) {
    return 'Troppi tentativi. Riprova tra qualche minuto.'
  }
  if (m.includes('password should be at least')) return 'La password deve avere almeno 8 caratteri.'
  if (m.includes('same password')) return 'La nuova password deve essere diversa dalla precedente.'
  if (m.includes('expired') || m.includes('invalid')) return 'Link non valido o scaduto. Chiedine uno nuovo.'
  return 'Non è stato possibile completare l\'operazione. Riprova.'
}

const fail = (err: AuthError): never => { throw new ApiError(err.status ?? 400, italiano(err)) }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)

  /**
   * Chi sia l'utente lo dice il database, non il token: `api_me()` legge l'utente
   * applicativo collegato a `auth.uid()` e i suoi ruoli, sotto RLS. I ruoli non
   * stanno nei metadati dell'account, che l'utente stesso potrebbe modificare.
   */
  const refresh = useCallback(async () => {
    try {
      const { data } = await supabase.auth.getSession()
      if (!data.session) { setMe(null); return }
      setMe(await getMe())
    } catch (err) {
      // Identità Supabase senza utente applicativo collegato: nessun accesso.
      if (err instanceof ApiError && (err.status === 404 || err.status === 401)) setMe(null)
      else throw err
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh().catch(() => setLoading(false))
    const { data } = supabase.auth.onAuthStateChange((event) => {
      // `PASSWORD_RECOVERY` arriva mentre si sta reimpostando la password: la sessione
      // esiste ma la pagina di recupero deve restare in primo piano.
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
        refresh().catch(() => setLoading(false))
      }
    })
    return () => data.subscription.unsubscribe()
  }, [refresh])

  const value: AuthValue = {
    me,
    loading,
    login: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) fail(error)
      await refresh()
    },
    logout: async () => {
      await supabase.auth.signOut()
      setMe(null)
    },
    resetPassword: async (email) => {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/accedi`,
      })
      if (error) fail(error)
    },
    setPassword: async (password) => {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) fail(error)
      await refresh()
    },
    refresh,
    can: (...roles) => !!me && roles.some((r) => me.roles.includes(r)),
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth fuori da AuthProvider')
  return ctx
}
