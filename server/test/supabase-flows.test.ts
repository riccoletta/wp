/**
 * I flussi della FASE 1 attraverso la Data API, da capo a fondo:
 * persona → squadra → tesseramento → certificato → quota → versamento.
 *
 * Come in `supabase-rls.test.ts` le query girano come ruolo `authenticated` con i
 * claim del JWT, quindi ogni passo passa davvero dalle policy. Sostituiscono i vecchi
 * test dei flussi sull'API Express, che non esiste più.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { asDataApi, asSystem, closeDb, initDb } from '../src/db.js'
import { currentSeason, seedDemo } from '../src/fixtures.js'
import { call, inDays } from './helpers.js'

type Seed = Awaited<ReturnType<typeof seedDemo>>
let data: Seed

before(async () => {
  process.env.DATABASE_URL = ''
  await initDb({ memory: true })
  data = await seedDemo()
})
after(async () => { await closeDb() })

describe('flusso completo della segreteria', () => {
  let personId: string
  let teamId: string
  let seasonId: string
  let dueId: string

  it('crea un\'anagrafica senza account', async () => {
    const admin = data.admin.authUserId
    const created = await call<{ id: string }>(admin, 'api_person_create', [JSON.stringify({
      firstName: 'Marta', lastName: 'Esposito', birthDate: '2010-05-05', kind: 'atleta',
    })])
    personId = created.id

    const p = await call<any>(admin, 'api_person_get', [personId])
    assert.equal(p.firstName, 'Marta')
    assert.equal(p.account, null, 'l\'anagrafica esiste senza account: l\'invito è un atto separato')
    assert.deepEqual(p.teams, [])
  })

  it('la ritrova con la ricerca per nome', async () => {
    const found = await call<any[]>(data.admin.authUserId, 'api_people_list', ['esposito', '', false])
    assert.equal(found.length, 1)
    assert.equal(found[0].id, personId)
  })

  it('crea una stagione e una squadra, e la stagione attiva resta una sola', async () => {
    const admin = data.admin.authUserId
    const s = currentSeason()
    const nuova = await call<{ id: string }>(admin, 'api_season_create',
      [`${s.name} bis`, '2031-09-01', '2032-07-31'])
    await call(admin, 'api_season_activate', [nuova.id])

    const attive = (await call<any[]>(admin, 'api_seasons_list')).filter((x) => x.isActive)
    assert.deepEqual(attive.map((x) => x.id), [nuova.id], 'una sola stagione attiva')
    seasonId = nuova.id

    const team = await call<{ id: string }>(admin, 'api_team_create', ['Under 14', 'U14', seasonId])
    teamId = team.id
    const teams = await call<any[]>(admin, 'api_teams_list', [seasonId])
    assert.deepEqual(teams.map((t) => t.name), ['Under 14'])
  })

  it('mette l\'atleta in rosa e lo storico per stagione resta', async () => {
    const admin = data.admin.authUserId
    await call(admin, 'api_team_member_add', [teamId, personId])
    const team = await call<any>(admin, 'api_team_get', [teamId])
    assert.deepEqual(team.roster.map((r: any) => r.id), [personId])

    const p = await call<any>(admin, 'api_person_get', [personId])
    assert.equal(p.teams.length, 1)
    assert.equal(p.teams[0].name, 'Under 14')
  })

  it('registra tesseramento e scadenza del certificato', async () => {
    const admin = data.admin.authUserId
    await call(admin, 'api_registration_save', [JSON.stringify({
      personId, seasonId, status: 'in_corso', submittedOn: inDays(-2), notes: 'In attesa del certificato',
    })])
    await call(admin, 'api_medical_save', [personId, 'agonistico', inDays(20)])

    const p = await call<any>(admin, 'api_person_get', [personId])
    assert.equal(p.registrations[0].status, 'in_corso')
    assert.equal(p.medical.expiresOn, inDays(20))

    // Il secondo salvataggio aggiorna il primo: un tesseramento per atleta e stagione.
    await call(admin, 'api_registration_save', [JSON.stringify({ personId, seasonId, status: 'attivo' })])
    const dopo = await call<any>(admin, 'api_person_get', [personId])
    assert.equal(dopo.registrations.length, 1)
    assert.equal(dopo.registrations[0].status, 'attivo')
  })

  it('il certificato in scadenza compare fra le scadenze a 30 giorni', async () => {
    const rows = await call<any[]>(data.admin.authUserId, 'api_medical_list', ['in_scadenza'])
    const mio = rows.find((r) => r.personId === personId)
    assert.ok(mio, 'la scadenza deve comparire nel filtro "in scadenza"')
    assert.equal(mio.daysLeft, 20)
  })

  it('crea una quota e lo stato è derivato dai versamenti', async () => {
    const admin = data.admin.authUserId
    const due = await call<{ id: string }>(admin, 'api_due_create', [JSON.stringify({
      personId, seasonId, description: 'Quota annuale', amountCents: 30000, dueDate: inDays(30),
    })])
    dueId = due.id

    let d = await call<any>(admin, 'api_due_get', [dueId])
    assert.equal(d.status, 'aperta')
    assert.equal(d.remainingCents, 30000)

    await call(admin, 'api_payment_add', [dueId, JSON.stringify({
      amountCents: 10000, paidOn: inDays(0), method: 'bonifico',
    })])
    d = await call<any>(admin, 'api_due_get', [dueId])
    assert.equal(d.status, 'parziale')
    assert.equal(d.paidCents, 10000)
    assert.equal(d.remainingCents, 20000)

    await call(admin, 'api_payment_add', [dueId, JSON.stringify({
      amountCents: 20000, paidOn: inDays(0), method: 'contanti',
    })])
    d = await call<any>(admin, 'api_due_get', [dueId])
    assert.equal(d.status, 'saldata')
    assert.equal(d.remainingCents, 0)
    assert.equal(d.payments.length, 2)
  })

  it('togliere un versamento riporta indietro lo stato', async () => {
    const admin = data.admin.authUserId
    const d = await call<any>(admin, 'api_due_get', [dueId])
    await call(admin, 'api_payment_delete', [dueId, d.payments[0].id])
    const dopo = await call<any>(admin, 'api_due_get', [dueId])
    assert.equal(dopo.status, 'parziale')
    assert.equal(dopo.paidCents, 20000)
  })

  it('archivia la persona senza cancellarne i dati', async () => {
    const admin = data.admin.authUserId
    await call(admin, 'api_person_update', [personId, JSON.stringify({ archived: true })])
    const attive = await call<any[]>(admin, 'api_people_list', ['', '', false])
    assert.ok(!attive.some((p) => p.id === personId), 'non compare più fra le attive')
    const archiviate = await call<any[]>(admin, 'api_people_list', ['', '', true])
    assert.ok(archiviate.some((p) => p.id === personId), 'resta fra le archiviate')
    const p = await call<any>(admin, 'api_person_get', [personId])
    assert.equal(p.dues.length, 1, 'i dati amministrativi restano')
  })
})

describe('tutori e minori', () => {
  it('collega e scollega un tutore, e il tutore vede il minore', async () => {
    const admin = data.admin.authUserId
    await call(admin, 'api_guardian_add', [data.other.personId, data.guardian.personId])

    const visto = await call<any>(data.guardian.authUserId, 'api_person_get', [data.other.personId])
    assert.ok(visto, 'il tutore collegato vede il minore')

    await call(admin, 'api_guardian_remove', [data.other.personId, data.guardian.personId])
    const dopo = await call<any>(data.guardian.authUserId, 'api_person_get', [data.other.personId])
    assert.equal(dopo, null, 'tolto il legame, il minore non è più visibile')
  })
})

describe('identità e ruoli', () => {
  it('api_me restituisce la persona e i ruoli dell\'identità collegata', async () => {
    const me = await call<any>(data.coachA.authUserId, 'api_me')
    assert.equal(me.personId, data.coachA.personId)
    assert.deepEqual(me.roles, ['coach'])
    assert.equal(me.firstName, 'Marco')
  })

  it('un\'identità Supabase senza utente applicativo non è nessuno', async () => {
    const me = await call<any>(crypto.randomUUID(), 'api_me')
    assert.equal(me, null)
  })

  it('un account disattivato non è più nessuno', async () => {
    await asSystem((tx) => tx.query('update app_users set active = false where id = $1', [data.coachB.userId]))
    try {
      assert.equal(await call<any>(data.coachB.authUserId, 'api_me'), null)
      const people = await asDataApi(data.coachB.authUserId, (tx) => tx.query('select id from people'))
      assert.deepEqual(people, [])
    } finally {
      await asSystem((tx) => tx.query('update app_users set active = true where id = $1', [data.coachB.userId]))
    }
  })
})
