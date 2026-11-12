import { asSystem } from './db.js'
import { hashPassword } from './auth.js'

/**
 * Creazione del PRIMO amministratore su un database vuoto.
 *
 * Non è un seed: non inventa squadre, stagioni o utenti di prova. Crea la terna
 * minima e coerente `people` → `app_users` → `user_roles('admin')` in UNA transazione,
 * quindi o esiste tutto o non esiste niente.
 *
 * Regole di sicurezza:
 * - idempotente: se l'email esiste già, la password NON viene toccata;
 * - non sovrascrive: un amministratore esistente non viene mai riscritto;
 * - se un altro amministratore esiste già, il comando si ferma salvo consenso
 *   esplicito (`addition: true`): il bootstrap è un atto unico, non un modo per
 *   aggiungere poteri di nascosto;
 * - la password arriva già in chiaro dal chiamante e non lascia mai questa funzione:
 *   qui diventa subito hash `scrypt`, lo stesso usato dal login.
 */

// Lock consultivo: due bootstrap lanciati insieme non creano due amministratori.
const BOOTSTRAP_LOCK = 4150973022

export type BootstrapOutcome = 'creato' | 'ruolo-aggiunto' | 'già-presente'

export interface BootstrapInput {
  email: string
  password: string
  firstName: string
  lastName: string
  /** Consenso esplicito a creare un amministratore quando ne esiste già un altro. */
  addition?: boolean
}

export interface BootstrapResult {
  outcome: BootstrapOutcome
  email: string
  userId: string
  personId: string
}

export function validatePassword(password: string): string | null {
  if (password.length < 12) return 'La password deve avere almeno 12 caratteri.'
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return 'La password deve contenere almeno una minuscola, una maiuscola e una cifra.'
  }
  return null
}

export function validateEmail(email: string): string | null {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? null : 'Indirizzo email non valido.'
}

export async function bootstrapAdmin(input: BootstrapInput): Promise<BootstrapResult> {
  const email = input.email.trim()
  const emailError = validateEmail(email)
  if (emailError) throw new Error(emailError)
  const passwordError = validatePassword(input.password)
  if (passwordError) throw new Error(passwordError)
  const firstName = input.firstName.trim()
  const lastName = input.lastName.trim()
  if (!firstName || !lastName) throw new Error('Nome e cognome sono obbligatori.')

  // L'hash si calcola fuori dalla transazione: scrypt è lento per costruzione e
  // non c'è motivo di tenere aperto un lock mentre gira.
  const passwordHash = await hashPassword(input.password)

  return asSystem(async (tx) => {
    // PGlite non ha i lock consultivi di un server multiprocesso: lì il lock non serve.
    await tx.query('select pg_advisory_xact_lock($1)', [BOOTSTRAP_LOCK]).catch(() => [])

    const existing = await tx.one<{ id: string; person_id: string; is_admin: boolean }>(
      `select u.id, u.person_id, exists (
                select 1 from user_roles r where r.user_id = u.id and r.role = 'admin'
              ) as is_admin
         from app_users u where lower(u.email) = lower($1)`,
      [email],
    )

    if (existing) {
      // Account già presente: la password resta quella che è. Al massimo gli si
      // riconosce il ruolo admin, se per qualche motivo mancava.
      if (existing.is_admin) {
        return { outcome: 'già-presente' as const, email, userId: existing.id, personId: existing.person_id }
      }
      await tx.query(`insert into user_roles (user_id, role) values ($1,'admin') on conflict do nothing`, [existing.id])
      return { outcome: 'ruolo-aggiunto' as const, email, userId: existing.id, personId: existing.person_id }
    }

    const other = await tx.one<{ email: string }>(
      `select u.email from app_users u
         join user_roles r on r.user_id = u.id and r.role = 'admin'
        limit 1`,
    )
    if (other && !input.addition) {
      throw new Error(
        `Esiste già un amministratore (${other.email}). Il bootstrap non lo sovrascrive: ` +
          'per creare un secondo amministratore aggiungi --aggiungi, oppure usa un invito dalla segreteria.',
      )
    }

    // Riusa l'anagrafica se quell'email è già di una persona sola e non archiviata:
    // un bootstrap non deve creare un doppione di chi è già in archivio.
    const matches = await tx.query<{ id: string }>(
      'select id from people where lower(email) = lower($1) and not archived',
      [email],
    )
    if (matches.length > 1) {
      throw new Error(`Più persone in anagrafica hanno l'email ${email}: collega l'account a mano, non alla cieca.`)
    }
    const personId =
      matches[0]?.id ??
      (await tx.one<{ id: string }>(
        `insert into people (first_name, last_name, email, kind) values ($1,$2,$3,'staff') returning id`,
        [firstName, lastName, email],
      ))!.id

    const user = (await tx.one<{ id: string }>(
      'insert into app_users (person_id, email, password_hash) values ($1,$2,$3) returning id',
      [personId, email, passwordHash],
    ))!
    await tx.query(`insert into user_roles (user_id, role) values ($1,'admin')`, [user.id])
    return { outcome: 'creato' as const, email, userId: user.id, personId }
  })
}
