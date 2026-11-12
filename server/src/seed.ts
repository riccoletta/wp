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
  segreteria@example.test / password123   (admin)
  coach.a@example.test    / password123   (allenatore Under 16)
  atleta@example.test     / password123   (atleta adulto)
  tutore@example.test     / password123   (tutore di Sofia Neri)`)
} catch (err) {
  console.error('Seed fallito, nessun dato scritto:', err instanceof Error ? err.message : err)
  process.exitCode = 1
} finally {
  await closeDb()
}
