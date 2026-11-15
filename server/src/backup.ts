import { writeFile, readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { asSystem, type Row, type Tx } from './db.js'

/**
 * Copia di sicurezza logica del database, prima di una migrazione.
 *
 * Non sostituisce `pg_dump` né i backup della piattaforma: è una fotografia
 * **completa e verificata** dei dati — tutte le righe di tutte le tabelle di
 * `public`, più la mappa delle identità Supabase — con tre proprietà che qui
 * servono più della fedeltà byte a byte:
 *
 *   1) si verifica da sé (conteggi contro il database, chiavi esterne risolte
 *      dentro la fotografia stessa): una copia che non si rilegge non è una copia;
 *   2) si rimette dentro (`restore`), e il giro completo è provato da un test;
 *   3) si confronta con il database di adesso (`compare`), che è il modo di
 *      dimostrare che una migrazione non ha perso né cambiato niente.
 *
 * Delle identità si prendono id, email e date: **mai** gli hash delle password,
 * che stanno in Supabase Auth e non devono finire in un file su un portatile.
 */

export interface ForeignKey {
  name: string
  table: string
  columns: string[]
  refTable: string
  refColumns: string[]
}

export interface Snapshot {
  takenAt: string
  database: string
  role: string
  migrations: string[]
  foreignKeys: ForeignKey[]
  /** Tutte le righe, tabella per tabella. */
  tables: Record<string, Row[]>
  /** Identità Supabase Auth: solo il minimo per ricollegare gli account. */
  authUsers: Row[]
  /** Tabelle non copiate, e perché. Una copia deve dire anche quello che non contiene. */
  skipped: { table: string; reason: string }[]
  /** Colonne volutamente omesse: materiale di credenziali, che in un file non ci va. */
  redacted: string[]
  counts: Record<string, number>
  /** Impronte delle relazioni e degli importi: quello che un confronto deve ritrovare uguale. */
  relations: Record<string, Row[]>
}

/**
 * Stato di autenticazione effimero dell'epoca Express: nessun dato della società,
 * e token in chiaro che in un file su un portatile non devono finire. Le credenziali
 * vere stanno in Supabase Auth, che ha i suoi backup.
 */
const SKIP_TABLES: Record<string, string> = {
  sessions: 'sessioni scadute dell\'autenticazione precedente: nessun dato di società',
  login_attempts: 'freno ai tentativi di accesso: stato effimero, nessun dato di società',
}

/** Colonne che portano materiale di credenziali: si contano, non si copiano. */
const REDACT: Record<string, string[]> = {
  app_users: ['password_hash'],
  invites: ['token_hash'],
}

const listTables = (tx: Tx) => tx.query<{ table_name: string }>(
  `select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`)
  .then((rs) => rs.map((r) => r.table_name))

/**
 * Le chiavi esterne si leggono da `pg_constraint`, non da `information_schema`:
 * con le chiavi COMPOSITE di M10 quest'ultimo restituisce il prodotto incrociato
 * delle colonne, e un controllo costruito su quel prodotto vede guasti che non ci sono.
 */
const listForeignKeys = (tx: Tx) => tx.query<any>(
  `select c.conname as name, src.relname as tbl, tgt.relname as ref_table,
          (select array_agg(a.attname order by k.ord)
             from unnest(c.conkey) with ordinality k(attnum, ord)
             join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as cols,
          (select array_agg(a.attname order by k.ord)
             from unnest(c.confkey) with ordinality k(attnum, ord)
             join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum) as ref_cols
     from pg_constraint c
     join pg_class src on src.oid = c.conrelid
     join pg_class tgt on tgt.oid = c.confrelid
     join pg_namespace n on n.oid = src.relnamespace
    where c.contype = 'f' and n.nspname = 'public'
    order by src.relname, c.conname`)
  .then((rs) => rs.map((r): ForeignKey => ({
    name: r.name, table: r.tbl, columns: r.cols, refTable: r.ref_table, refColumns: r.ref_cols,
  })))

/** Impronte che un confronto prima/dopo deve ritrovare identiche. */
async function relations(tx: Tx, tables: string[]): Promise<Record<string, Row[]>> {
  const out: Record<string, Row[]> = {}
  // Nessun `try`: una query che fallisce aborte­rebbe la transazione della copia.
  // Si chiede soltanto quello che le tabelle presenti permettono di chiedere.
  const add = async (name: string, sql: string) => { out[name] = await tx.query(sql) }
  if (tables.includes('people')) {
    await add('persone per tipo', `select kind, archived, count(*)::int as n from people
                                   group by kind, archived order by kind, archived`)
  }
  if (tables.includes('app_users')) {
    await add('account e identità', `select count(*)::int as account,
        count(auth_user_id)::int as con_identita, count(*) filter (where active)::int as attivi
        from app_users`)
    await add('ruoli assegnati', `select r.role, count(*)::int as n from user_roles r
                                  group by r.role order by r.role`)
  }
  if (tables.includes('team_memberships')) {
    await add('rose per squadra', `select t.name, count(m.*)::int as atleti
        from teams t left join team_memberships m on m.team_id = t.id
        group by t.id, t.name order by t.name`)
  }
  if (tables.includes('coach_assignments')) {
    await add('allenatori per squadra', `select t.name, count(c.*)::int as allenatori
        from teams t left join coach_assignments c on c.team_id = t.id
        group by t.id, t.name order by t.name`)
  }
  if (tables.includes('registrations')) {
    await add('tesseramenti per stato', `select status, count(*)::int as n from registrations
                                         group by status order by status`)
  }
  if (tables.includes('dues')) {
    await add('quote', `select count(*)::int as quote, coalesce(sum(amount_cents),0)::bigint as dovuto_cent
                        from dues`)
  }
  if (tables.includes('payment_records')) {
    await add('versamenti', `select count(*)::int as versamenti,
                             coalesce(sum(amount_cents),0)::bigint as incassato_cent from payment_records`)
  }
  if (tables.includes('medical_expiries')) {
    await add('certificati', `select count(*)::int as n from medical_expiries`)
  }
  if (tables.includes('guardian_links')) {
    await add('legami tutore-minore', `select count(*)::int as n from guardian_links`)
  }
  return out
}

export async function snapshot(): Promise<Snapshot> {
  return asSystem(async (tx) => {
    const info = await tx.one<any>(
      'select current_database() as db, current_user as ruolo')
    const tables = await listTables(tx)
    const migrations = await tx.query<any>('select version from schema_migrations order by version')
      .then((rs) => rs.map((r) => r.version as string)).catch(() => [])

    const data: Record<string, Row[]> = {}
    const counts: Record<string, number> = {}
    const skipped: { table: string; reason: string }[] = []
    const redacted: string[] = []
    for (const t of tables) {
      // Il conteggio si fa comunque, anche per le tabelle che non si copiano:
      // una copia deve sapere che cosa ha lasciato indietro.
      counts[t] = (await tx.one<any>(`select count(*)::int as n from ${quote(t)}`))!.n
      if (SKIP_TABLES[t]) { skipped.push({ table: t, reason: SKIP_TABLES[t]! }); continue }
      const omit = REDACT[t] ?? []
      if (omit.length) {
        const cols = await tx.query<any>(
          `select column_name from information_schema.columns
            where table_schema = 'public' and table_name = $1 order by ordinal_position`, [t])
          .then((rs) => rs.map((r) => r.column_name as string))
        const keep = cols.filter((c) => !omit.includes(c))
        for (const c of omit) if (cols.includes(c)) redacted.push(`${t}.${c}`)
        data[t] = await tx.query(`select ${keep.map(quote).join(',')} from ${quote(t)}`)
      } else {
        data[t] = await tx.query(`select * from ${quote(t)}`)
      }
    }

    // Identità Supabase: niente password, niente token. Solo quello che serve a
    // ricollegare `app_users.auth_user_id` se un giorno si dovesse rifare il giro.
    // Si guarda prima se la tabella c'è: una query che fallisce abortirebbe la
    // transazione, e con lei tutta la copia (fuori da Supabase `auth.users` non esiste).
    const hasAuth = await tx.one<any>(`select to_regclass('auth.users') is not null as ok`)
    const authUsers = hasAuth?.ok
      ? await tx.query<any>(
          `select id, email, created_at, last_sign_in_at, email_confirmed_at from auth.users order by email`)
      : []

    return {
      takenAt: new Date().toISOString(),
      database: info!.db, role: info!.ruolo,
      migrations,
      foreignKeys: await listForeignKeys(tx),
      tables: data,
      authUsers,
      skipped,
      redacted,
      counts,
      relations: await relations(tx, tables),
    }
  })
}

const quote = (ident: string) => `"${ident.replace(/"/g, '""')}"`

/**
 * Una copia va riletta, altrimenti è un file e basta. Qui si controlla che la
 * fotografia sia internamente coerente: conteggi coerenti con le righe salvate e
 * ogni riferimento risolto dentro la fotografia stessa.
 */
export function verifySnapshot(s: Snapshot): string[] {
  const problems: string[] = []
  for (const [table, rows] of Object.entries(s.tables)) {
    if (s.counts[table] !== rows.length) {
      problems.push(`${table}: dichiarate ${s.counts[table]} righe, salvate ${rows.length}`)
    }
  }
  const composite = (r: Row, cols: string[]) => cols.map((c) => String(r[c])).join('\u0000')
  for (const fk of s.foreignKeys) {
    const child = s.tables[fk.table]
    const parent = s.tables[fk.refTable]
    if (!child || !parent) continue
    const keys = new Set(parent.map((r) => composite(r, fk.refColumns)))
    // In SQL una chiave esterna con una colonna nulla non si controlla: qui uguale.
    const dangling = child.filter((r) =>
      fk.columns.every((c) => r[c] !== null && r[c] !== undefined)
      && !keys.has(composite(r, fk.columns)))
    if (dangling.length) {
      problems.push(`${fk.name} (${fk.table}.${fk.columns.join('+')} → `
        + `${fk.refTable}.${fk.refColumns.join('+')}): ${dangling.length} riferimenti non risolti`)
    }
  }
  if (Object.keys(s.tables).length === 0) problems.push('nessuna tabella salvata')
  return problems
}

export async function writeSnapshot(file: string): Promise<{ snapshot: Snapshot; problems: string[] }> {
  const s = await snapshot()
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(s, null, 1), 'utf8')
  // Riletta dal disco, non dalla memoria: è il file che deve valere qualcosa.
  const reread = JSON.parse(await readFile(file, 'utf8')) as Snapshot
  return { snapshot: reread, problems: verifySnapshot(reread) }
}

