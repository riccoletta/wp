/**
 * Il quadro economico di una squadra: somme per atleta e totali di rosa.
 *
 * Le quote arrivano da `api_dues_list` sotto RLS, come dal browser; l'aggregazione
 * è quella vera usata dalla scheda squadra (`web/src/lib/dues.ts`). Così la prova
 * copre insieme i due pezzi: che cosa il database lascia vedere e che cosa la
 * pagina somma.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { closeDb, initDb } from '../src/db.js'
import { seedDemo } from '../src/fixtures.js'
import { call, inDays } from './helpers.js'
import { duesByPerson, teamTotals } from '../../web/src/lib/dues.js'

type Seed = Awaited<ReturnType<typeof seedDemo>>
let data: Seed

/** Le quote della stagione viste da un ruolo, già aggregate per persona. */
const aggregate = async (authUserId: string | null, seasonId: string) =>
  duesByPerson(await call<any[]>(authUserId, 'api_dues_list', [seasonId, '']))

before(async () => {
  process.env.DATABASE_URL = ''
  await initDb({ memory: true })
  data = await seedDemo()
})
after(async () => { await closeDb() })

describe('somme delle quote per squadra', () => {
  // Prima Squadra: Luca Verdi (quota 520,00 non pagata) e Chiara Gialli (nessuna quota).
  let roster: string[]
  let secondDueId: string

  before(() => { roster = [data.athlete.personId, data.other.personId] })

  it('conta il dovuto della rosa e gli atleti senza quota', async () => {
    const totals = teamTotals(roster, await aggregate(data.admin.authUserId, data.seasonId))
    assert.deepEqual(totals, {
      amountCents: 52000, paidCents: 0, remainingCents: 52000, withoutDues: 1,
    })
  })

  it('un versamento parziale sposta lo stato e l\'incassato', async () => {
    const admin = data.admin.authUserId
    const dues = await call<any[]>(admin, 'api_dues_list', [data.seasonId, ''])
    const due = dues.find((d) => d.personId === data.athlete.personId)
    await call(admin, 'api_payment_add', [due.id, JSON.stringify({
      amountCents: 20000, paidOn: inDays(0), method: 'bonifico',
    })])

    const byPerson = await aggregate(admin, data.seasonId)
    assert.deepEqual(byPerson.get(data.athlete.personId), {
      count: 1, amountCents: 52000, paidCents: 20000, remainingCents: 32000, status: 'parziale',
    })
    assert.deepEqual(teamTotals(roster, byPerson), {
      amountCents: 52000, paidCents: 20000, remainingCents: 32000, withoutDues: 1,
    })
  })

  it('più quote sullo stesso atleta si sommano, e saldate tutte lo stato è saldata', async () => {
    const admin = data.admin.authUserId
    const created = await call<{ id: string }>(admin, 'api_due_create', [JSON.stringify({
      personId: data.athlete.personId, seasonId: data.seasonId,
      description: 'Trasferta', amountCents: 10000, dueDate: inDays(30),
    })])
    secondDueId = created.id

    let byPerson = await aggregate(admin, data.seasonId)
    assert.deepEqual(byPerson.get(data.athlete.personId), {
      count: 2, amountCents: 62000, paidCents: 20000, remainingCents: 42000, status: 'parziale',
    })

    await call(admin, 'api_payment_add', [secondDueId, JSON.stringify({
      amountCents: 10000, paidOn: inDays(0), method: 'contanti',
    })])
    const resto = (await call<any[]>(admin, 'api_dues_list', [data.seasonId, '']))
      .find((d) => d.personId === data.athlete.personId && d.remainingCents > 0)
    await call(admin, 'api_payment_add', [resto.id, JSON.stringify({
      amountCents: resto.remainingCents, paidOn: inDays(0), method: 'contanti',
    })])

    byPerson = await aggregate(admin, data.seasonId)
    assert.deepEqual(byPerson.get(data.athlete.personId), {
      count: 2, amountCents: 62000, paidCents: 62000, remainingCents: 0, status: 'saldata',
    })
    assert.deepEqual(teamTotals(roster, byPerson), {
      amountCents: 62000, paidCents: 62000, remainingCents: 0, withoutDues: 1,
    })
  })

  it('chi non ha quote resta senza quota, non a zero', async () => {
    const byPerson = await aggregate(data.admin.authUserId, data.seasonId)
    assert.equal(byPerson.get(data.other.personId), undefined)
    assert.equal(teamTotals([data.other.personId], byPerson).withoutDues, 1)
  })

  it('le quote di un\'altra stagione non entrano nel conto della squadra', async () => {
    const admin = data.admin.authUserId
    const altra = await call<{ id: string }>(admin, 'api_season_create',
      ['2040/2041', '2040-09-01', '2041-07-31'])
    await call(admin, 'api_due_create', [JSON.stringify({
      personId: data.athlete.personId, seasonId: altra.id,
      description: 'Quota 2040/2041', amountCents: 99900, dueDate: null,
    })])

    const byPerson = await aggregate(admin, data.seasonId)
    assert.equal(byPerson.get(data.athlete.personId)!.amountCents, 62000,
      'la stagione della squadra filtra: 999,00 della stagione nuova restano fuori')
  })
})

describe('i dati economici della squadra sono solo della segreteria', () => {
  it('l\'allenatore della squadra non vede nessuna quota dei suoi atleti', async () => {
    const byPerson = await aggregate(data.coachB.authUserId, data.seasonId)
    assert.equal(byPerson.size, 0, 'la RLS non restituisce righe: niente da sommare')
    assert.deepEqual(teamTotals([data.athlete.personId, data.other.personId], byPerson), {
      amountCents: 0, paidCents: 0, remainingCents: 0, withoutDues: 2,
    })
  })

  it('l\'atleta vede solo la propria posizione, non quella dei compagni', async () => {
    const byPerson = await aggregate(data.athlete.authUserId, data.seasonId)
    assert.deepEqual([...byPerson.keys()], [data.athlete.personId])
  })
})
