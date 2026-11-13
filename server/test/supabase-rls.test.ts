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
import { asSystem, closeDb, initDb, type Tx } from '../src/db.js'
import { seedDemo } from '../src/fixtures.js'

type Seed = Awaited<ReturnType<typeof seedDemo>>
let data: Seed
/** userId applicativo → identità Supabase sintetica. */
const authUid = new Map<string, string>()

before(async () => {
  process.env.DATABASE_URL = ''
  await initDb({ memory: true })
  data = await seedDemo()
  await asSystem(async (tx) => {
    const users = await tx.query<any>('select id from app_users')
    for (const u of users) {
      const uid = crypto.randomUUID()
      await tx.query('update app_users set auth_user_id = $1 where id = $2', [uid, u.id])
      authUid.set(u.id, uid)
    }
  })
})
after(async () => { await closeDb() })

/** Una richiesta della Data API: ruolo `authenticated` + claim del JWT. */
function asAuthenticated<T>(userId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const uid = userId ? authUid.get(userId) : null
  const claims = JSON.stringify({ sub: uid, role: 'authenticated' })
  return asSystem(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [claims])
    await tx.query('set local role authenticated')
    return fn(tx)
  })
}

/** Una richiesta senza JWT: PostgREST la serve come ruolo `anon`. */
function asAnon<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return asSystem(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', '', true)`)
    await tx.query('set local role anon')
    return fn(tx)
  })
}

/** Il codice SQLSTATE di un errore, o `null` se la query è passata. */
async function sqlstate(fn: () => Promise<unknown>): Promise<string | null> {
  try { await fn(); return null } catch (err: any) { return err?.code ?? err?.message ?? 'errore' }
}

const denied = (code: string | null) =>
  code !== null && (code === '42501' || /permission denied|not consentit/i.test(code))

const ids = (rows: any[]) => rows.map((r) => r.id).sort()
const rpc = <T = any>(tx: Tx, fn: string, args: unknown[] = []) =>
  tx.one<any>(`select ${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) as r`, args)
    .then((row) => row!.r as T)

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
    const rows = await asAuthenticated(null, (tx) => tx.query('select * from people'))
    assert.deepEqual(rows, [])
  })
})

describe('Data API: segreteria', () => {
  it('vede tutte le persone e le posizioni economiche', async () => {
    const people = await asAuthenticated(data.admin.userId, (tx) => tx.query('select id from people'))
    assert.ok(people.length >= 7, `attese tutte le persone, viste ${people.length}`)
    const dues = await asAuthenticated(data.admin.userId, (tx) => tx.query('select id from dues_status'))
    assert.ok(dues.length >= 2)
  })

  it('scrive attraverso le RPC e il dato persiste', async () => {
    const created = await asAuthenticated(data.admin.userId, (tx) =>
      rpc<{ id: string }>(tx, 'api_person_create', [JSON.stringify({
        firstName: 'Nuova', lastName: 'Iscritta', kind: 'atleta',
      })]))
    const back = await asAuthenticated(data.admin.userId, (tx) =>
      rpc<any>(tx, 'api_person_get', [created.id]))
    assert.equal(back.lastName, 'Iscritta')
  })

  it('non legge gli hash delle password né le sessioni', async () => {
    assert.ok(denied(await sqlstate(() => asAuthenticated(data.admin.userId,
      (tx) => tx.query('select password_hash from app_users')))))
    assert.ok(denied(await sqlstate(() => asAuthenticated(data.admin.userId,
      (tx) => tx.query('select * from sessions')))))
    assert.ok(denied(await sqlstate(() => asAuthenticated(data.admin.userId,
      (tx) => tx.query('select * from login_attempts')))))
  })
})

describe('Data API: allenatore', () => {
  it('vede solo gli atleti delle proprie squadre', async () => {
    const visti = ids(await asAuthenticated(data.coachA.userId, (tx) => tx.query('select id from people')))
    assert.ok(visti.includes(data.minor.personId), 'deve vedere la propria atleta')
    assert.ok(!visti.includes(data.athlete.personId), 'non deve vedere un atleta di altra squadra')
  })

  it('non vede nessun dato economico', async () => {
    const dues = await asAuthenticated(data.coachA.userId, (tx) => tx.query('select id from dues'))
    assert.deepEqual(dues, [])
    const pay = await asAuthenticated(data.coachA.userId, (tx) => tx.query('select id from payment_records'))
    assert.deepEqual(pay, [])
    const viaRpc = await asAuthenticated(data.coachA.userId, (tx) => rpc<any[]>(tx, 'api_dues_list'))
    assert.deepEqual(viaRpc, [])
  })

  it('non può modificare le anagrafiche', async () => {
    assert.ok(denied(await sqlstate(() => asAuthenticated(data.coachA.userId, (tx) =>
      tx.query(`insert into people (first_name, last_name) values ('Falso','Atleta')`)))))
    assert.ok(denied(await sqlstate(() => asAuthenticated(data.coachA.userId, (tx) =>
      rpc(tx, 'api_person_update', [data.minor.personId, JSON.stringify({ lastName: 'Manomesso' })])))))
  })

  it('non raggiunge il roster di una squadra non assegnata', async () => {
    const team = await asAuthenticated(data.coachA.userId, (tx) => rpc<any>(tx, 'api_team_get', [data.teamB]))
    assert.equal(team, null)
  })
})

