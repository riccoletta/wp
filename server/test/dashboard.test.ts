import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { boot } from './helpers.js'

let env: Awaited<ReturnType<typeof boot>>
before(async () => { env = await boot() })
after(async () => { await env.close() })

describe('dashboard: contatori per ruolo', () => {
  it('mostra alla segreteria scadenze e insoluti di tutto il club', async () => {
    const admin = await env.login('segreteria@example.test')
    const d = (await admin.get('/api/dashboard')).body
    assert.equal(d.counts.medicalExpired, 1)
    assert.equal(d.counts.medicalSoon, 1)
    assert.equal(d.counts.registrationsPending, 1)
    assert.equal(d.counts.duesOpen, 2)
    assert.equal(d.counts.duesRemainingCents, 25000 + 52000)
    assert.equal(d.season.name, env.data.seasonName)
    assert.equal(d.teams.length, 2)
  })

  it('conta per l\'allenatore solo le proprie squadre e nessuna quota', async () => {
    const coachA = await env.login('coach.a@example.test')
    const d = (await coachA.get('/api/dashboard')).body
    assert.equal(d.counts.duesOpen, 0)
    assert.equal(d.counts.duesRemainingCents, 0)
    assert.equal(d.counts.medicalSoon, 1)
    assert.equal(d.counts.medicalExpired, 0)
    assert.deepEqual(d.teams.map((t: any) => t.name), ['Under 16'])
  })

  it('conta per il tutore solo la posizione del proprio minore', async () => {
    const tutore = await env.login('tutore@example.test')
    const d = (await tutore.get('/api/dashboard')).body
    assert.equal(d.counts.duesOpen, 1)
    assert.equal(d.counts.duesRemainingCents, 25000)
    assert.equal(d.counts.peopleActive, 2)
  })
})
