import { createApp } from './app.js'
import { initDb, isManagedPostgres, pendingMigrations } from './db.js'

// Su PGlite le migrazioni partono da sole; su Postgres gestito no, per non farle
// correre a due istanze insieme: l'API si rifiuta di servire uno schema arretrato.
await initDb()
const todo = await pendingMigrations()
if (todo.length) {
  console.error(`Schema arretrato (${todo.join(', ')}). Esegui "npm run migrate" prima di avviare l'API.`)
  process.exit(1)
}

const port = Number(process.env.PORT || 3000)
createApp().listen(port, () =>
  console.log(`API in ascolto su http://localhost:${port} — database: ${isManagedPostgres() ? 'PostgreSQL gestito' : 'PGlite locale'}`),
)
