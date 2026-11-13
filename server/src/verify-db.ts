import { asAnon, asDataApi, asSystem, closeDb, initDb, isManagedPostgres, pendingMigrations } from './db.js'

// Prova sul database VERO (quello puntato da DATABASE_URL, altrimenti PGlite) che
// l'impianto di sicurezza della Data API regga: anonimo che non raggiunge nulla,
// identità che arriva da auth.uid(), dati sensibili dell'autenticazione invisibili,
// licenza non scrivibile dal club, ruoli non assegnabili da sé.
// Non scrive nulla: nessuna riga creata, nessuna migrazione applicata.

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures++
  console.log(`${ok ? 'OK  ' : 'NO  '} ${name}${detail ? ` — ${detail}` : ''}`)
}

/** Il codice SQLSTATE di una query che deve fallire, o `'passata'` se è riuscita. */
const refused = (run: () => Promise<unknown>) =>
  run().then(() => 'passata').catch((e: any) => e?.code ?? e?.message ?? 'errore')

const denied = (code: string) => code === '42501' || /permission denied/i.test(code)

try {
  await initDb({ migrate: false })
  console.log(isManagedPostgres() ? 'Database: PostgreSQL gestito (DATABASE_URL).' : 'Database: PGlite locale.')

  const info = await asSystem((t) =>
    t.one<{ v: string; u: string }>('select version() as v, current_user as u'))
  check('connessione al database', !!info, info?.v.split(' ').slice(0, 2).join(' '))

  const todo = await pendingMigrations()
  check('schema aggiornato', todo.length === 0, todo.length ? `mancano: ${todo.join(', ')}` : 'tutte applicate')

  // --- Utente anonimo: non deve raggiungere niente ------------------------------
  const anonPeople = await refused(() => asAnon((t) => t.query('select 1 from people')))
  check('anonimo: nessun accesso alle persone', denied(anonPeople), `esito ${anonPeople}`)
  const anonRpc = await refused(() => asAnon((t) => t.query('select api_people_list()')))
  check('anonimo: nessuna chiamata RPC', denied(anonRpc), `esito ${anonRpc}`)

  // --- Utente autenticato senza identità collegata ------------------------------
  const ctx = await asDataApi(null, (t) =>
    t.one<{ u: string; uid: string | null }>(
      `select current_user as u, (select app_uid())::text as uid`))
  check('set local role authenticated', ctx?.u === 'authenticated', `current_user=${ctx?.u}`)
  check('identità risolta da auth.uid()', ctx?.uid === null, `app_uid()=${ctx?.uid ?? 'null'}`)

  const total = await asSystem((t) => t.one<{ n: string }>('select count(*)::text as n from people'))
  const seen = await asDataApi(null, (t) => t.one<{ n: string }>('select count(*)::text as n from people'))
  check('RLS: senza identità non si legge nessuna persona', seen?.n === '0',
    `in tabella ${total?.n}, visibili ${seen?.n}`)

  // --- Dati sensibili dell'autenticazione ---------------------------------------
  for (const [name, sql] of [
    ['sessions', 'select 1 from sessions'],
    ['login_attempts', 'select 1 from login_attempts'],
    ['invites', 'select 1 from invites'],
    ['password_hash', 'select password_hash from app_users'],
  ] as const) {
    const code = await refused(() => asDataApi(null, (t) => t.query(sql)))
    check(`${name} non raggiungibile dalla Data API`, denied(code), `esito ${code}`)
  }

  // --- Licenza e ruoli: non scrivibili da chi passa dalla Data API --------------
  const lic = await refused(() => asDataApi(null, (t) => t.query(`update license set note = 'x'`)))
  check('licenza non scrivibile dal club', denied(lic), `esito ${lic}`)

  const roles = await refused(() => asDataApi(null, (t) =>
    t.query(`insert into user_roles (user_id, role)
             select id, 'admin' from app_users limit 1`)))
  check('ruoli non assegnabili da sé', denied(roles), `esito ${roles}`)

  // --- La superficie RPC esiste ed è raggiungibile da un utente autenticato ------
  const rpcOk = await asDataApi(null, (t) =>
    t.one<{ n: string }>(`select count(*)::text as n from pg_proc
                           where pronamespace = 'public'::regnamespace and proname like 'api\\_%'`))
  check('funzioni api_* presenti', Number(rpcOk?.n) >= 25, `${rpcOk?.n} funzioni`)

  const licState = await asDataApi(null, (t) => t.one<{ r: any }>('select api_license() as r'))
  check('stato della licenza derivato dal database', !!licState?.r?.phase,
    `fase ${licState?.r?.phase ?? '?'}, sola lettura ${licState?.r?.readOnly}`)

  // --- `anon` non deve avere privilegi, oggi né dopo le migrazioni --------------
  if (isManagedPostgres()) {
    const exposed = await asSystem((t) =>
      t.query<{ grantee: string; table_name: string }>(
        `select distinct grantee, table_name from information_schema.role_table_grants
          where table_schema = 'public' and grantee = 'anon'`))
    check('nessun privilegio di tabella per anon', exposed.length === 0, `${exposed.length} grant residui`)
  }
} catch (err) {
  failures++
  console.error('Verifica interrotta:', err instanceof Error ? err.message : err)
} finally {
  await closeDb()
}

console.log(failures ? `\n${failures} verifiche fallite.` : '\nTutte le verifiche superate.')
process.exitCode = failures ? 1 : 0