describe('Data API: atleta e tutore', () => {
  it("l'atleta vede solo se stesso e la propria quota", async () => {
    const visti = ids(await asAuthenticated(data.athlete.userId, (tx) => tx.query('select id from people')))
    assert.deepEqual(visti, [data.athlete.personId])
    const dues = await asAuthenticated(data.athlete.userId, (tx) =>
      tx.query<any>('select person_id from dues'))
    assert.ok(dues.every((d) => d.person_id === data.athlete.personId))
  })

  it('il tutore vede solo il minore collegato', async () => {
    const visti = ids(await asAuthenticated(data.guardian.userId, (tx) => tx.query('select id from people')))
    assert.deepEqual(visti.sort(), [data.guardian.personId, data.minor.personId].sort())
    const dues = await asAuthenticated(data.guardian.userId, (tx) =>
      tx.query<any>('select person_id from dues'))
    assert.ok(dues.length > 0 && dues.every((d) => d.person_id === data.minor.personId))
  })

  it('un atleta non vede la quota di un altro', async () => {
    const due = await asAuthenticated(data.athlete.userId, (tx) => rpc<any>(tx, 'api_due_get', [data.dueId]))
    assert.equal(due, null)
  })
})

describe('Data API: scalata di privilegi', () => {
  it('nessuno può assegnarsi un ruolo', async () => {
    for (const userId of [data.athlete.userId, data.coachA.userId, data.admin.userId]) {
      const code = await sqlstate(() => asAuthenticated(userId, (tx) =>
        tx.query(`insert into user_roles (user_id, role) values ($1,'admin')`, [userId])))
      assert.ok(denied(code), `ruolo assegnabile da ${userId}: ${code}`)
    }
  })

  it('nessuno può cambiare la propria mappatura di ruoli o identità', async () => {
    assert.ok(denied(await sqlstate(() => asAuthenticated(data.athlete.userId, (tx) =>
      tx.query(`delete from user_roles where user_id = $1`, [data.athlete.userId])))))
    assert.ok(denied(await sqlstate(() => asAuthenticated(data.athlete.userId, (tx) =>
      tx.query(`update app_users set auth_user_id = null where id = $1`, [data.athlete.userId])))))
  })

  it('nessuno può toccare la licenza dalla Data API', async () => {
    assert.ok(denied(await sqlstate(() => asAuthenticated(data.admin.userId, (tx) =>
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
      const people = await asAuthenticated(data.admin.userId, (tx) => tx.query('select id from people'))
      assert.ok(people.length > 0, 'in sola lettura i dati restano consultabili')

      let message = ''
      try {
        await asAuthenticated(data.admin.userId, (tx) => tx.query(
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
        await asAuthenticated(data.admin.userId, (tx) =>
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
    const created = await asAuthenticated(data.admin.userId, (tx) =>
      rpc<{ id: string }>(tx, 'api_person_create', [JSON.stringify({ firstName: 'Torna', lastName: 'Scrivibile' })]))
    assert.ok(created.id)
  })
})

describe('Data API: stato derivato e contatori', () => {
  it('la licenza arriva al client già interpretata', async () => {
    const l = await asAuthenticated(data.admin.userId, (tx) => rpc<any>(tx, 'api_license'))
    assert.equal(l.phase, 'attiva')
    assert.equal(l.readOnly, false)
    assert.equal(l.message, null)
  })

  it("la dashboard conta solo ciò che il ruolo può vedere", async () => {
    const admin = await asAuthenticated(data.admin.userId, (tx) => rpc<any>(tx, 'api_dashboard'))
    const coach = await asAuthenticated(data.coachA.userId, (tx) => rpc<any>(tx, 'api_dashboard'))
    assert.ok(admin.counts.duesOpen > 0)
    assert.equal(coach.counts.duesOpen, 0, 'un allenatore non conta quote')
    assert.ok(admin.counts.peopleActive > coach.counts.peopleActive)
  })

  it('il versamento parziale aggiorna lo stato derivato della quota', async () => {
    const before = await asAuthenticated(data.admin.userId, (tx) => rpc<any>(tx, 'api_due_get', [data.dueId]))
    await asAuthenticated(data.admin.userId, (tx) => rpc(tx, 'api_payment_add', [
      data.dueId, JSON.stringify({ amountCents: 1000, method: 'contanti' })]))
    const after = await asAuthenticated(data.admin.userId, (tx) => rpc<any>(tx, 'api_due_get', [data.dueId]))
    assert.equal(after.paidCents, before.paidCents + 1000)
    assert.equal(after.remainingCents, before.remainingCents - 1000)
    assert.equal(after.status, after.remainingCents > 0 ? 'parziale' : 'saldata')
  })
})
