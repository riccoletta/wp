import { closeDb, initDb, isManagedPostgres } from './db.js'
import { compare, readSnapshot, restore, verifySnapshot, writeSnapshot } from './backup.js'
import { refuseRemoteDatabase } from './remote-guard.js'

// Copia di sicurezza logica, verifica, confronto prima/dopo e recupero.
//
//   npm run backup                              → nuova copia in db/backups/
//   npm run backup -- --file=<percorso>         → copia in un percorso scelto
//   npm run backup -- --verifica=<file>         → rilegge e controlla una copia
//   npm run backup -- --confronta=<file>        → confronta la copia con il database di adesso
//   npm run backup -- --ripristina=<file> --conferma
//
// Come le migrazioni, serve la connessione DIRETTA del ruolo proprietario:
// `MIGRATION_DATABASE_URL`, se impostata, prevale.
if (process.env.MIGRATION_DATABASE_URL?.trim()) {
  process.env.DATABASE_URL = process.env.MIGRATION_DATABASE_URL
}

const args = new Map<string, string>()
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a)
  if (m) args.set(m[1]!, m[2] ?? 'true')
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

try {
  refuseRemoteDatabase('npm run backup')
  await initDb({ migrate: false })
  const dove = isManagedPostgres() ? 'PostgreSQL gestito' : 'PGlite locale'

  if (args.has('verifica')) {
    const s = await readSnapshot(args.get('verifica')!)
    const problemi = verifySnapshot(s)
    console.log(`Copia del ${s.takenAt} — ${Object.keys(s.tables).length} tabelle, `
      + `${Object.values(s.counts).reduce((a, b) => a + b, 0)} righe, ${s.authUsers.length} identità.`)
    stampaEsito(problemi)
  } else if (args.has('confronta')) {
    const s = await readSnapshot(args.get('confronta')!)
    const diff = await compare(s)
    console.log(`Confronto con la copia del ${s.takenAt} (${dove}).`)
    if (diff.length === 0) console.log('\nNessuna differenza: conteggi, relazioni e identità coincidono.')
    else console.table(diff)
    process.exitCode = diff.length ? 1 : 0
  } else if (args.has('ripristina')) {
    if (args.get('conferma') !== 'true') {
      throw new Error('Il ripristino scrive sul database: aggiungi --conferma per dichiararlo.')
    }
    const s = await readSnapshot(args.get('ripristina')!)
    const inserite = await restore(s)
    console.table(Object.entries(inserite).map(([tabella, righe]) => ({ tabella, 'righe rimesse': righe })))
  } else {
    const file = args.get('file') ?? `db/backups/backup-${stamp}.json`
    const { snapshot, problems } = await writeSnapshot(file)
    console.log(`Copia di ${snapshot.database} (${dove}, ruolo ${snapshot.role}) in ${file}`)
    console.table(Object.entries(snapshot.counts).map(([tabella, righe]) => ({ tabella, righe })))
    console.log(`Identità Supabase Auth: ${snapshot.authUsers.length} (id ed email, mai le password).`)
    console.log(`Migrazioni applicate: ${snapshot.migrations.join(', ') || 'nessuna'}`)
    stampaEsito(problems)
  }
} catch (err) {
  console.error('Operazione non riuscita:', err instanceof Error ? err.message : err)
  process.exitCode = 1
} finally {
  await closeDb()
}

function stampaEsito(problemi: string[]) {
  if (problemi.length === 0) {
    console.log('\nCopia verificata: conteggi coerenti e nessun riferimento rotto.')
  } else {
    console.error('\nCopia NON affidabile:')
    for (const p of problemi) console.error(' -', p)
    process.exitCode = 1
  }
}
