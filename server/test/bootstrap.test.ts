import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApp } from '../src/app.js'
import { asSystem, closeDb, initDb, resolveCaCert } from '../src/db.js'
import { bootstrapAdmin } from '../src/bootstrap.js'

// Database vuoto: nessun seed dimostrativo, è esattamente il caso del primo avvio
// in produzione. Le credenziali qui sono sintetiche e vivono solo in memoria.
const PASSWORD = 'Password-Lunga-1'
const EMAIL = 'prima.segreteria@example.test'

let base: string
let server: ReturnType<ReturnType<typeof createApp>['listen']>

before(async () => {
  process.env.DATABASE_URL = ''
  await initDb({ memory: true })
  server = createApp().listen(0)
  await new Promise<void>((r) => server.once('listening', () => r()))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(async () => {
  await new Promise<void>((r) => server.close(() => r()))
  await closeDb()
})

const post = async (path: string, body: unknown) => {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => null), cookie: res.headers.get('set-cookie') }
}

describe('bootstrap del primo amministratore', () => {
  it('crea persona, account e ruolo admin in modo coerente', async () => {
    const res = await bootstrapAdmin({ email: EMAIL, password: PASSWORD, firstName: 'Prima', lastName: 'Segreteria' })
    assert.equal(res.outcome, 'creato')
    const row = await asSystem((tx) =>
      tx.one<any>(
        `select p.first_name, p.kind, u.email, u.active,
                (select count(*) from user_roles r where r.user_id = u.id and r.role = 'admin') as admin
           from app_users u join people p on p.id = u.person_id where u.id = $1`,
        [res.userId],
      ),
    )
    assert.equal(row.first_name, 'Prima')
    assert.equal(row.kind, 'staff')
    assert.equal(row.active, true)
    assert.equal(Number(row.admin), 1)
  })

  it('l’amministratore creato entra davvero dall’API', async () => {
    const res = await post('/api/auth/login', { email: EMAIL, password: PASSWORD })
    assert.equal(res.status, 200)
    assert.ok(res.cookie?.includes('pn_session='))
    // La sessione appena creata si presenta con il ruolo admin.
    const me = await fetch(base + '/api/auth/me', { headers: { cookie: res.cookie!.split(';')[0]! } })
    const profile = await me.json()
    assert.deepEqual(profile.roles, ['admin'])
  })

  it('è idempotente e non tocca la password esistente', async () => {
    const before = await asSystem((tx) =>
      tx.one<any>('select password_hash from app_users where lower(email) = lower($1)', [EMAIL]),
    )
    const res = await bootstrapAdmin({ email: EMAIL, password: 'Altra-Password-9', firstName: 'X', lastName: 'Y' })
    assert.equal(res.outcome, 'già-presente')
    const after = await asSystem((tx) =>
      tx.one<any>('select password_hash from app_users where lower(email) = lower($1)', [EMAIL]),
    )
    assert.equal(after.password_hash, before.password_hash)
    // La vecchia password continua a funzionare, la nuova no: niente è stato sovrascritto.
    assert.equal((await post('/api/auth/login', { email: EMAIL, password: PASSWORD })).status, 200)
    assert.equal((await post('/api/auth/login', { email: EMAIL, password: 'Altra-Password-9' })).status, 401)
  })

  it('rifiuta un secondo amministratore senza consenso esplicito', async () => {
    await assert.rejects(
      bootstrapAdmin({ email: 'altro@example.test', password: PASSWORD, firstName: 'A', lastName: 'B' }),
      /Esiste già un amministratore/,
    )
    const quanti = await asSystem((tx) => tx.query(`select 1 from user_roles where role = 'admin'`))
    assert.equal(quanti.length, 1)
  })

  it('rifiuta password deboli ed email non valide', async () => {
    await assert.rejects(
      bootstrapAdmin({ email: 'x@example.test', password: 'corta1A', firstName: 'A', lastName: 'B' }),
      /almeno 12 caratteri/,
    )
    await assert.rejects(
      bootstrapAdmin({ email: 'non-una-email', password: PASSWORD, firstName: 'A', lastName: 'B' }),
      /email non valido/i,
    )
  })
})

describe('certificato CA del database', () => {
  it('accetta il PEM inline, con \\n letterali e in base64', () => {
    const pem = `-----BEGIN CERTIFICATE-----\n${'A'.repeat(220)}\n-----END CERTIFICATE-----\n`
    assert.equal(resolveCaCert(pem), pem)
    assert.equal(resolveCaCert(pem.replace(/\n/g, '\\n')), pem)
    assert.equal(resolveCaCert(Buffer.from(pem).toString('base64')), pem)
  })

  it('un percorso inesistente è un errore parlante, non una verifica TLS abbassata', () => {
    assert.throws(
      () => resolveCaCert('/Users/qualcuno/Downloads/non-esiste.crt'),
      /DATABASE_CA_CERT non è un certificato utilizzabile/,
    )
  })
})