export const readSnapshot = async (file: string) =>
  JSON.parse(await readFile(file, 'utf8')) as Snapshot

export interface Difference { voce: string; prima: string; dopo: string }

/** Confronto fra la fotografia e il database di adesso: conteggi, relazioni, identità. */
export async function compare(before: Snapshot): Promise<Difference[]> {
  const now = await snapshot()
  const out: Difference[] = []

  for (const table of Object.keys(before.counts)) {
    const prima = before.counts[table]!
    const dopo = now.counts[table]
    if (dopo === undefined) { out.push({ voce: `tabella ${table}`, prima: 'presente', dopo: 'SPARITA' }); continue }
    if (prima !== dopo) out.push({ voce: `righe ${table}`, prima: String(prima), dopo: String(dopo) })
  }

  const key = (r: Row) => JSON.stringify(r)
  for (const [name, rows] of Object.entries(before.relations)) {
    const after = now.relations[name]
    if (!after) { out.push({ voce: name, prima: 'rilevata', dopo: 'non rilevabile' }); continue }
    const a = rows.map(key).sort().join('|')
    const b = after.map(key).sort().join('|')
    if (a !== b) out.push({ voce: name, prima: compact(rows), dopo: compact(after) })
  }

  const identita = (s: Snapshot) => s.authUsers.map((u) => `${u.email}:${u.id}`).sort().join(',')
  if (identita(before) !== identita(now)) {
    out.push({ voce: 'identità Supabase Auth', prima: `${before.authUsers.length}`, dopo: `${now.authUsers.length}` })
  }

  // Il legame fra account applicativo e identità: quello che non deve mai rompersi.
  const legame = (s: Snapshot) => (s.tables['app_users'] ?? [])
    .map((u) => `${String(u.email).toLowerCase()}→${u.auth_user_id ?? 'nessuna'}`).sort().join(',')
  if (legame(before) !== legame(now)) {
    out.push({ voce: 'account ↔ identità Supabase', prima: legame(before), dopo: legame(now) })
  }

  return out
}

