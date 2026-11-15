/** Regressione M10: un account può avere contemporaneamente i due ruoli.
 * Su pnm il primo amministratore è stato promosso manualmente a platform owner.
 * Prima di 0014 api_me lo riconosceva solo come admin della società.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { closeDb, initDb } from '../src/db.js'
import { makePlatformOwner, seedDemo } from '../src/fixtures.js'
import { call } from './helpers.js'

let authId: string

before(async () => {
  process.env.DATABASE_URL = ''
  await initDb({ memory: true })
  const milano = await seedDemo()
  authId = milano.admin.authUserId!
  await makePlatformOwner(authId, 'owner-and-admin@example.test')
})
after(async () => { await closeDb() })

describe('platform owner e admin di società con la stessa identità', () => {
  it('api_me privilegia platformOwner anche quando app_uid esiste', async () => {
    const me = await call<any>(authId, 'api_me')
    assert.equal(me.platformOwner, true)
    assert.equal(me.email, 'owner-and-admin@example.test')
  })

  it('il proprietario conserva il proprio ruolo entrando nella società', async () => {
    const entered = await call<any>(authId, 'api_club_enter', ['pallanuoto-milano'])
    assert.equal(entered.slug, 'pallanuoto-milano')
    const me = await call<any>(authId, 'api_me')
    assert.equal(me.platformOwner, true)
    assert.deepEqual(me.roles, ['admin'])
    assert.equal(me.club.slug, 'pallanuoto-milano')
  })

  it('il ritorno al portale non fa perdere i poteri di piattaforma', async () => {
    await call(authId, 'api_club_leave')
    const me = await call<any>(authId, 'api_me')
    assert.equal(me.platformOwner, true)
    const clubs = await call<any[]>(authId, 'api_platform_clubs')
    assert.ok(clubs.some((c) => c.slug === 'pallanuoto-milano'))
  })
})
