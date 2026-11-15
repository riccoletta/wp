import { closeDb, initDb, isManagedPostgres } from './db.js'
import { listPlatformOwners, promotePlatformOwner } from './platform.js'
import { refuseRemoteDatabase } from './remote-guard.js'

// Proprietario della piattaforma. Atto unico e manuale, come le migrazioni.
//
//   1) Pannello Supabase → Authentication → Users → Invite user (l'indirizzo qui sotto).
//   2) npm run platform:owner -- --email=nome@dominio.it --nota="contratto 2026"
//      npm run platform:owner -- --elenco     (chi è proprietario, da quando)
//
// Serve la connessione DIRETTA del ruolo proprietario: leggere `auth.users` e
// scrivere in `platform_owners` non sono poteri del ruolo applicativo.
// `MIGRATION_DATABASE_URL`, se impostata, prevale.
if (process.env.MIGRATION_DATABASE_URL?.trim()) {
  process.env.DATABASE_URL = process.env.MIGRATION_DATABASE_URL
}

const args = new Map<string, string>()
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a)
  if (m) args.set(m[1]!, m[2] ?? 'true')
}

try {
  refuseRemoteDatabase('npm run platform:owner')
  await initDb({ migrate: false })

  if (args.get('elenco') === 'true') {
    const owners = await listPlatformOwners()
    if (owners.length === 0) console.log('Nessun proprietario della piattaforma.')
    for (const o of owners) {
      console.log(`${o.email} — dal ${new Date(o.created_at).toLocaleDateString('it-IT')}`
        + (o.note ? ` (${o.note})` : ''))
    }
  } else {
    const email = args.get('email')
    if (!email) throw new Error('Serve --email=<indirizzo>.')
    const res = await promotePlatformOwner({
      email,
      note: args.get('nota'),
      addition: args.get('aggiungi') === 'true',
    })
    const where = isManagedPostgres() ? 'PostgreSQL gestito' : 'PGlite locale'
    console.log(res.outcome === 'promosso'
      ? `Proprietario della piattaforma: ${res.email} (${where}).`
      : `${res.email} era già proprietario: nessuna modifica (${where}).`)
    if (res.clubAdminOf.length > 0) {
      console.log(`Nota: questa identità è anche segreteria di ${res.clubAdminOf.join(', ')}. `
        + 'I due poteri restano distinti.')
    }
  }
} catch (err) {
  console.error('Promozione non eseguita:', err instanceof Error ? err.message : err)
  process.exitCode = 1
} finally {
  await closeDb()
}