const compact = (rows: Row[]) => JSON.stringify(rows).slice(0, 120)

/**
 * Rimette dentro le righe della fotografia, in ordine di dipendenza e senza
 * sovrascrivere nulla (`on conflict do nothing`): serve a recuperare ciò che
 * manca, non a riscrivere il presente. Restituisce quante righe ha inserito.
 */
export async function restore(s: Snapshot): Promise<Record<string, number>> {
  const order = topological(Object.keys(s.tables), s.foreignKeys)

  const inserted: Record<string, number> = {}

  return asSystem(async (tx) => {
    for (const table of order) {
      const rows = s.tables[table] ?? []
      if (rows.length === 0 || table === 'schema_migrations') continue
      let n = 0
      for (const row of rows) {
        const cols = Object.keys(row)
        const values = cols.map((c) => row[c])
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(',')
        const done = await tx.query(
          `insert into ${quote(table)} (${cols.map(quote).join(',')}) values (${placeholders})
           on conflict do nothing returning 1 as ok`, values)
        n += done.length
      }
      inserted[table] = n
    }
    return inserted
  })
}

/** Padri prima dei figli. Le autoreferenze non contano: una tabella non aspetta sé stessa. */
function topological(tables: string[], fks: ForeignKey[]): string[] {
  const deps = new Map(tables.map((t) => [t, new Set<string>()]))
  for (const fk of fks) {
    if (fk.table === fk.refTable) continue
    if (deps.has(fk.table) && tables.includes(fk.refTable)) deps.get(fk.table)!.add(fk.refTable)
  }

  const out: string[] = []
  const seen = new Set<string>()
  const visit = (t: string, stack: Set<string>) => {
    if (seen.has(t) || stack.has(t)) return
    stack.add(t)
    for (const d of deps.get(t) ?? []) visit(d, stack)
    stack.delete(t)
    seen.add(t)
    out.push(t)
  }
  for (const t of tables) visit(t, new Set())
  return out
}
