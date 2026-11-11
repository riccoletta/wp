import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { asUser } from '../src/db.js'
import { boot, inDays, type Client } from './helpers.js'

const TOKEN = 'token-di-prova-solo-per-i-test'
process.env.LICENSE_OWNER_TOKEN = TOKEN

type App = Awaited<ReturnType<typeof boot>>
let app: App
let admin: Client
let adminUserId: string
const ADMIN = 'segreteria@example.test'

const owner = async (path: string, body?: unknown, token: string | null = TOKEN) => {
  const res = await fetch(`${app.base}/api/owner/license${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { 'x-license-token': token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

/** Riporta la licenza in piena validità: ogni test parte da uno stato noto. */
const makeActive = () => owner('/renew', { expiresOn: inDays(200), graceDays: 15 })
  .then(() => owner('/reactivate', {}))

before(async () => {
  app = await boot()
  admin = await app.login(ADMIN)
  adminUserId = (await admin.get('/api/auth/me')).body.userId
  await makeActive()
})
after(() => app.close())

describe('licenza — stato e avvisi', () => {
  it('attiva: nessun avviso, scrittura permessa', async () => {
    const res = await admin.get('/api/license')
    assert.equal(res.status, 200)
    assert.equal(res.body.phase, 'attiva')
    assert.equal(res.body.readOnly, false)
    assert.equal(res.body.message, null)
  })

  it('in scadenza entro 30 giorni: avviso italiano, accesso ancora pieno', async () => {
    await owner('/renew', { expiresOn: inDays(10) })
    const { body } = await admin.get('/api/license')
    assert.equal(body.phase, 'in_scadenza')
    assert.equal(body.readOnly, false)
    assert.match(body.message, /Licenza in scadenza tra 10 giorni/)
    const created = await admin.post('/api/people', { firstName: 'Licenza', lastName: 'Preavviso', kind: 'atleta' })
    assert.equal(created.status, 200)
  })

  it('scaduta dentro la tolleranza: accesso pieno e avviso di sola lettura imminente', async () => {
    await owner('/renew', { expiresOn: inDays(-3), graceDays: 15 })
    const { body } = await admin.get('/api/license')
    assert.equal(body.phase, 'tolleranza')
    assert.equal(body.readOnly, false)
    assert.match(body.message, /Periodo di tolleranza fino al/)
    const created = await admin.post('/api/people', { firstName: 'Licenza', lastName: 'Tolleranza', kind: 'atleta' })
    assert.equal(created.status, 200)
  })

  it('oltre la tolleranza: sola lettura, i dati restano visibili', async () => {
    await owner('/renew', { expiresOn: inDays(-40), graceDays: 15 })
    const { body } = await admin.get('/api/license')
    assert.equal(body.phase, 'scaduta')
    assert.equal(body.readOnly, true)

    const people = await admin.get('/api/people')
    assert.equal(people.status, 200)
    assert.ok(people.body.length > 0, 'i dati restano consultabili ed estraibili')

    const blocked = await admin.post('/api/people', { firstName: 'Licenza', lastName: 'Scaduta', kind: 'atleta' })
    assert.equal(blocked.status, 403)
    assert.match(blocked.body.error, /sola lettura/)
  })

  it('rinnovo: ripristina subito la scrittura', async () => {
    const renewed = await owner('/renew', { expiresOn: inDays(365) })
    assert.equal(renewed.status, 200)
    assert.equal(renewed.body.phase, 'attiva')
    const created = await admin.post('/api/people', { firstName: 'Licenza', lastName: 'Rinnovata', kind: 'atleta' })
    assert.equal(created.status, 200)
  })
})

describe('licenza — sospensione e riattivazione', () => {
  it('sospesa: lettura sì, scrittura no, su ogni verbo', async () => {
    await makeActive()
    const suspended = await owner('/suspend', { note: 'mancato pagamento' })
    assert.equal(suspended.body.phase, 'sospesa')
    assert.equal(suspended.body.readOnly, true)

    const person = (await admin.get('/api/people')).body[0]
    assert.equal((await admin.get(`/api/people/${person.id}`)).status, 200)
    assert.equal((await admin.get('/api/dashboard')).status, 200)

    for (const res of [
      await admin.post('/api/people', { firstName: 'X', lastName: 'Y', kind: 'atleta' }),
      await admin.patch(`/api/people/${person.id}`, { firstName: 'X' }),
      await admin.del(`/api/people/${person.id}/guardians/${person.id}`),
      await admin.post('/api/registrations', { personId: person.id, seasonId: app.data.seasonId, status: 'attivo' }),
    ]) {
      assert.equal(res.status, 403)
      assert.match(res.body.error, /Licenza sospesa/)
    }
  })

  it('la sessione resta valida: login e logout funzionano anche da sospesa', async () => {
    const c = await app.login(ADMIN)
    assert.equal((await c.get('/api/auth/me')).status, 200)
    assert.equal((await c.post('/api/auth/logout')).status, 200)
  })

  it('riattivazione: la scrittura torna disponibile', async () => {
    const back = await owner('/reactivate', { note: 'pagamento ricevuto' })
    assert.equal(back.body.phase, 'attiva')
    assert.equal(back.body.readOnly, false)
    assert.equal((await admin.post('/api/people', { firstName: 'Licenza', lastName: 'Riattivata', kind: 'atleta' })).status, 200)
  })
})

describe('licenza — autorizzazione del canale proprietario', () => {
  it('senza token: 401', async () => {
    assert.equal((await owner('/suspend', {}, null)).status, 401)
  })

  it('token errato: 401', async () => {
    assert.equal((await owner('/suspend', {}, 'token-sbagliato')).status, 401)
  })

  it("la sessione dell'admin del club non apre il canale proprietario", async () => {
    const res = await fetch(`${app.base}/api/owner/license/suspend`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: admin.cookie },
      body: '{}',
    })
    assert.equal(res.status, 401)
    assert.equal((await admin.get('/api/license')).body.phase, 'attiva')
  })

  it("l'admin del club non ha alcun endpoint di scrittura sulla licenza", async () => {
    assert.equal((await admin.post('/api/license/suspend', {})).status, 404)
    assert.equal((await admin.put('/api/license', { status: 'sospesa' })).status, 404)
  })

  it('il database rifiuta la scrittura su license al ruolo applicativo', async () => {
    await assert.rejects(
      asUser(adminUserId, (tx) => tx.query(`update license set status = 'sospesa'`)),
      (err: any) => err.code === '42501' || /permission denied/i.test(err.message),
    )
    assert.equal((await admin.get('/api/license')).body.status, 'attiva')
  })

  it('senza token configurato il canale è chiuso, non aperto', async () => {
    const saved = process.env.LICENSE_OWNER_TOKEN
    process.env.LICENSE_OWNER_TOKEN = ''
    assert.equal((await owner('/suspend', {})).status, 503)
    process.env.LICENSE_OWNER_TOKEN = saved
  })
})
