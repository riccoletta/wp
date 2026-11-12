import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { boot } from './helpers.js'

let env: Awaited<ReturnType<typeof boot>>
before(async () => { env = await boot() })
after(async () => { await env.close() })

const call = async (method: string, path: string, headers: Record<string, string>, body?: unknown) => {
  const res = await fetch(env.base + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

describe('origine delle richieste (CSRF)', () => {
  it('respinge una scrittura dichiarata da un sito terzo', async () => {
    const res = await call('POST', '/api/auth/login', { origin: 'https://sito-ostile.test' },
      { email: 'segreteria@example.test', password: 'password123' })
    assert.equal(res.status, 403)
    assert.match(res.body.error, /origine/i)
  })

  it('respinge una scrittura autenticata da un sito terzo, anche col cookie valido', async () => {
    const admin = await env.login('segreteria@example.test')
    const res = await call('POST', '/api/people', { origin: 'https://sito-ostile.test', cookie: admin.cookie },
      { firstName: 'Mario', lastName: 'Rossi' })
    assert.equal(res.status, 403)
  })

  it('accetta le scritture dalla propria origine', async () => {
    const origin = env.base
    const res = await call('POST', '/api/auth/login', { origin },
      { email: 'segreteria@example.test', password: 'password123' })
    assert.equal(res.status, 200)
  })

  it('non tocca le letture', async () => {
    assert.equal((await call('GET', '/api/health', { origin: 'https://sito-ostile.test' })).status, 200)
  })
})

describe('freno ai tentativi di accesso', () => {
  it('blocca con 429 dopo dieci password sbagliate sulla stessa email', async () => {
    const vittima = 'allenatore@example.test'
    for (let i = 0; i < 9; i++) {
      assert.equal((await call('POST', '/api/auth/login', {}, { email: vittima, password: 'sbagliata' })).status, 401)
    }
    assert.equal((await call('POST', '/api/auth/login', {}, { email: vittima, password: 'sbagliata' })).status, 401)
    // Decimo fallimento registrato: da qui in poi non si prova nemmeno la password.
    const bloccato = await call('POST', '/api/auth/login', {}, { email: vittima, password: 'password123' })
    assert.equal(bloccato.status, 429)
    // Il blocco è sull'email tentata, non sull'intero servizio.
    assert.equal((await call('POST', '/api/auth/login', {}, { email: 'segreteria@example.test', password: 'password123' })).status, 200)
  })
})
