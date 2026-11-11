import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { boot } from './helpers.js'

let env: Awaited<ReturnType<typeof boot>>
before(async () => { env = await boot() })
after(async () => { await env.close() })

describe('autenticazione', () => {
  it('rifiuta le API senza sessione', async () => {
    assert.equal((await env.anon.get('/api/people')).status, 401)
    assert.equal((await env.anon.get('/api/dashboard')).status, 401)
    assert.equal((await env.anon.get('/api/dues')).status, 401)
  })

  it('rifiuta una password errata senza rivelare se l\'utente esiste', async () => {
    const res = await env.anon.post('/api/auth/login', { email: 'segreteria@example.test', password: 'sbagliata' })
    const unknown = await env.anon.post('/api/auth/login', { email: 'nessuno@example.test', password: 'sbagliata' })
    assert.equal(res.status, 401)
    assert.deepEqual(res.body, unknown.body)
  })

  it('accetta credenziali valide e restituisce il profilo', async () => {
    const admin = await env.login('segreteria@example.test')
    const me = await admin.get('/api/auth/me')
    assert.equal(me.status, 200)
    assert.deepEqual(me.body.roles, ['admin'])
    assert.equal(me.body.firstName, 'Giulia')
  })

  it('chiude la sessione al logout', async () => {
    const admin = await env.login('segreteria@example.test')
    assert.equal((await admin.post('/api/auth/logout')).status, 200)
    admin.cookie = ''
    assert.equal((await admin.get('/api/auth/me')).status, 401)
  })

  it('crea un account solo tramite invito, e l\'invito vale una volta sola', async () => {
    const admin = await env.login('segreteria@example.test')
    const invite = await admin.post(`/api/people/${env.data.other.personId}/invite`, {
      email: 'chiara@example.test', roles: ['athlete'],
    })
    assert.equal(invite.status, 200)
    const token = invite.body.token as string

    const preview = await env.anon.get(`/api/auth/invite/${token}`)
    assert.equal(preview.body.firstName, 'Chiara')

    const accepted = await env.anon.post('/api/auth/accept-invite', { token, password: 'nuovapassword' })
    assert.equal(accepted.status, 200)
    const nuovo = await env.login('chiara@example.test', 'nuovapassword')
    assert.deepEqual((await nuovo.get('/api/auth/me')).body.roles, ['athlete'])

    const replay = await env.anon.post('/api/auth/accept-invite', { token, password: 'altrapassword' })
    assert.equal(replay.status, 404)
  })

  it('non lascia invitare a un utente non amministratore', async () => {
    const coach = await env.login('coach.a@example.test')
    const res = await coach.post(`/api/people/${env.data.athlete.personId}/invite`, {
      email: 'abuso@example.test', roles: ['admin'],
    })
    assert.equal(res.status, 403)
  })

  it('valida i dati in ingresso', async () => {
    assert.equal((await env.anon.post('/api/auth/login', { email: 'non-una-email' })).status, 400)
  })
})
