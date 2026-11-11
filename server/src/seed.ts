import { closeDb, initDb } from './db.js'
import { seedDemo } from './fixtures.js'

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
