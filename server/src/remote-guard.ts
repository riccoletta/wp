/**
 * Da M10 il database remoto non si tocca più dal terminale.
 *
 * Migrazioni, verifiche e promozioni si incollano nel SQL Editor del pannello
 * Supabase (`db/deploy/`, nell'ordine scritto lì). Questi strumenti restano per
 * lo sviluppo locale su PGlite e per le prove: se li si punta per sbaglio su un
 * database remoto, si fermano prima di aprire la connessione.
 *
 * La scappatoia esiste ed è dichiarata (`ALLOW_REMOTE_DB=true`), perché una
 * protezione che non si può togliere prima o poi la si aggira di nascosto.
 */
const LOCALI = new Set(['localhost', '127.0.0.1', '::1', ''])

export function refuseRemoteDatabase(comando: string): void {
  if (process.env.ALLOW_REMOTE_DB === 'true') return
  const url = (process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL || '').trim()
  if (!url) return // PGlite: nessuna connessione di rete
  let host = ''
  try { host = new URL(url).hostname } catch { host = '' }
  if (LOCALI.has(host)) return

  throw new Error(
    `${comando} non parla con il database remoto (${host}).\n`
    + 'Da M10 lo schema remoto si cambia dal pannello Supabase: apri SQL Editor e incolla\n'
    + 'gli script di db/deploy/ nell\'ordine indicato in db/deploy/README.md.\n'
    + 'Per lo sviluppo locale togli DATABASE_URL (si usa PGlite su db/data).',
  )
}
