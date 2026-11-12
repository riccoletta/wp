import { closeDb, initDb, isManagedPostgres, pendingMigrations, runMigrations } from './db.js'

// Le migrazioni sono un atto separato dall'avvio dell'API: si lanciano a mano
// (o in un passo di deploy dedicato), mai da più istanze in parallelo.
// Su Supabase conviene usare la connessione diretta, non il Transaction Pooler:
// MIGRATION_DATABASE_URL, se impostata, prevale.
if (process.env.MIGRATION_DATABASE_URL?.trim()) {
  process.env.DATABASE_URL = process.env.MIGRATION_DATABASE_URL
}

try {
  await initDb({ migrate: false })
  const todo = await pendingMigrations()
  if (!todo.length) {
    console.log('Nessuna migrazione da applicare: lo schema è già aggiornato.')
  } else {
    console.log(`Da applicare: ${todo.join(', ')}`)
    const done = await runMigrations()
    console.log(`Applicate: ${done.join(', ') || 'nessuna (già fatte da un altro processo)'}`)
  }
  console.log(isManagedPostgres() ? 'Database: PostgreSQL gestito (DATABASE_URL).' : 'Database: PGlite locale.')
} catch (err) {
  console.error('Migrazione fallita, schema invariato:', err instanceof Error ? err.message : err)
  process.exitCode = 1
} finally {
  await closeDb()
}
