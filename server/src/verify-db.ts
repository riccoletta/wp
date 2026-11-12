import { asSystem, asUser, closeDb, initDb, isManagedPostgres, pendingMigrations } from './db.js'

// Prova sul database VERO (quello puntato da DATABASE_URL, altrimenti PGlite) che
// l'impianto di sicurezza regga: ruolo applicativo assumibile, identità propagata,
// RLS che nasconde le righe all'utente anonimo, licenza non scrivibile da app_user.
// Non scrive nulla: nessuna riga creata, nessuna migrazione applicata.

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures++
  console.log(`${ok ? 'OK  ' : 'NO  '} ${name}${detail ? ` — ${detail}` : ''}`)
}

try {
  await initDb({ migrate: false })
  console.log(isManagedPostgres() ? 'Database: PostgreSQL gestito (DATABASE_URL).' : 'Database: PGlite locale.')

  // Da PG16 essere MEMBER non basta: serve l'opzione SET per fare `set role`.
  const info = await asSystem((t) =>
    t.one<{ v: string; u: string; can_set: boolean }>(
      `select version() as v, current_user as u,
              case when current_setting('server_version_num')::int >= 160000
                   then pg_has_role(current_user, 'app_user', 'SET')
                   else pg_has_role(current_user, 'app_user', 'MEMBER') end as can_set`,
    ),
  )
  check('connessione al database', !!info, info?.v.split(' ').slice(0, 2).join(' '))
  check('il ruolo delle migrazioni può assumere app_user', !!info?.can_set, `current_user=${info?.u}`)

  const todo = await pendingMigrations()
  check('schema aggiornato', todo.length === 0, todo.length ? `mancano: ${todo.join(', ')}` : 'tutte applicate')

  const ctx = await asUser(null, (t) =>
    t.one<{ u: string; uid: string }>(`select current_user as u, current_setting('app.user_id', true) as uid`),
  )
  check('set local role app_user', ctx?.u === 'app_user', `current_user=${ctx?.u}`)
  check("set_config('app.user_id') applicato", ctx?.uid === '', `valore anonimo="${ctx?.uid}"`)

  const total = await asSystem((t) => t.one<{ n: string }>('select count(*)::text as n from people'))
  const seen = await asUser(null, (t) => t.one<{ n: string }>('select count(*)::text as n from people'))
  check('RLS: utente anonimo non legge le persone', seen?.n === '0', `in tabella ${total?.n}, visibili ${seen?.n}`)

  const sessions = await asUser(null, (t) => t.query('select 1 from sessions').then(() => 'letta').catch((e: any) => e.code))
  check('sessions non accessibile ad app_user', sessions === '42501', `esito ${sessions}`)

  const lic = await asUser(null, (t) =>
    t.query(`update license set note = 'x'`).then(() => 'scritta').catch((e: any) => e.code),
  )
  check('licenza non scrivibile da app_user', lic === '42501', `esito ${lic}`)

  if (isManagedPostgres()) {
    const exposed = await asSystem((t) =>
      t.query<{ grantee: string; table_name: string }>(
        `select distinct grantee, table_name from information_schema.role_table_grants
          where table_schema = 'public' and grantee in ('anon', 'authenticated')`,
      ),
    )
    check('nessun privilegio per anon/authenticated', exposed.length === 0, `${exposed.length} grant residui`)
  }
} catch (err) {
  failures++
  console.error('Verifica interrotta:', err instanceof Error ? err.message : err)
} finally {
  await closeDb()
}

console.log(failures ? `\n${failures} verifiche fallite.` : '\nTutte le verifiche superate.')
process.exitCode = failures ? 1 : 0
