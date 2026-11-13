/**
 * Permessi della Data API di Supabase, provati sul database vero.
 *
 * Qui NON passa l'API Express: le query girano come ruolo `authenticated` con i claim
 * del JWT nella stessa variabile di sessione che PostgREST popola (`request.jwt.claims`),
 * esattamente come farebbe `supabase-js`. Se una riga non deve essere visibile, a non
 * restituirla dev'essere la policy — non il codice applicativo.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { asAnon, asDataApi, asSystem, closeDb, initDb } from '../src/db.js'
import { seedDemo } from '../src/fixtures.js'
import { denied, rpc, sqlstate } from './helpers.js'

type Seed = Awaited<ReturnType<typeof seedDemo>>
let data: Seed

before(async () => {
  process.env.DATABASE_URL = ''
  await initDb({ memory: true })
  data = await seedDemo()
})
after(async () => { await closeDb() })

const ids = (rows: any[]) => rows.map((r) => r.id).sort()

describe('Data API: utente anonimo', () => {
  it('non raggiunge nessun dato del club', async () => {
    assert.ok(denied(await sqlstate(() => asAnon((tx) => tx.query('select * from people')))))
    assert.ok(denied(await sqlstate(() => asAnon((tx) => tx.query('select * from dues')))))
    assert.ok(denied(await sqlstate(() => asAnon((tx) => tx.query('select * from license')))))
  })

  it('non può chiamare le funzioni RPC', async () => {
    assert.ok(denied(await sqlstate(() => asAnon((tx) => rpc(tx, 'api_people_list')))))
    assert.ok(denied(await sqlstate(() => asAnon((tx) => rpc(tx, 'api_dashboard')))))
  })

  it('con un JWT senza identità valida non vede nulla', async () => {
    const rows = await asDataApi(null, (tx) => tx.query('select * from people'))
    assert.deepEqual(rows, [])
  })
})

describe('Data API: segreteria', () => {
  it('vede tutte le persone e le posizioni economiche', async () => {
    const people = await asDataApi(data.admin.authUserId, (tx) => tx.query('select id from people'))
    assert.ok(people.length >= 7, `attese tutte le persone, viste ${people.length}`)
    const dues = await asDataApi(data.admin.authUserId, (tx) => tx.query('select id from dues_status'))
    assert.ok(dues.length >= 2)
  })

  it('scrive attraverso le RPC e il dato persiste', async () => {
    const created = await asDataApi(data.admin.authUserId, (tx) =>
      rpc<{ id: string }>(tx, 'api_person_create', [JSON.stringify({
        firstName: 'Nuova', lastName: 'Iscritta', kind: 'atleta',
      })]))
    const back = await asDataApi(data.admin.authUserId, (tx) =>
      rpc<any>(tx, 'api_person_get', [created.id]))
    assert.equal(back.lastName, 'Iscritta')
  })

  it('non legge gli hash delle password né le sessioni', async () => {
    assert.ok(denied(await sqlstate(() => asDataApi(data.admin.authUserId,
      (tx) => tx.query('select password_hash from app_users')))))
    assert.ok(denied(await sqlstate(() => asDataApi(data.admin.authUserId,
      (tx) => tx.query('select * from sessions')))))
    assert.ok(denied(await sqlstate(() => asDataApi(data.admin.authUserId,
      (tx) => tx.query('select * from login_attempts')))))
  })
})

describe('Data API: allenatore', () => {
  it('vede solo gli atleti delle proprie squadre', async () => {
    const visti = ids(await asDataApi(data.coachA.authUserId, (tx) => tx.query('select id from people')))
    assert.ok(visti.includes(data.minor.personId), 'deve vedere la propria atleta')
    assert.ok(!visti.includes(data.athlete.personId), 'non deve vedere un atleta di altra squadra')
  })

  it('non vede nessun dato economico', async () => {
    const dues = await asDataApi(data.coachA.authUserId, (tx) => tx.query('select id from dues'))
    assert.deepEqual(dues, [])
    const pay = await asDataApi(data.coachA.authUserId, (tx) => tx.query('select id from payment_records'))
    assert.deepEqual(pay, [])
    const viaRpc = await asDataApi(data.coachA.authUserId, (tx) => rpc<any[]>(tx, 'api_dues_list'))
    assert.deepEqual(viaRpc, [])
  })

  it('non può modificare le anagrafiche', async () => {
    assert.ok(denied(await sqlstate(() => asDataApi(data.coachA.authUserId, (tx) =>
      tx.query(`insert into people (first_name, last_name) values ('Falso','Atleta')`)))))
    assert.ok(denied(await sqlstate(() => asDataApi(data.coachA.authUserId, (tx) =>
      rpc(tx, 'api_person_update', [data.minor.personId, JSON.stringify({ lastName: 'Manomesso' })])))))
  })

  it('non raggiunge il roster di una squadra non assegnata', async () => {
    const team = await asDataApi(data.coachA.authUserId, (tx) => rpc<any>(tx, 'api_team_get', [data.teamB]))
    assert.equal(team, null)
  })
})

describe('Data API: atleta e tutore', () => {
  it("l'atleta vede solo se stesso e la propria quota", async () => {
    const visti = ids(await asDataApi(data.athlete.authUserId, (tx) => tx.query('select id from people')))
    assert.deepEqual(visti, [data.athlete.personId])
    const dues = await asDataApi(data.athlete.authUserId, (tx) =>
      tx.query<any>('select person_id from dues'))
    assert.ok(dues.every((d) => d.person_id === data.athlete.personId))
  })

  it('il tutore vede solo il minore collegato', async () => {
    const visti = ids(await asDataApi(data.guardian.authUserId, (tx) => tx.query('select id from people')))
    assert.deepEqual(visti.sort(), [data.guardian.personId, data.minor.personId].sort())
    const dues = await asDataApi(data.guardian.authUserId, (tx) =>
      tx.query<any>('select person_id from dues'))
    assert.ok(dues.length > 0 && dues.every((d) => d.person_id === data.minor.personId))
  })

  it('un atleta non vede la quota di un altro', async () => {
    const due = await asDataApi(data.athlete.authUserId, (tx) => rpc<any>(tx, 'api_due_get', [data.dueId]))
    assert.equal(due, null)
  })
})

describe('Data API: scalata di privilegi', () => {
  it('nessuno può assegnarsi un ruolo', async () => {
    for (const u of [data.athlete, data.coachA, data.admin]) {
      const code = await sqlstate(() => asDataApi(u.authUserId, (tx) =>
        tx.query(`insert into user_roles (user_id, role) values ($1,'admin')`, [u.userId])))
      assert.ok(denied(code), `ruolo assegnabile da ${u.userId}: ${code}`)
    }
  })

  it('nessuno può cambiare la propria mappatura di ruoli o identità', async () => {
    assert.ok(denied(await sqlstate(() => asDataApi(data.athlete.authUserId, (tx) =>
      tx.query(`delete from user_roles where user_id = $1`, [data.athlete.userId])))))
    assert.ok(denied(await sqlstate(() => asDataApi(data.athlete.authUserId, (tx) =>
      tx.query(`update app_users set auth_user_id = null where id = $1`, [data.athlete.userId])))))
  })

  it('nessuno può toccare la licenza dalla Data API', async () => {
    assert.ok(denied(await sqlstate(() => asDataApi(data.admin.authUserId, (tx) =>
      tx.query(`update license set expires_on = current_date + 3650`)))))
  })
})

describe('Data API: licenza applicata dal database', () => {
  const restore = () => asSystem((tx) =>
    tx.query(`update license set status = 'attiva', expires_on = current_date + 365`))

  it('scaduta oltre la tolleranza: la segreteria legge ma non scrive', async () => {
    await asSystem((tx) => tx.query(
      `update license set status = 'attiva', expires_on = current_date - 30, grace_days = 15`))
    try {
      const people = await asDataApi(data.admin.authUserId, (tx) => tx.query('select id from people'))
      assert.ok(people.length > 0, 'in sola lettura i dati restano consultabili')

      let message = ''
      try {
        await asDataApi(data.admin.authUserId, (tx) => tx.query(
          `insert into people (first_name, last_name) values ('Bloccata','Dalla Licenza')`))
        assert.fail('la scrittura doveva essere respinta dal database')
      } catch (err: any) { message = String(err.message) }
      assert.match(message, /sola lettura/i)
      assert.match(message, /Licenza scaduta/i)
    } finally { await restore() }
  })

  it('sospesa: respinta anche la RPC, e i dati restano intatti', async () => {
    const prima = await asSystem((tx) => tx.one<any>('select count(*)::int as n from people'))
    await asSystem((tx) => tx.query(`update license set status = 'sospesa'`))
    try {
      let message = ''
      try {
        await asDataApi(data.admin.authUserId, (tx) =>
          rpc(tx, 'api_person_create', [JSON.stringify({ firstName: 'Mai', lastName: 'Creata' })]))
        assert.fail('la RPC doveva essere respinta')
      } catch (err: any) { message = String(err.message) }
      assert.match(message, /Licenza sospesa/i)
      const dopo = await asSystem((tx) => tx.one<any>('select count(*)::int as n from people'))
      assert.equal(dopo!.n, prima!.n, 'nessun dato cancellato o creato')
    } finally { await restore() }
  })

  it('riattivata: la scrittura torna', async () => {
    await restore()
    const created = await asDataApi(data.admin.authUserId, (tx) =>
      rpc<{ id: string }>(tx, 'api_person_create', [JSON.stringify({ firstName: 'Torna', lastName: 'Scrivibile' })]))
    assert.ok(created.id)
  })
})

describe('Data API: stato derivato e contatori', () => {
  it('la licenza arriva al client già interpretata', async () => {
    const l = await asDataApi(data.admin.authUserId, (tx) => rpc<any>(tx, 'api_license'))
    assert.equal(l.phase, 'attiva')
    assert.equal(l.readOnly, false)
    assert.equal(l.message, null)
  })

  it("la dashboard conta solo ciò che il ruolo può vedere", async () => {
    const admin = await asDataApi(data.admin.authUserId, (tx) => rpc<any>(tx, 'api_dashboard'))
    const coach = await asDataApi(data.coachA.authUserId, (tx) => rpc<any>(tx, 'api_dashboard'))
    assert.ok(admin.counts.duesOpen > 0)
    assert.equal(coach.counts.duesOpen, 0, 'un allenatore non conta quote')
    assert.ok(admin.counts.peopleActive > coach.counts.peopleActive)
  })

  it('il versamento parziale aggiorna lo stato derivato della quota', async () => {
    const before = await asDataApi(data.admin.authUserId, (tx) => rpc<any>(tx, 'api_due_get', [data.dueId]))
    await asDataApi(data.admin.authUserId, (tx) => rpc(tx, 'api_payment_add', [
      data.dueId, JSON.stringify({ amountCents: 1000, method: 'contanti' })]))
    const after = await asDataApi(data.admin.authUserId, (tx) => rpc<any>(tx, 'api_due_get', [data.dueId]))
    assert.equal(after.paidCents, before.paidCents + 1000)
    assert.equal(after.remainingCents, before.remainingCents - 1000)
    assert.equal(after.status, after.remainingCents > 0 ? 'parziale' : 'saldata')
  })
})
