export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: Record<string, string[]>) {
    super(message)
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? 'Errore imprevisto', data?.details)
  }
  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  del: <T>(path: string) => request<T>('DELETE', path),
}

export type Role = 'admin' | 'coach' | 'athlete' | 'guardian'

export interface Me {
  userId: string
  personId: string
  email: string
  roles: Role[]
  firstName: string
  lastName: string
}

export interface Person {
  id: string
  firstName: string
  lastName: string
  birthDate: string | null
  email: string | null
  phone: string | null
  kind: 'atleta' | 'socio' | 'staff'
  archived: boolean
}

export interface Season {
  id: string
  name: string
  startDate: string
  endDate: string
  isActive: boolean
}

export interface Team {
  id: string
  name: string
  category: string | null
  seasonId: string
  season: string
  seasonActive: boolean
}

export type RegistrationStatus = 'da_completare' | 'in_corso' | 'attivo' | 'scaduto'

export interface Registration {
  id: string
  personId: string
  firstName: string
  lastName: string
  seasonId: string
  season: string
  status: RegistrationStatus
  submittedOn: string | null
  validUntil: string | null
  notes: string | null
}

export interface MedicalRow {
  personId: string
  firstName: string
  lastName: string
  kind: 'agonistico' | 'non_agonistico' | null
  expiresOn: string
  daysLeft: number
}

export type DueStatus = 'aperta' | 'parziale' | 'saldata'

export interface Due {
  id: string
  personId: string
  firstName: string
  lastName: string
  season: string
  description: string
  amountCents: number
  paidCents: number
  remainingCents: number
  status: DueStatus
  dueDate: string | null
}

export interface Payment {
  id: string
  amountCents: number
  paidOn: string
  method: 'contanti' | 'bonifico' | 'assegno' | 'altro'
  note: string | null
}

export type LicensePhase = 'attiva' | 'in_scadenza' | 'tolleranza' | 'scaduta' | 'sospesa'

export interface License {
  status: 'attiva' | 'sospesa'
  expiresOn: string
  graceDays: number
  graceUntil: string
  daysLeft: number
  graceDaysLeft: number
  phase: LicensePhase
  readOnly: boolean
  message: string | null
}
