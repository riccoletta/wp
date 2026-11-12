import { readdir, readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export type Row = Record<string, any>
export interface Tx {
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>
  one<T = Row>(sql: string, params?: unknown[]): Promise<T | undefined>
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const migrationsDir = path.join(root, 'db/migrations')

// `.env` della radice, con il caricatore incluso in Node: nessuna dipendenza nuova.
// Le variabili già presenti nell'ambiente vincono, quindi il file non sovrascrive
// nulla di ciò che il deploy ha impostato davvero.
try { process.loadEnvFile(path.join(root, '.env')) } catch { /* nessun .env: normale in produzione */ }

// Chiave del lock consultivo: impedisce che due processi (due istanze serverless,
// un deploy in corso) applichino le stesse migrazioni contemporaneamente.
const MIGRATION_LOCK = 4150973021

const SCHEMA_MIGRATIONS = `create table if not exists schema_migrations (
  version text primary key, applied_at timestamptz not null default now())`

interface Migration { name: string; sql: string }

interface Driver {
  exec(sql: string): Promise<void>
  tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T>
  close(): Promise<void>
  /** Applica le migrazioni mancanti e restituisce i nomi di quelle applicate. */
  migrate(files: Migration[]): Promise<string[]>
  /** Nomi delle migrazioni non ancora applicate. */
  pending(files: Migration[]): Promise<string[]>
}

function wrap(q: (sql: string, params: unknown[]) => Promise<Row[]>): Tx {
  return {
    query: (sql, params = []) => q(sql, params) as any,
    one: async (sql, params = []) => (await q(sql, params))[0] as any,
  }
}

// Le colonne `date` restano stringhe 'YYYY-MM-DD': convertirle in Date sposterebbe
// il giorno a seconda del fuso. Le date qui sono giorni di calendario, non istanti.
const DATE_OID = 1082

async function loadMigrations(): Promise<Migration[]> {
  const names = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort()
  return Promise.all(names.map(async (name) => ({ name, sql: await readFile(path.join(migrationsDir, name), 'utf8') })))
}

async function pgliteDriver(dir: string | undefined): Promise<Driver> {
  const { PGlite } = await import('@electric-sql/pglite')
  // Forma a oggetto: con `new PGlite(dir, opts)` l'opzione parsers verrebbe ignorata.
  const db = new PGlite({ dataDir: dir, parsers: { [DATE_OID]: (v: string) => v } })
  await db.waitReady
  const applied = async () => {
    await db.exec(SCHEMA_MIGRATIONS)
    const r = await db.query<{ version: string }>('select version from schema_migrations')
    return new Set(r.rows.map((x) => x.version))
  }
  return {
    exec: (sql) => db.exec(sql).then(() => undefined),
    tx: (fn) => db.transaction((t) => fn(wrap((sql, p) => t.query(sql, p).then((r: any) => r.rows)))) as any,
    close: () => db.close(),
    // PGlite è un singolo processo su un file locale: nessuna corsa da arbitrare.
    async migrate(files) {
      const done: string[] = []
      const seen = await applied()
      for (const f of files) {
        if (seen.has(f.name)) continue
        await db.exec(f.sql)
        await db.query('insert into schema_migrations (version) values ($1)', [f.name])
        done.push(f.name)
      }
      return done
    },
    async pending(files) {
      const seen = await applied()
      return files.filter((f) => !seen.has(f.name)).map((f) => f.name)
    },
  }
}

/**
 * TLS verso il Postgres gestito. Il default è verifica piena con le CA di sistema
 * (il Transaction Pooler di Supabase presenta un certificato pubblico valido).
 * `DATABASE_CA_CERT` accetta un PEM inline o un percorso di file; `DATABASE_SSL`
 * vale `disable` (solo Postgres locale) o `no-verify` (sconsigliato, va annunciato).
 */
function sslConfig(url: string) {
  const mode = (process.env.DATABASE_SSL || '').trim().toLowerCase()
  const host = (() => { try { return new URL(url).hostname } catch { return '' } })()
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1'
  if (mode === 'disable' || (!mode && local)) return false
  if (mode === 'no-verify') {
    console.warn('ATTENZIONE: DATABASE_SSL=no-verify, il certificato del database non viene verificato.')
    return { rejectUnauthorized: false }
  }
  const cert = process.env.DATABASE_CA_CERT?.trim()
  return { rejectUnauthorized: true, ...(cert ? { ca: resolveCaCert(cert) } : {}) }
}

/**
 * La CA può arrivare come PEM inline, con `\n` letterali o in base64 (su Vercel è una
 * variabile d'ambiente), oppure come percorso di file (solo in sviluppo, sulla macchina
 * che quel file ce l'ha davvero). Un percorso che non esiste non è un motivo per
 * abbassare la verifica TLS: è un errore di configurazione e va detto a voce alta.
 */
export function resolveCaCert(value: string): string {
  const text = value.includes('\\n') ? value.replace(/\\n/g, '\n') : value
  if (text.includes('-----BEGIN')) return text
  if (text.length > 200 && /^[A-Za-z0-9+/=\s]+$/.test(text)) {
    const decoded = Buffer.from(text, 'base64').toString('utf8')
    if (decoded.includes('-----BEGIN')) return decoded
  }
  try {
    const pem = readFileSync(path.resolve(root, text), 'utf8')
    if (!pem.includes('-----BEGIN')) throw new Error('il file non contiene un certificato PEM')
    return pem
  } catch (err) {
    throw new Error(
      `DATABASE_CA_CERT non è un certificato utilizzabile ("${text.slice(0, 40)}"...): ` +
        'in un ambiente serverless va messo il PEM, anche in base64, non il percorso di un file locale. ' +
        `Dettaglio: ${err instanceof Error ? err.message : err}`,
    )
  }
}

async function pgDriver(url: string): Promise<Driver> {
  const { default: pg } = await import('pg')
  pg.types.setTypeParser(DATE_OID, (v: string) => v)
  // Serverless (Vercel) + Transaction Pooler: poche connessioni per istanza, rilascio rapido.
  // Nessuna query preparata con nome: il pooler in modalità transazione non le supporta.
  const serverless = !!process.env.VERCEL
  const pool = new pg.Pool({
    connectionString: url,
    ssl: sslConfig(url),
    max: Number(process.env.DATABASE_POOL_MAX || (serverless ? 1 : 10)),
    idleTimeoutMillis: Number(process.env.DATABASE_POOL_IDLE_MS || (serverless ? 10_000 : 30_000)),
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: serverless,
    application_name: 'pallanuoto',
    statement_timeout: Number(process.env.DATABASE_STATEMENT_TIMEOUT_MS || 15_000),
  })
  // Il pooler chiude le connessioni inattive: l'errore arriva sul client in attesa,
  // non deve abbattere il processo.
  pool.on('error', (err) => console.error('Connessione al database caduta:', err.message))

  const withClient = async <T>(fn: (c: any) => Promise<T>) => {
    const c = await pool.connect()
    try { return await fn(c) } finally { c.release() }
  }

  return {
    exec: async (sql) => { await pool.query(sql) },
    async tx(fn) {
      return withClient(async (c) => {
        try {
          await c.query('begin')
          const out = await fn(wrap((sql, p) => c.query(sql, p as any[]).then((r: any) => r.rows)))
          await c.query('commit')
          return out
        } catch (e) {
          await c.query('rollback').catch(() => {})
          throw e
        }
      })
    },
    close: () => pool.end(),
    // Tutte le migrazioni in UNA transazione su UNA connessione, protetta da lock
    // consultivo di transazione: due processi che partono insieme non si sovrappongono
    // e un errore a metà non lascia lo schema a pezzi. Nessun reset, nessun drop.
    async migrate(files) {
      return withClient(async (c) => {
        try {
          await c.query('begin')
          await c.query('select pg_advisory_xact_lock($1)', [MIGRATION_LOCK])
          await c.query(SCHEMA_MIGRATIONS)
          const seen = new Set((await c.query('select version from schema_migrations')).rows.map((r: Row) => r.version))
          const done: string[] = []
          for (const f of files) {
            if (seen.has(f.name)) continue
            await c.query(f.sql)
            await c.query('insert into schema_migrations (version) values ($1)', [f.name])
            done.push(f.name)
          }
          await c.query('commit')
          return done
        } catch (e) {
          await c.query('rollback').catch(() => {})
          throw e
        }
      })
    },
    async pending(files) {
      await pool.query(SCHEMA_MIGRATIONS)
      const seen = new Set((await pool.query('select version from schema_migrations')).rows.map((r: Row) => r.version))
      return files.filter((f) => !seen.has(f.name)).map((f) => f.name)
    },
  }
}

let driver: Driver | undefined
let usingPostgres = false

export function isManagedPostgres() { return usingPostgres }

/**
 * `migrate`: su PGlite le migrazioni partono da sole (sviluppo e test).
 * Su Postgres gestito NO: si applicano con `npm run migrate`, fuori dall'avvio
 * dell'API, così più istanze non migrano in parallelo. `AUTO_MIGRATE=true` forza.
 */
export async function initDb(opts: { memory?: boolean; migrate?: boolean } = {}) {
  if (driver) return
  const url = process.env.DATABASE_URL?.trim()
  usingPostgres = !!url
  driver = url
    ? await pgDriver(url)
    : await pgliteDriver(opts.memory ? undefined : path.resolve(root, process.env.PGLITE_DIR || './db/data'))
  const auto = opts.migrate ?? (!url || process.env.AUTO_MIGRATE === 'true')
  if (auto) await runMigrations()
}

export async function closeDb() {
  await driver?.close()
  driver = undefined
  usingPostgres = false
}

export async function runMigrations(): Promise<string[]> {
  return driver!.migrate(await loadMigrations())
}

export async function pendingMigrations(): Promise<string[]> {
  return driver!.pending(await loadMigrations())
}

/**
 * Transazione di sistema: gira come proprietario del database, quindi IGNORA la RLS.
 * Usarla soltanto per autenticazione (login, sessioni, inviti accettati) e migrazioni/seed.
 */
export function asSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return driver!.tx(fn)
}

/**
 * Transazione applicativa: assume il ruolo app_user e pubblica l'identità come
 * app.user_id. Da qui in poi i permessi li decide la RLS, non il codice.
 * `set local` vive solo nella transazione: compatibile con il pooler in modalità transazione.
 */
export function asUser<T>(userId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return driver!.tx(async (tx) => {
    await tx.query(`select set_config('app.user_id', $1, true)`, [userId ?? ''])
    await tx.query('set local role app_user')
    return fn(tx)
  })
}
