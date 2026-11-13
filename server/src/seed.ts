import { closeDb, initDb } from './db.js'
import { seedDemo } from './fixtures.js'

// I dati dimostrativi non entrano MAI in produzione da soli: con NODE_ENV=production
// o con un database gestito (DATABASE_URL) il seed si ferma, salvo consenso esplicito
// e dichiarato con ALLOW_DEMO_SEED=true.
const managed = !!process.env.DATABASE_URL?.trim()
const production = process.env.NODE_ENV === 'production'
if ((managed || production) && process.env.ALLOW_DEMO_SEED !== 'true') {
  console.error(
    `Seed dimostrativo rifiutato: ${production ? 'NODE_ENV=production' : 'DATABASE_URL impostata'}. ` +
      'Per forzarlo su un database non di produzione imposta ALLOW_DEMO_SEED=true.',
  )
  process.exit(1)
}

// Rieseguibile: `seedDemo` cerca-o-crea in un'unica transazione, quindi lanciarlo
// più volte non duplica nulla e un errore a metà non lascia dati parziali.
try {
  await initDb()
  const { seasonName } = await seedDemo()
  console.log(`Dati sintetici allineati sulla stagione attiva ${seasonName}.

Gli account applicativi ci sono, le credenziali no: le password vivono in Supabase
Auth. Per entrare davvero, crea in Supabase (Authentication → Users) un'identità per
ciascuna di queste email e allineane l'id con \`app_users.auth_user_id\`:
  segreteria@example.test   (admin)
  coach.a@example.test      (allenatore Under 16)
  atleta@example.test       (atleta adulto)
  tutore@example.test       (tutore di Sofia Neri)`)
} catch (err) {
  console.error('Seed fallito, nessun dato scritto:', err instanceof Error ? err.message : err)
  process.exitCode = 1
} finally {
  await closeDb()
}
