/**
 * Invito di un accesso al gestionale.
 *
 * L'anagrafica esiste già: qui si apre un accesso a una persona che c'è. Serve la
 * chiave di servizio (creare un'identità in Supabase Auth e assegnare ruoli non è
 * roba da browser), quindi la funzione gira server-side e si difende da sola:
 *
 *   1) chi chiama deve avere una sessione Supabase valida;
 *   2) quella sessione deve corrispondere a un utente applicativo con ruolo `admin`
 *      (il ruolo si legge dal database, non dai metadati dell'account, che l'utente
 *      stesso potrebbe modificare);
 *   3) la licenza dev'essere operativa: invitare è una scrittura.
 *
 * Nessuna registrazione pubblica: non esiste un percorso che crei un account senza
 * passare di qui.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { fail, json, preflight } from '../_shared/http.ts'

const RUOLI = ['admin', 'coach', 'athlete', 'guardian'] as const
type Ruolo = typeof RUOLI[number]

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const url = Deno.env.get('SUPABASE_URL')!
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
/** Dove atterra il link dell'invito: il dominio pubblico dell'applicazione. */
const siteUrl = Deno.env.get('APP_SITE_URL') ?? ''

const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return fail(405, 'Metodo non ammesso')

  // 1) Sessione valida?
  const authorization = req.headers.get('Authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) return fail(401, 'Autenticazione richiesta')

  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  })
  const { data: userData, error: userError } = await caller.auth.getUser()
  if (userError || !userData.user) return fail(401, 'Autenticazione richiesta')

  // 2) È la segreteria? Il ruolo lo dice il database.
  const { data: callerRoles } = await admin
    .from('user_roles')
    .select('role, app_users!inner(auth_user_id, active)')
    .eq('app_users.auth_user_id', userData.user.id)
    .eq('app_users.active', true)
  if (!callerRoles?.some((r) => r.role === 'admin')) {
    return fail(403, 'Operazione consentita solo alla segreteria')
  }

  // 3) La licenza permette di scrivere?
  const { data: readOnly } = await admin.rpc('app_license_readonly')
  if (readOnly) {
    const { data: message } = await admin.rpc('app_license_message')
    return fail(403, message ?? "L'applicazione è in sola lettura.")
  }

  const body = await req.json().catch(() => null)
  const personId = String(body?.personId ?? '')
  const email = String(body?.email ?? '').trim().toLowerCase()
  const roles: Ruolo[] = Array.isArray(body?.roles) ? body.roles : []

  if (!UUID.test(personId)) return fail(400, 'Persona non valida')
  if (!EMAIL.test(email)) return fail(400, 'Indirizzo email non valido')
  if (roles.length === 0 || roles.some((r) => !RUOLI.includes(r))) {
    return fail(400, 'Scegli almeno un ruolo valido')
  }

  const { data: person } = await admin
    .from('people').select('id, archived').eq('id', personId).maybeSingle()
  if (!person) return fail(404, 'Persona non trovata in anagrafica')
  if (person.archived) return fail(400, 'La persona è archiviata: ripristinala prima di invitarla')

  // L'email di accesso è unica: se è già di un'altra persona ci fermiamo qui e lo diciamo.
  const { data: byEmail } = await admin
    .from('app_users').select('id, person_id').ilike('email', email).maybeSingle()
  if (byEmail && byEmail.person_id !== personId) {
    return fail(409, 'Questo indirizzo è già usato da un altro accesso')
  }

  // Identità Supabase: nuova, oppure quella già collegata a questa email.
  const invited = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: siteUrl ? `${siteUrl}/accedi` : undefined,
  })
  let authUserId = invited.data?.user?.id ?? null

  if (invited.error) {
    // Già registrato in Supabase Auth: non è un errore, è un reinvito. Gli mandiamo
    // un link per reimpostare la password invece di crearlo una seconda volta.
    const existing = await findAuthUser(email)
    if (!existing) return fail(400, "Invito non riuscito: " + invited.error.message)
    authUserId = existing
    const { error: linkError } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo: siteUrl ? `${siteUrl}/accedi` : undefined },
    })
    if (linkError) return fail(400, 'Invito non riuscito: ' + linkError.message)
  }

  // Collegamento all'utente applicativo: la persona, gli id e i legami restano quelli.
  const { data: appUser, error: upsertError } = await admin
    .from('app_users')
    .upsert({ person_id: personId, email, auth_user_id: authUserId, active: true },
            { onConflict: 'person_id' })
    .select('id').single()
  if (upsertError) return fail(500, 'Account non collegato: ' + upsertError.message)

  const { error: rolesError } = await admin
    .from('user_roles')
    .upsert(roles.map((role) => ({ user_id: appUser.id, role })), { onConflict: 'user_id,role' })
  if (rolesError) return fail(500, 'Ruoli non assegnati: ' + rolesError.message)

  return json({ email })
})

/** Cerca un'identità Supabase per email, pagina per pagina. */
async function findAuthUser(email: string): Promise<string | null> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error || !data.users.length) return null
    const hit = data.users.find((u) => u.email?.toLowerCase() === email)
    if (hit) return hit.id
    if (data.users.length < 200) return null
  }
  return null
}
