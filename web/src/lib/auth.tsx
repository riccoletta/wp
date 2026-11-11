import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, ApiError, type Me, type Role } from './api'

interface AuthValue {
  me: Me | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
  can: (...roles: Role[]) => boolean
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      setMe(await api.get<Me>('/api/auth/me'))
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setMe(null)
      else throw err
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh().catch(() => setLoading(false)) }, [refresh])

  const value: AuthValue = {
    me,
    loading,
    login: async (email, password) => {
      await api.post('/api/auth/login', { email, password })
      await refresh()
    },
    logout: async () => {
      await api.post('/api/auth/logout')
      setMe(null)
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
