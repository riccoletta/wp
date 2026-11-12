import { createInterface } from 'node:readline'
import { closeDb, initDb, isManagedPostgres } from './db.js'
import { bootstrapAdmin, validateEmail, validatePassword } from './bootstrap.js'

// Primo amministratore su un database vuoto. Atto unico e manuale, come le migrazioni.
//
//   npm run admin:bootstrap -- --email=nome@dominio.it --nome=Mario --cognome=Rossi
//
// La password si digita qui, a schermo spento: non è un argomento (finirebbe nella
// cronologia della shell), non è una variabile d'ambiente, non viene mai stampata
// né scritta su disco. Nel repository non entra nessuna credenziale.
//
// Come le migrazioni, su Supabase conviene la connessione DIRETTA del ruolo
// proprietario: `app_runtime` non può scrivere in `people` (cfr. 0007).
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

/** Domanda senza eco: i caratteri non compaiono a schermo e non restano nel terminale. */
function askSecret(q: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin
    if (!stdin.isTTY) {
      reject(new Error('La password va digitata in un terminale interattivo: nessun pipe, nessun argomento.'))
      return
    }
    process.stdout.write(q)
    const wasRaw = stdin.isRaw
    stdin.setRawMode(true)
    stdin.resume()
    let value = ''
    const done = (err?: Error) => {
      stdin.setRawMode(!!wasRaw)
      stdin.removeListener('data', onData)
      process.stdout.write('\n')
      err ? reject(err) : resolve(value)
    }
    const onData = (buf: Buffer) => {
      for (const ch of buf.toString('utf8')) {
        if (ch === '\r' || ch === '\n') return done()
        if (ch === '\u0003') return done(new Error('Interrotto.'))
        if (ch === '\u007f' || ch === '\b') { value = value.slice(0, -1); continue }
        if (ch >= ' ') value += ch
      }
    }
    stdin.on('data', onData)
  })
}

try {
  const email = args.get('email') || (await ask('Email dell’amministratore: '))
  const emailError = validateEmail(email)
  if (emailError) throw new Error(emailError)

  const firstName = args.get('nome') || (await ask('Nome: '))
  const lastName = args.get('cognome') || (await ask('Cognome: '))

  const password = await askSecret('Password (non viene mostrata): ')
  const passwordError = validatePassword(password)
  if (passwordError) throw new Error(passwordError)
  const again = await askSecret('Conferma password: ')
  if (password !== again) throw new Error('Le due password non coincidono: nulla è stato scritto.')

  await initDb({ migrate: false })
  const res = await bootstrapAdmin({
    email,
    password,
    firstName,
    lastName,
    addition: args.get('aggiungi') === 'true',
  })

  const where = isManagedPostgres() ? 'PostgreSQL gestito' : 'PGlite locale'
  const message = {
    creato: 'Amministratore creato',
    'ruolo-aggiunto': 'Account già presente: aggiunto il ruolo admin (password invariata)',
    'già-presente': 'Amministratore già presente: nessuna modifica, password invariata',
  }[res.outcome]
  console.log(`${message} — ${res.email} (${where}).`)
} catch (err) {
  console.error('Bootstrap non eseguito:', err instanceof Error ? err.message : err)
  process.exitCode = 1
} finally {
  rl.close()
  await closeDb()
}
