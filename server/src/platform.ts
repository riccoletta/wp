import { asSystem } from './db.js'

/**
 * Proprietario della piattaforma.
 *
 * Non è un ruolo applicativo e non sta in `user_roles`: è una riga in
 * `platform_owners`, tabella su cui **nessun ruolo della Data API ha GRANT**.
 * L'unico modo di entrarci è questo comando, che gira con la connessione diretta
 * del ruolo proprietario del database — la stessa delle migrazioni.
 *
 * Regole:
 * - l'identità dev'essere già in Supabase Auth: qui non si creano credenziali;
 * - promuove **solo** l'indirizzo indicato: gli amministratori di società restano
 *   amministratori di società, e nessuno viene promosso "di contorno";
 * - se un proprietario esiste già il comando si ferma, salvo consenso esplicito;
 * - ogni promozione lascia una riga datata: chi, quando, con quale nota.
 */

// Lock consultivo distinto da quello del primo amministratore.
const OWNER_LOCK = 4150973023

export type PlatformOwnerOutcome = 'promosso' | 'già-presente'

export class PlatformOwnerError extends Error {}

export interface PlatformOwnerResult {
  outcome: PlatformOwnerOutcome
  email: string
  authUserId: string
  /** Società in cui questa identità è anche amministratore: le resta, non cambia nulla. */
  clubAdminOf: string[]
}

export async function promotePlatformOwner(input: {
  email: string; note?: string; addition?: boolean
}): Promise<PlatformOwnerResult> {
  const email = input.email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new PlatformOwnerError('Indirizzo email non valido.')
  }

  return asSystem(async (tx) => {
    await tx.query('select pg_advisory_xact_lock($1)', [OWNER_LOCK])

    const present = await tx.one<any>(`select to_regclass('auth.users') is not null as ok`)
    if (!present?.ok) {
      throw new PlatformOwnerError(
        'Questo database non ha `auth.users`: la promozione si lancia contro il progetto '
        + 'Supabase, non contro il database locale di sviluppo.',
      )
    }

    let identity: string | null = null
    try {
      const row = await tx.one<any>('select id from auth.users where lower(email) = lower($1)', [email])
      identity = row?.id ?? null
    } catch {
      throw new PlatformOwnerError(
        'Lettura di `auth.users` negata: lancia il comando con la connessione DIRETTA del '
        + 'ruolo proprietario (MIGRATION_DATABASE_URL), non con il ruolo applicativo.',
      )
    }
    if (!identity) {
      throw new PlatformOwnerError(
        `Nessuna identità Supabase Auth per ${email}.\n`
        + 'Creala prima dal pannello Supabase: Authentication → Users → Invite user.',
      )
    }

    const other = await tx.one<any>(
      'select email from platform_owners where auth_user_id <> $1', [identity])
    if (other && !input.addition) {
      throw new PlatformOwnerError(
        `Esiste già un proprietario della piattaforma (${other.email}). `
        + 'Per aggiungerne un altro dichiaralo con --aggiungi.',
      )
    }

    const already = await tx.one('select 1 from platform_owners where auth_user_id = $1', [identity])
    if (!already) {
      await tx.query(
        'insert into platform_owners (auth_user_id, email, note) values ($1,$2,$3)',
        [identity, email, input.note ?? null])
    }

    // Informativo: se quell'identità è anche la segreteria di una società, lo resta.
    const clubs = await tx.query<any>(
      `select distinct c.name from app_users u
         join user_roles r on r.user_id = u.id and r.role = 'admin'
         join clubs c on c.id = u.club_id
        where u.auth_user_id = $1 order by c.name`, [identity])

    return {
      outcome: already ? 'già-presente' : 'promosso',
      email,
      authUserId: identity,
      clubAdminOf: clubs.map((c) => c.name as string),
    }
  })
}

export const listPlatformOwners = () => asSystem((tx) => tx.query<any>(
  'select email, note, created_at from platform_owners order by created_at'))
