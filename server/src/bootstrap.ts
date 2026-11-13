import { asSystem } from './db.js'

/**
 * Primo amministratore del club.
 *
 * Non è un seed: non inventa squadre, stagioni o utenti di prova. Collega una
 * identità già esistente in **Supabase Auth** alla terna minima e coerente
 * `people` → `app_users` → `user_roles('admin')`, in UNA transazione: o esiste
 * tutto o non esiste niente.
 *
 * Le password non passano di qui e non stanno in questo database: le custodisce
 * Supabase Auth. L'identità si crea una volta sola, dal pannello Supabase
 * (Authentication → Users → Invite), perché finché non c'è un amministratore non
 * c'è nessuno che possa usare la Edge Function degli inviti.
 *
 * Regole di sicurezza:
 * - idempotente: se l'account esiste già, non viene riscritto;
 * - se un altro amministratore esiste già il comando si ferma, salvo consenso
 *   esplicito (`addition: true`): il bootstrap è un atto unico, non un modo per
 *   aggiungere poteri di nascosto;
 * - nessuna registrazione pubblica, qui né altrove.
 */

// Lock consultivo: due bootstrap lanciati insieme non creano due amministratori.
const BOOTSTRAP_LOCK = 4150973022

export type BootstrapOutcome = 'creato' | 'ruolo-aggiunto' | 'già-presente'

export interface BootstrapInput {
  email: string
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
  authUserId: string
}

export class BootstrapError extends Error {}

export function validateEmail(email: string): string | null {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? null : 'Indirizzo email non valido.'
}

export async function bootstrapAdmin(input: BootstrapInput): Promise<BootstrapResult> {
  const email = input.email.trim().toLowerCase()
  const invalid = validateEmail(email)
  if (invalid) throw new BootstrapError(invalid)
  if (!input.firstName.trim() || !input.lastName.trim()) {
    throw new BootstrapError('Nome e cognome sono obbligatori.')
  }

  return asSystem(async (tx) => {
    await tx.query('select pg_advisory_xact_lock($1)', [BOOTSTRAP_LOCK])

    // L'identità dev'essere già in Supabase Auth: qui non si creano credenziali.
    const identity = await findAuthUser(tx, email)
    if (!identity) {
      throw new BootstrapError(
        `Nessuna identità Supabase Auth per ${email}.\n`
        + 'Creala prima dal pannello Supabase: Authentication → Users → Invite user,\n'
        + "poi rilancia questo comando. La password la imposta la persona dal link dell'invito.",
      )
    }

    const existing = await tx.one<any>(
      'select id, person_id, auth_user_id from app_users where lower(email) = lower($1)', [email])

    const otherAdmin = await tx.one<any>(
      `select 1 from user_roles r join app_users u on u.id = r.user_id
        where r.role = 'admin' and lower(u.email) <> lower($1)`, [email])
    if (otherAdmin && !input.addition) {
      throw new BootstrapError(
        'Esiste già un amministratore. Gli accessi successivi si creano per invito, '
        + 'dalla segreteria. Per forzare aggiungi --aggiungi.',
      )
    }

    if (existing) {
      // Account già presente: al massimo gli colleghiamo l'identità e il ruolo.
      if (!existing.auth_user_id) {
        await tx.query('update app_users set auth_user_id = $1, active = true where id = $2',
          [identity, existing.id])
      } else if (existing.auth_user_id !== identity) {
        throw new BootstrapError(
          "Questo account è già collegato a un'altra identità Supabase. Scollegala prima di procedere.",
        )
      }
      const hadRole = await tx.one(
        `select 1 from user_roles where user_id = $1 and role = 'admin'`, [existing.id])
      if (!hadRole) {
        await tx.query(`insert into user_roles (user_id, role) values ($1,'admin')`, [existing.id])
      }
      return {
        outcome: hadRole ? 'già-presente' : 'ruolo-aggiunto',
        email, userId: existing.id, personId: existing.person_id, authUserId: identity,
      }
    }

    const person = await tx.one<any>(
      `insert into people (first_name, last_name, kind, email) values ($1,$2,'staff',$3) returning id`,
      [input.firstName.trim(), input.lastName.trim(), email])
    const user = await tx.one<any>(
      `insert into app_users (person_id, email, auth_user_id) values ($1,$2,$3) returning id`,
      [person!.id, email, identity])
    await tx.query(`insert into user_roles (user_id, role) values ($1,'admin')`, [user!.id])

    return {
      outcome: 'creato', email, userId: user!.id, personId: person!.id, authUserId: identity,
    }
  })
}

/**
 * Cerca l'identità in `auth.users`. Fuori da Supabase lo schema `auth` esiste solo
 * come shim (migrazione 0009) e la tabella non c'è: lo diciamo invece di fingere.
 */
async function findAuthUser(tx: { one: (sql: string, p?: unknown[]) => Promise<any> },
                            email: string): Promise<string | null> {
  const present = await tx.one(`select to_regclass('auth.users') is not null as ok`)
  if (!present?.ok) {
    throw new BootstrapError(
      "Questo database non ha `auth.users`: il bootstrap dell'amministratore si lancia "
      + 'contro il progetto Supabase, non contro il database locale di sviluppo.',
    )
  }
  try {
    const row = await tx.one('select id from auth.users where lower(email) = lower($1)', [email])
    return row?.id ?? null
  } catch {
    throw new BootstrapError(
      'Lettura di `auth.users` negata: lancia il comando con la connessione DIRETTA del '
      + 'ruolo proprietario (MIGRATION_DATABASE_URL), non con il ruolo applicativo.',
    )
  }
}
