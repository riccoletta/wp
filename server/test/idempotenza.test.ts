/**
 * Le migrazioni di M10 si applicano dal **pannello Supabase**, incollate a mano:
 * nessuno può garantire che non vengano lanciate due volte. Quindi devono essere
 * idempotenti sul serio, e si prova rieseguendole sullo stesso database.
 *
 * Il giro è quello vero: si cancella il segno delle due migrazioni dal registro e
 * si richiama il migratore, che le riesegue dall'inizio alla fine.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { asSystem, closeDb, initDb, runMigrations } from '../src/db.js'
import { seedDemo } from '../src/fixtures.js'
import { compare, snapshot } from '../src/backup.js'

const M10 = ['0012_clubs.sql', '0013_platform_api.sql']

before(async () => {
  process.env.DATABASE_URL = ''
  await initDb({ memory: true })
  await seedDemo()
  await seedDemo({ slug: 'nuoto-brianza', name: 'Nuoto Brianza' })
})
after(async () => { await closeDb() })

describe('migrazioni M10 rieseguibili', () => {
  it('rilanciate non cambiano un dato né rompono un vincolo', async () => {
    const prima = await snapshot()

    await asSystem((tx) => tx.query(
      'delete from schema_migrations where version = any($1)', [M10]))
    const rifatte = await runMigrations()
    assert.deepEqual(rifatte, M10, 'le due migrazioni sono state rieseguite davvero')

    const diff = await compare(prima)
    assert.deepEqual(diff, [], 'una seconda esecuzione non deve toccare niente')
  })

  it('dopo la seconda esecuzione vincoli, indici e policy sono ancora uno solo', async () => {
    const doppioni = await asSystem((tx) => tx.query<any>(
      `select conname, count(*)::int as n from pg_constraint
        where conname like '%\\_club\\_fk' or conname like '%\\_id\\_club\\_key'
        group by conname having count(*) > 1`))
    assert.deepEqual(doppioni, [])

    const policy = await asSystem((tx) => tx.query<any>(
      `select tablename, policyname, count(*)::int as n from pg_policies
        where schemaname = 'public' group by tablename, policyname having count(*) > 1`))
    assert.deepEqual(policy, [])

    // E la società non è stata creata una seconda volta.
    const societa = await asSystem((tx) => tx.query<any>(
      `select slug, count(*)::int as n from clubs group by slug having count(*) > 1`))
    assert.deepEqual(societa, [])
  })

  it('i permessi reggono ancora dopo la riesecuzione', async () => {
    const abbonamenti = await asSystem((tx) => tx.one<any>(
      'select count(*)::int as n from subscriptions'))
    assert.equal(abbonamenti!.n, 2, 'un abbonamento per società, non uno in più')
  })
})
