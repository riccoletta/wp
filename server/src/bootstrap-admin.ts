import { createInterface } from 'node:readline'
import { closeDb, initDb, isManagedPostgres } from './db.js'
import { bootstrapAdmin, validateEmail } from './bootstrap.js'

// Primo amministratore del club. Atto unico e manuale, come le migrazioni.
//
//   1) Pannello Supabase → Authentication → Users → Invite user (l'indirizzo qui sotto).
//      La persona riceve l'email e imposta la password: la credenziale non passa di qui.
//   2) npm run admin:bootstrap -- --email=nome@dominio.it --nome=Mario --cognome=Rossi
//
// Gli accessi successivi si creano per invito, dalla segreteria. Non esiste una pagina
// di registrazione: sarebbe una porta aperta sul deploy appena fatto.
//
// Come le migrazioni, serve la connessione DIRETTA del ruolo proprietario: leggere
// `auth.users` e scrivere in `people` non sono poteri del ruolo applicativo.
// `MIGRATION_DATABASE_URL`, se impostata, prevale.
if (process.env.MIGRATION_DATABASE_URL?.trim()) {
  process.env.DATABASE_URL = process.env.MIGRATION_DATABASE_URL
}

const args = new Map<string, string>()
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a)
  if (m) args.set(m[1]!, m[2] ?? 'true')
}

const rl = createInterface({ input: process.stdin, output: process.stdout })
const ask = (q: string): Promise<string> => new Promise((r) => rl.question(q, (v) => r(v.trim())))

try {
  const email = args.get('email') || (await ask('Email dell’amministratore: '))
  const emailError = validateEmail(email)
  if (emailError) throw new Error(emailError)

  const firstName = args.get('nome') || (await ask('Nome: '))
  const lastName = args.get('cognome') || (await ask('Cognome: '))

  await initDb({ migrate: false })
  const res = await bootstrapAdmin({
    email,
    firstName,
    lastName,
    addition: args.get('aggiungi') === 'true',
  })

  const where = isManagedPostgres() ? 'PostgreSQL gestito' : 'PGlite locale'
  const message = {
    creato: 'Amministratore creato e collegato alla sua identità Supabase',
    'ruolo-aggiunto': 'Account già presente: aggiunto il ruolo admin',
    'già-presente': 'Amministratore già presente: nessuna modifica',
  }[res.outcome]
  console.log(`${message} — ${res.email} (${where}).`)
} catch (err) {
  console.error('Bootstrap non eseguito:', err instanceof Error ? err.message : err)
  process.exitCode = 1
} finally {
  rl.close()
  await closeDb()
}
