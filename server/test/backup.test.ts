/**
 * La copia di sicurezza, provata come si prova un paracadute: aprendolo.
 *
 * Non basta che il file si scriva. Deve rileggersi coerente, deve accorgersi di
 * una differenza quando c'è, e soprattutto deve **rimettere dentro** quello che
 * è stato tolto. Il giro completo gira su PGlite, con lo stesso codice che gira
 * sul database gestito.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { asSystem, closeDb, initDb } from '../src/db.js'
import { seedDemo } from '../src/fixtures.js'
import { compare, readSnapshot, restore, verifySnapshot, writeSnapshot } from '../src/backup.js'

let dir: string
let file: string

before(async () => {
  process.env.DATABASE_URL = ''
  await initDb({ memory: true })
  await seedDemo()
  await seedDemo({ slug: 'nuoto-brianza', name: 'Nuoto Brianza' })
  dir = await mkdtemp(path.join(tmpdir(), 'backup-'))
  file = path.join(dir, 'copia.json')
})
after(async () => { await closeDb() })

describe('copia di sicurezza', () => {
  it('salva tutte le tabelle e si rilegge coerente', async () => {
    const { snapshot, problems } = await writeSnapshot(file)
    assert.deepEqual(problems, [], 'una copia con riferimenti rotti non è una copia')
    assert.ok(snapshot.counts['people']! > 0)
    assert.ok(snapshot.counts['payment_records']! > 0)
    assert.ok(snapshot.tables['clubs']!.length >= 2)
    assert.ok(snapshot.relations['quote']!.length > 0)
  })

  it('non porta via credenziali, e dichiara che cosa ha omesso', async () => {
    const s = await readSnapshot(file)
    assert.ok(s.redacted.includes('app_users.password_hash'))
    assert.deepEqual(s.skipped.map((x) => x.table).sort(), ['login_attempts', 'sessions'])
    // I conteggi ci sono anche per quello che non è stato copiato.
    assert.equal(typeof s.counts['sessions'], 'number')

    // Nessuna riga salvata porta una colonna di credenziali (il nome di una
    // migrazione può contenere la parola: è il contenuto che conta, non il testo).
    for (const [tabella, righe] of Object.entries(s.tables)) {
      const colonne = righe[0] ? Object.keys(righe[0]) : []
      assert.deepEqual(colonne.filter((c) => /password|token/i.test(c)), [],
        `${tabella} porta ancora una colonna di credenziali`)
    }
    for (const u of s.authUsers) {
      assert.deepEqual(Object.keys(u).sort(),
        ['created_at', 'email', 'email_confirmed_at', 'id', 'last_sign_in_at'])
    }
  })

  it('si accorge di una copia manomessa', async () => {
    const s = await readSnapshot(file)
    s.tables['payment_records'] = s.tables['payment_records']!.map(
      (r) => ({ ...r, due_id: '00000000-0000-0000-0000-000000000000' }))
    const problemi = verifySnapshot(s)
    assert.ok(problemi.some((p) => /payment_records/.test(p)),
      'un riferimento che non risolve deve far fallire la verifica')
  })

  it('legge le chiavi composite come sono, non a colonne sciolte', async () => {
    const s = await readSnapshot(file)
    const fk = s.foreignKeys.find((f) => f.name === 'team_memberships_person_club_fk')
    assert.deepEqual(fk!.columns, ['person_id', 'club_id'])
    assert.deepEqual(fk!.refColumns, ['id', 'club_id'])
    assert.deepEqual(verifySnapshot(s), [], 'nessun falso allarme sulle chiavi composite')
  })

  it('senza modifiche il confronto non trova differenze', async () => {
    assert.deepEqual(await compare(await readSnapshot(file)), [])
  })

  it('rimette dentro quello che è stato tolto', async () => {
    const prima = await readSnapshot(file)

    // Finta perdita di dati: via i versamenti e le rose di una società.
    await asSystem(async (tx) => {
      await tx.query('delete from payment_records')
      await tx.query('delete from team_memberships')
    })
    const persi = await compare(prima)
    assert.ok(persi.some((d) => /payment_records/.test(d.voce)), 'il confronto deve vedere il buco')

    const rimesse = await restore(prima)
    assert.ok(rimesse['payment_records']! > 0 && rimesse['team_memberships']! > 0)

    assert.deepEqual(await compare(prima), [],
      'dopo il ripristino conteggi, relazioni e legami tornano identici')
  })

  it('un file illeggibile non passa per buono', async () => {
    const rotto = path.join(dir, 'rotto.json')
    await writeFile(rotto, '{ non è json', 'utf8')
    await assert.rejects(() => readSnapshot(rotto))
  })
})
