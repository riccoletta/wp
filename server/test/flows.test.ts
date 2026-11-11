import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { boot, inDays } from './helpers.js'

let env: Awaited<ReturnType<typeof boot>>
before(async () => { env = await boot() })
after(async () => { await env.close() })

describe('demo FASE 1: dall\'anagrafica al pagamento', () => {
  it('segreteria crea un atleta, lo assegna a squadra e stagione, tessera, certifica, incassa', async () => {
    const admin = await env.login('segreteria@example.test')

    // 1. anagrafica, senza alcun account per l'atleta
    const created = await admin.post('/api/people', {
      firstName: 'Anna', lastName: 'Bruni', birthDate: '2009-06-01', kind: 'atleta',
    })
    assert.equal(created.status, 200)
    const personId = created.body.id as string
    assert.equal((await admin.get(`/api/people/${personId}`)).body.account, null)

    // 2. roster della stagione attiva
    assert.equal((await admin.post(`/api/teams/${env.data.teamA}/members`, { personId })).status, 200)

    // 3. tesseramento
    assert.equal((await admin.put('/api/registrations', {
      personId, seasonId: env.data.seasonId, status: 'in_corso',
      submittedOn: '2025-09-20', notes: 'In attesa di firma',
    })).status, 200)

    // 4. scadenza certificato: solo la data, nessun file
    assert.equal((await admin.put(`/api/medical/${personId}`, {
      kind: 'agonistico', expiresOn: inDays(200),
    })).status, 200)

    // 5. quota e versamento manuale parziale
    const due = await admin.post('/api/dues', {
      personId, seasonId: env.data.seasonId, description: 'Quota annuale', amountCents: 40000,
      dueDate: '2025-11-30',
    })
    assert.equal(due.status, 200)
    const dueId = due.body.id as string
    assert.equal((await admin.post(`/api/dues/${dueId}/payments`, {
      amountCents: 15000, paidOn: '2025-10-05', method: 'contanti',
    })).status, 200)

    // 6. rilettura: i dati tornano dal database, non dallo stato della pagina
    const fresh = await env.login('segreteria@example.test')
    const scheda = (await fresh.get(`/api/people/${personId}`)).body
    assert.equal(scheda.lastName, 'Bruni')
    assert.deepEqual(scheda.teams.map((t: any) => t.name), ['Under 16'])
    assert.equal(scheda.registrations[0].status, 'in_corso')
    assert.equal(scheda.medical.expiresOn, inDays(200))
    assert.equal(scheda.dues[0].paidCents, 15000)
    assert.equal(scheda.dues[0].remainingCents, 25000)
    assert.equal(scheda.dues[0].status, 'parziale')

    // 7. saldo: lo stato è derivato dai versamenti, non scritto a mano
    await fresh.post(`/api/dues/${dueId}/payments`, {
      amountCents: 25000, paidOn: '2025-11-02', method: 'bonifico',
    })
    const saldata = (await fresh.get(`/api/dues/${dueId}`)).body
    assert.equal(saldata.status, 'saldata')
    assert.equal(saldata.remainingCents, 0)
    assert.equal(saldata.payments.length, 2)
  })

  it('conserva lo storico quando un atleta cambia squadra tra due stagioni', async () => {
    const admin = await env.login('segreteria@example.test')
    const nuova = await admin.post('/api/seasons', {
      name: 'Stagione futura A', startDate: '2090-09-01', endDate: '2091-07-31',
    })
    const seasonId = nuova.body.id as string
    const team = await admin.post('/api/teams', { name: 'Under 18', category: 'U18', seasonId })
    await admin.post(`/api/teams/${team.body.id}/members`, { personId: env.data.minor.personId })

    const scheda = (await admin.get(`/api/people/${env.data.minor.personId}`)).body
    const squadre = scheda.teams.map((t: any) => `${t.season}:${t.name}`).sort()
    assert.deepEqual(squadre, [`${env.data.seasonName}:Under 16`, 'Stagione futura A:Under 18'].sort())
  })

  it('attiva una sola stagione per volta', async () => {
    const admin = await env.login('segreteria@example.test')
    const nuova = await admin.post('/api/seasons', {
      name: 'Stagione futura B', startDate: '2091-09-01', endDate: '2092-07-31',
    })
    assert.equal((await admin.post(`/api/seasons/${nuova.body.id}/activate`)).status, 200)
    const attive = (await admin.get('/api/seasons')).body.filter((s: any) => s.isActive)
    assert.equal(attive.length, 1)
    assert.equal(attive[0].name, 'Stagione futura B')
  })

  it('rifiuta dati non validi senza toccare il database', async () => {
    const admin = await env.login('segreteria@example.test')
    assert.equal((await admin.post('/api/people', { firstName: '  ', lastName: 'X', kind: 'atleta' })).status, 400)
    assert.equal((await admin.post('/api/dues', {
      personId: env.data.minor.personId, seasonId: env.data.seasonId, description: 'Negativa', amountCents: -500,
    })).status, 400)
    assert.equal((await admin.put(`/api/medical/${env.data.minor.personId}`, {
      expiresOn: 'non-una-data',
    })).status, 400)
  })

  it('filtra tesseramenti, scadenze e quote', async () => {
    const admin = await env.login('segreteria@example.test')
    const daCompletare = (await admin.get('/api/registrations?status=da_completare')).body
    assert.ok(daCompletare.every((r: any) => r.status === 'da_completare'))
    const scaduti = (await admin.get('/api/medical?filter=scaduti')).body
    assert.deepEqual(scaduti.map((m: any) => m.personId), [env.data.athlete.personId])
    const inScadenza = (await admin.get('/api/medical?filter=in_scadenza')).body
    assert.ok(inScadenza.some((m: any) => m.personId === env.data.minor.personId))
    const aperte = (await admin.get('/api/dues?status=aperta')).body
    assert.ok(aperte.every((d: any) => d.status === 'aperta'))
  })

  it('archivia una persona senza cancellarne lo storico', async () => {
    const admin = await env.login('segreteria@example.test')
    const id = env.data.other.personId
    assert.equal((await admin.patch(`/api/people/${id}`, { archived: true })).status, 200)
    assert.ok(!(await admin.get('/api/people')).body.some((p: any) => p.id === id))
    assert.ok((await admin.get('/api/people?archived=true')).body.some((p: any) => p.id === id))
    assert.equal((await admin.get(`/api/people/${id}`)).status, 200)
  })

  it('cerca per nome o cognome', async () => {
    const admin = await env.login('segreteria@example.test')
    const res = (await admin.get('/api/people?q=verdi')).body
    assert.deepEqual(res.map((p: any) => p.lastName), ['Verdi'])
  })
})
