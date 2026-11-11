import { closeDb, initDb } from './db.js'

await initDb()
console.log('Migrazioni applicate.')
await closeDb()
