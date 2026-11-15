/**
 * Accesso ai dati: Supabase Data API, nessun backend intermedio.
 *
 * Le letture composte e le scritture in più passi passano da funzioni PostgreSQL
 * `api_*` (SECURITY INVOKER), così restano atomiche e la RLS continua a decidere
 * da sola che cosa ciascun ruolo può vedere o scrivere. Qui non c'è nessun
 * controllo di permessi: se una riga non torna, è la policy ad averla esclusa.
 */
import type { PostgrestError } from '@supabase/supabase-js'
import { supabase } from './supabase'

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

/** Da codice SQLSTATE a messaggio italiano. Il testo della licenza arriva dal database. */
function toApiError(err: PostgrestError): ApiError {
  switch (err.code) {
    // Negato dalla RLS: non sei autorizzato, oppure la riga non esiste per te.
    case '42501': return new ApiError(403, 'Operazione non consentita')
    // Sollevato da app_can_write(): licenza scaduta o sospesa, messaggio già in italiano.
    case 'P0001': return new ApiError(403, err.message)
    case '23505': return new ApiError(409, 'Esiste già un elemento con questi dati.')
    case '23503': return new ApiError(400, 'Riferimento non valido.')
    case '23514':
    case '22007':
    case '22P02': return new ApiError(400, 'Dati non validi.')
    case 'PGRST301': return new ApiError(401, 'Sessione scaduta. Accedi di nuovo.')
    default:
      return new ApiError(500, err.message || 'Errore imprevisto. Riprova.')
  }
}

/**
 * Messaggio da mostrare all'utente. Gli errori che il database sa spiegare (permessi,
 * licenza, vincoli) arrivano già in italiano da `toApiError`; tutto il resto è una rete
 * che non si è potuta raggiungere.
 */
export const errorMessage = (err: unknown) =>
  err instanceof ApiError ? err.message : 'Server non raggiungibile.'

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw toApiError(error)
  return data as T
}

/** Una lettura di dettaglio che non torna nulla: inesistente o non visibile per questo ruolo. */
async function rpcRequired<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const data = await rpc<T | null>(fn, args)
  if (data === null || data === undefined) throw new ApiError(404, 'Elemento non trovato')
  return data
}

/* ================================== Tipi ================================== */

export type Role = 'admin' | 'coach' | 'athlete' | 'guardian'

export interface Club {
  id: string
  name: string
  slug: string
}

