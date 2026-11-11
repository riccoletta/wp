import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export type Row = Record<string, any>
export interface Tx {
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>
  one<T = Row>(sql: string, params?: unknown[]): Promise<T | undefined>
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const migrationsDir = path.join(root, 'db/migrations')

interface Driver {
  exec(sql: string): Promise<void>
  tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T>
  close(): Promise<void>
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

async function pgliteDriver(dir: string | undefined): Promise<Driver> {
  const { PGlite } = await import('@electric-sql/pglite')
  // Forma a oggetto: con `new PGlite(dir, opts)` l'opzione parsers verrebbe ignorata.
  const db = new PGlite({ dataDir: dir, parsers: { [DATE_OID]: (v: string) => v } })
  await db.waitReady
  return {
    exec: (sql) => db.exec(sql).then(() => undefined),
    tx: (fn) => db.transaction((t) => fn(wrap((sql, p) => t.query(sql, p).then((r: any) => r.rows)))) as any,
    close: () => db.close(),
  }
}

async function pgDriver(url: string): Promise<Driver> {
  const { default: pg } = await import('pg')
  pg.types.setTypeParser(DATE_OID, (v: string) => v)
  const pool = new pg.Pool({ connectionString: url })
  return {
    exec: async (sql) => { await pool.query(sql) },
    async tx(fn) {
      const c = await pool.connect()
      try {
        await c.query('begin')
        const out = await fn(wrap((sql, p) => c.query(sql, p as any[]).then((r) => r.rows)))
        await c.query('commit')
        return out
      } catch (e) {
        await c.query('rollback').catch(() => {})
        throw e
      } finally {
        c.release()
      }
    },
    close: () => pool.end(),
  }
}

let driver: Driver | undefined

export async function initDb(opts: { memory?: boolean } = {}) {
  if (driver) return
  const url = process.env.DATABASE_URL
  driver = url
    ? await pgDriver(url)
    : await pgliteDriver(opts.memory ? undefined : path.resolve(root, process.env.PGLITE_DIR || './db/data'))
  await migrate()
}

export async function closeDb() {
  await driver?.close()
  driver = undefined
}

async function migrate() {
  const d = driver!
  await d.exec(`create table if not exists schema_migrations (
    version text primary key, applied_at timestamptz not null default now())`)
  const applied = new Set(
    (await d.tx((t) => t.query<{ version: string }>('select version from schema_migrations'))).map((r) => r.version),
  )
  for (const file of (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort()) {
    if (applied.has(file)) continue
    const sql = await readFile(path.join(migrationsDir, file), 'utf8')
    await d.exec(sql)
    await d.exec(`insert into schema_migrations (version) values ('${file}')`)
  }
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
 */
export function asUser<T>(userId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return driver!.tx(async (tx) => {
    await tx.query(`select set_config('app.user_id', $1, true)`, [userId ?? ''])
    await tx.query('set local role app_user')
    return fn(tx)
  })
}
