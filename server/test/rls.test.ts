import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { boot } from './helpers.js'

let env: Awaited<ReturnType<typeof boot>>
before(async () => { env = await boot() })
after(async () => { await env.close() })

const ids = (rows: any[]) => rows.map((r) => r.id ?? r.personId).sort()

describe('permessi: allenatore', () => {
  it('vede solo gli atleti delle proprie squadre', async () => {
    const coachA = await env.login('coach.a@example.test')
    const people = (await coachA.get('/api/people')).body
    const visti = ids(people)
    assert.ok(visti.includes(env.data.minor.personId), 'deve vedere la propria atleta')
    assert.ok(!visti.includes(env.data.athlete.personId), 'non deve vedere un atleta di altra squadra')
    assert.ok(!visti.includes(env.data.admin.personId), 'non deve vedere la segreteria')
  })

  it('non accede al roster di una squadra non assegnata', async () => {
    const coachA = await env.login('coach.a@example.test')
    assert.equal((await coachA.get(`/api/teams/${env.data.teamB}`)).status, 404)
    assert.deepEqual(ids((await coachA.get('/api/teams')).body), [env.data.teamA])
  })

  it('non può modificare le anagrafiche', async () => {
    const coachA = await env.login('coach.a@example.test')
    assert.equal((await coachA.patch(`/api/people/${env.data.minor.personId}`, { lastName: 'Manomesso' })).status, 403)
    assert.equal((await coachA.post('/api/people', {
      firstName: 'Falso', lastName: 'Atleta', kind: 'atleta',
    })).status, 403)
  })

  it('non vede le quote di nessuno', async () => {
    const coachA = await env.login('coach.a@example.test')
    assert.deepEqual((await coachA.get('/api/dues')).body, [])
    assert.equal((await coachA.get(`/api/dues/${env.data.dueId}`)).status, 404)
  })

  it('vede la scadenza del certificato dei propri atleti, non di altri', async () => {
    const coachA = await env.login('coach.a@example.test')
    const rows = (await coachA.get('/api/medical')).body
    assert.deepEqual(ids(rows), [env.data.minor.personId])
  })
})

describe('permessi: tutore', () => {
  it('vede se stesso e solo i minori collegati', async () => {
    const tutore = await env.login('tutore@example.test')
    const visti = ids((await tutore.get('/api/people')).body)
    assert.ok(visti.includes(env.data.minor.personId))
    assert.ok(!visti.includes(env.data.other.personId), 'non deve vedere il minore di un altro tutore')
  })

  it('non accede alla scheda di un minore non collegato', async () => {
    const tutore = await env.login('tutore@example.test')
    assert.equal((await tutore.get(`/api/people/${env.data.other.personId}`)).status, 404)
    assert.equal((await tutore.get(`/api/people/${env.data.minor.personId}`)).status, 200)
  })

  it('vede la quota del proprio minore ma non può registrarne i pagamenti', async () => {
    const tutore = await env.login('tutore@example.test')
    const dues = (await tutore.get('/api/dues')).body
    assert.equal(dues.length, 1)
    assert.equal(dues[0].personId, env.data.minor.personId)
    const res = await tutore.post(`/api/dues/${env.data.dueId}/payments`, {
      amountCents: 25000, paidOn: '2025-11-01', method: 'contanti',
    })
    assert.equal(res.status, 403)
  })

  it('non può cambiare il tesseramento del proprio minore', async () => {
    const tutore = await env.login('tutore@example.test')
    const res = await tutore.put('/api/registrations', {
      personId: env.data.minor.personId, seasonId: env.data.seasonId, status: 'attivo',
    })
    assert.equal(res.status, 403)
  })
})

describe('permessi: atleta adulto', () => {
  it('vede soltanto i propri dati', async () => {
    const atleta = await env.login('atleta@example.test')
    assert.deepEqual(ids((await atleta.get('/api/people')).body), [env.data.athlete.personId])
    assert.deepEqual(ids((await atleta.get('/api/medical')).body), [env.data.athlete.personId])
    const dues = (await atleta.get('/api/dues')).body
    assert.deepEqual(dues.map((d: any) => d.personId), [env.data.athlete.personId])
  })

  it('non può crearsi un tesseramento né una quota', async () => {
    const atleta = await env.login('atleta@example.test')
    assert.equal((await atleta.put('/api/registrations', {
      personId: env.data.athlete.personId, seasonId: env.data.seasonId, status: 'attivo',
    })).status, 403)
    assert.equal((await atleta.post('/api/dues', {
      personId: env.data.athlete.personId, seasonId: env.data.seasonId,
      description: 'Sconto', amountCents: 100,
    })).status, 403)
  })

  it('non può aggiungersi a una squadra', async () => {
    const atleta = await env.login('atleta@example.test')
    assert.equal((await atleta.post(`/api/teams/${env.data.teamA}/members`, {
      personId: env.data.athlete.personId,
    })).status, 403)
  })
})

describe('permessi: segreteria', () => {
  it('vede tutte le persone e tutte le squadre', async () => {
    const admin = await env.login('segreteria@example.test')
    assert.equal((await admin.get('/api/people')).body.length, 7)
    assert.equal((await admin.get('/api/teams')).body.length, 2)
  })
})