export interface Me {
  userId: string | null
  personId: string | null
  email: string
  roles: Role[]
  firstName: string
  lastName: string
  /** Proprietario della piattaforma: non è un ruolo di società, è un'altra cosa. */
  platformOwner: boolean
  /** Società in cui si sta lavorando. `null` per il proprietario fuori da una società. */
  club: Club | null
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

export type SubscriptionPhase = 'attiva' | 'in_scadenza' | 'tolleranza' | 'scaduta' | 'sospesa'

/** Stato DERIVATO dell'abbonamento di una società: lo calcola il database. */
export interface Subscription {
  status: 'attiva' | 'sospesa'
  expiresOn: string
  graceDays: number
  graceUntil: string
  daysLeft: number
  graceDaysLeft: number
  phase: SubscriptionPhase
  readOnly: boolean
  /** Scaduto oltre la tolleranza o sospeso: la società non è consultabile. */
  blocked: boolean
  note: string | null
  message: string | null
}

export interface PlatformClub extends Club {
  createdAt: string
  athletes: number
  teams: number
  admins: number
  subscription: Subscription
}

export interface PersonDetail extends Person {
  teams: { id: string; name: string; category: string | null; season: string; seasonActive: boolean }[]
  guardians: { id: string; firstName: string; lastName: string }[]
  wards: { id: string; firstName: string; lastName: string }[]
  account: { email: string; active: boolean } | null
  registrations: {
    id: string; status: RegistrationStatus; submittedOn: string | null
    validUntil: string | null; notes: string | null; seasonId: string; season: string
  }[]
  medical: { kind: MedicalRow['kind']; expiresOn: string; updatedAt: string } | null
  dues: (Omit<Due, 'personId' | 'firstName' | 'lastName'>)[]
}

export interface TeamDetail extends Team {
  roster: {
    id: string; firstName: string; lastName: string; birthDate: string | null
    addedAt: string; medicalExpiresOn: string | null
  }[]
  coaches: { id: string; firstName: string; lastName: string }[]
}

export interface DueDetail extends Due { payments: Payment[] }

export interface DashboardData {
  roles: Role[]
  season: { id: string; name: string; startDate: string; endDate: string } | null
  teams: { id: string; name: string; category: string | null; season: string; rosterSize: number }[]
  counts: {
    medicalExpired: number
    medicalSoon: number
    peopleActive: number
    duesOpen: number
    duesRemainingCents: number
    registrationsPending: number
  }
}

/* ===================== Identità, società, abbonamento ===================== */

export const getMe = () => rpcRequired<Me>('api_me')
export const getDashboard = () => rpcRequired<DashboardData>('api_dashboard')

/** Lo stato dell'abbonamento della società corrente. `null` se non si è in nessuna. */
export const getSubscription = () => rpc<Subscription | null>('api_subscription')

/** Le società in cui si può entrare: la propria, o tutte per il proprietario. */
export const listMyClubs = () => rpc<Club[]>('api_my_clubs')

/**
 * Entrare in una società è un atto dichiarato che il database registra: da qui in
 * poi ogni policy filtra su questa scelta. L'indirizzo nel browser non decide nulla,
 * e su una società non propria questa chiamata è respinta.
 */
export const enterClub = (slug: string) => rpcRequired<Club>('api_club_enter', { p_slug: slug })

export const leaveClub = () => rpc('api_club_leave')

/* ==================== Portale del proprietario (piattaforma) ============== */

export const listPlatformClubs = () => rpc<PlatformClub[]>('api_platform_clubs')

export const createClub = (c: { name: string; slug: string; expiresOn: string | null }) =>
  rpc<{ id: string; slug: string }>('api_platform_club_create',
    { p_name: c.name, p_slug: c.slug, p_expires: c.expiresOn })

export type SubscriptionAction = 'rinnovata' | 'sospesa' | 'riattivata'

export const setSubscription = (clubId: string, action: SubscriptionAction,
                                expiresOn: string | null = null, note: string | null = null) =>
  rpc<Subscription>('api_platform_subscription',
    { p_club: clubId, p_action: action, p_expires: expiresOn, p_note: note })

/* ================================ Persone ================================= */

export const listPeople = (q = '', kind = '', archived = false) =>
  rpc<Person[]>('api_people_list', { p_q: q, p_kind: kind, p_archived: archived })

export const getPerson = (id: string) => rpcRequired<PersonDetail>('api_person_get', { p_id: id })

export const createPerson = (p: Partial<Person>) =>
  rpc<{ id: string }>('api_person_create', { p })

export const updatePerson = (id: string, p: Partial<Person>) =>
  rpc<{ id: string }>('api_person_update', { p_id: id, p })

export const addGuardian = (minorId: string, guardianPersonId: string) =>
  rpc('api_guardian_add', { p_minor: minorId, p_guardian: guardianPersonId })

export const removeGuardian = (minorId: string, guardianPersonId: string) =>
  rpc('api_guardian_remove', { p_minor: minorId, p_guardian: guardianPersonId })

/* =========================== Stagioni e squadre =========================== */

export const listSeasons = () => rpc<Season[]>('api_seasons_list')

export const createSeason = (s: { name: string; startDate: string; endDate: string }) =>
  rpc<{ id: string }>('api_season_create', { p_name: s.name, p_start: s.startDate, p_end: s.endDate })

export const activateSeason = (id: string) => rpc('api_season_activate', { p_id: id })

export const listTeams = (seasonId?: string) =>
  rpc<Team[]>('api_teams_list', { p_season_id: seasonId || null })

export const getTeam = (id: string) => rpcRequired<TeamDetail>('api_team_get', { p_id: id })

export const createTeam = (t: { name: string; category: string | null; seasonId: string }) =>
  rpc<{ id: string }>('api_team_create', { p_name: t.name, p_category: t.category, p_season_id: t.seasonId })

export const addTeamMember = (teamId: string, personId: string) =>
  rpc('api_team_member_add', { p_team: teamId, p_person: personId })

export const removeTeamMember = (teamId: string, personId: string) =>
  rpc('api_team_member_remove', { p_team: teamId, p_person: personId })

export const addTeamCoach = (teamId: string, personId: string) =>
  rpc('api_team_coach_add', { p_team: teamId, p_person: personId })

export const removeTeamCoach = (teamId: string, personId: string) =>
  rpc('api_team_coach_remove', { p_team: teamId, p_person: personId })

/* ============================== Tesseramenti ============================== */

export const listRegistrations = (seasonId = '', status = '') =>
  rpc<Registration[]>('api_registrations_list', { p_season_id: seasonId || null, p_status: status })

export const saveRegistration = (r: {
  personId: string; seasonId: string; status: RegistrationStatus
  submittedOn?: string | null; validUntil?: string | null; notes?: string | null
}) => rpc<{ id: string }>('api_registration_save', { p: r })

/* ========================= Scadenze dei certificati ======================= */

export const listMedical = (filter = '') => rpc<MedicalRow[]>('api_medical_list', { p_filter: filter })

export const saveMedical = (personId: string, expiresOn: string, kind: string | null) =>
  rpc('api_medical_save', { p_person: personId, p_kind: kind, p_expires: expiresOn })

export const deleteMedical = (personId: string) => rpc('api_medical_delete', { p_person: personId })

/* ======================== Quote e pagamenti manuali ======================= */

export const listDues = (seasonId = '', status = '') =>
  rpc<Due[]>('api_dues_list', { p_season_id: seasonId || null, p_status: status })

export const getDue = (id: string) => rpcRequired<DueDetail>('api_due_get', { p_id: id })

export const createDue = (d: {
  personId: string; seasonId: string; description: string; amountCents: number; dueDate?: string | null
}) => rpc<{ id: string }>('api_due_create', { p: d })

export const addPayment = (dueId: string, p: {
  amountCents: number; paidOn: string; method: Payment['method']; note?: string | null
}) => rpc<{ id: string }>('api_payment_add', { p_due: dueId, p })

export const deletePayment = (dueId: string, paymentId: string) =>
  rpc('api_payment_delete', { p_due: dueId, p_payment: paymentId })

/* ============================= Inviti (Edge) ============================== */

/**
 * L'invito crea un'identità in Supabase Auth: serve la chiave di servizio, quindi
 * non può avvenire nel browser. La Edge Function verifica da sé che chi chiama sia
 * admin, e collega `auth_user_id` e ruoli all'anagrafica già esistente.
 */
export async function invitePerson(personId: string, email: string, roles: Role[]) {
  const { data, error } = await supabase.functions.invoke<{ email: string }>('club-invite', {
    body: { personId, email, roles },
  })
  if (error) {
    const detail = await readFunctionError(error)
    throw new ApiError(400, detail ?? "Invito non riuscito. Riprova o contatta l'assistenza.")
  }
  return data!
}

/** Le Edge Function restituiscono l'errore nel corpo: qui lo tiriamo fuori in chiaro. */
async function readFunctionError(error: unknown): Promise<string | null> {
  const res = (error as { context?: Response }).context
  if (!res || typeof res.json !== 'function') return null
  try {
    const body = await res.json()
    return typeof body?.error === 'string' ? body.error : null
  } catch { return null }
}
