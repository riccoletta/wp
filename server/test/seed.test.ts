import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { boot } from './helpers.js'
import { asSystem } from '../src/db.js'
import { seedDemo } from '../src/fixtures.js'

let env: Awaited<ReturnType<typeof boot>>
before(async () => { env = await boot() })
after(async () => { await env.close() })

const count = (table: string) =>
  asSystem(async (tx) => Number((await tx.one<any>(`select count(*)::int as n from ${table}`))!.n))

const snapshot = async () => ({
  seasons: await count('seasons'),
  teams: await count('teams'),
  people: await count('people'),
  users: await count('app_users'),
  roles: await count('user_roles'),
  memberships: await count('team_memberships'),
  coaches: await count('coach_assignments'),
  guardians: await count('guardian_links'),
  registrations: await count('registrations'),
  expiries: await count('medical_expiries'),
  dues: await count('dues'),
  payments: await count('payment_records'),
})

describe('seed idempotente', () => {
  it('rieseguito non duplica righe e non crea una seconda stagione attiva', async () => {
    const before = await snapshot()
    const again = await seedDemo()
    assert.deepEqual(await snapshot(), before)
    assert.equal(again.seasonId, env.data.seasonId)
    assert.equal(await count('seasons where is_active'), 1)
  })

  it('preserva i dati modificati dalla segreteria invece di sovrascriverli', async () => {
    const admin = await env.login('segreteria@example.test')
    assert.equal((await admin.put('/api/registrations', {
      personId: env.data.minor.personId, seasonId: env.data.seasonId, status: 'attivo',
    })).status, 200)

    await seedDemo()

    const row = await asSystem((tx) => tx.one<any>(
      'select status from registrations where person_id = $1 and season_id = $2',
      [env.data.minor.personId, env.data.seasonId]))
    assert.equal(row!.status, 'attivo')
  })

  it('riusa la stagione attiva già presente, anche con un altro nome', async () => {
    await asSystem((tx) => tx.query('update seasons set name = $1 where is_active', ['Stagione reale']))
    const out = await seedDemo()
    assert.equal(out.seasonName, 'Stagione reale')
    assert.equal(await count('seasons where is_active'), 1)
    assert.equal(await count('seasons'), 1)
  })
})
