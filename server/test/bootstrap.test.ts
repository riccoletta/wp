/**
 * Primo amministratore del club.
 *
 * È un percorso sensibile: crea l'unico account che può scrivere tutto. Il vecchio
 * test copriva la versione `scrypt`, che non esiste più; questo copre quella che
 * collega un'identità **già presente in Supabase Auth**.
 *
 * PGlite non ha `auth.users` (la migrazione 0009 crea solo lo schema e `auth.uid()`),
 * quindi la tabella la costruiamo qui: è impalcatura di prova, non uno schema reale.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { asSystem, closeDb, initDb } from '../src/db.js'
import { bootstrapAdmin, BootstrapError } from '../src/bootstrap.js'
import { listPlatformOwners, promotePlatformOwner, PlatformOwnerError } from '../src/platform.js'

/** Registra un'identità Supabase finta e ne restituisce l'id. */
const addIdentity = (email: string) => asSystem(async (tx) => {
  const row = await tx.one<any>(
    'insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id', [email])
  return row!.id as string
})

before(async () => {
  process.env.DATABASE_URL = ''
  await initDb({ memory: true })
  await asSystem((tx) => tx.query(
    'create table if not exists auth.users (id uuid primary key, email text unique)'))
})
after(async () => { await closeDb() })

const roles = (userId: string) => asSystem((tx) =>
  tx.query<any>('select role from user_roles where user_id = $1', [userId])
    .then((rs) => rs.map((r) => r.role).sort()))

describe('primo amministratore', () => {
  it("si rifiuta se l'identità Supabase non esiste ancora", async () => {
    await assert.rejects(
      bootstrapAdmin({ email: 'mai@example.test', firstName: 'Mai', lastName: 'Invitato' }),
      (err: Error) => err instanceof BootstrapError && /Authentication → Users/.test(err.message),
    )
    const people = await asSystem((tx) => tx.query('select 1 from people'))
    assert.deepEqual(people, [], 'nessuna riga scritta se il bootstrap si ferma')
  })

  it("crea persona, account e ruolo admin collegati all'identità", async () => {
    const identity = await addIdentity('capo@example.test')
    const res = await bootstrapAdmin({
      email: 'capo@example.test', firstName: 'Giulia', lastName: 'Segreteria',
    })
    assert.equal(res.outcome, 'creato')
    assert.equal(res.authUserId, identity)
    assert.deepEqual(await roles(res.userId), ['admin'])

    const user = await asSystem((tx) => tx.one<any>(
      'select auth_user_id, password_hash, active from app_users where id = $1', [res.userId]))
    assert.equal(user!.auth_user_id, identity)
    assert.equal(user!.password_hash, null, 'le credenziali vivono in Supabase Auth, non qui')
    assert.equal(user!.active, true)
  })

  it('rilanciato sullo stesso amministratore non duplica nulla', async () => {
    const res = await bootstrapAdmin({
      email: 'capo@example.test', firstName: 'Giulia', lastName: 'Segreteria',
    })
    assert.equal(res.outcome, 'già-presente')
    const n = await asSystem((tx) => tx.one<any>('select count(*)::int as n from app_users'))
    assert.equal(n!.n, 1)
  })

  it('si rifiuta di creare un secondo amministratore senza consenso esplicito', async () => {
    await addIdentity('altro-proprietario@example.test')
    await assert.rejects(
      bootstrapAdmin({ email: 'altro-proprietario@example.test', firstName: 'Altro', lastName: 'Admin' }),
      (err: Error) => err instanceof BootstrapError && /Esiste già un amministratore/.test(err.message),
    )
    const n = await asSystem((tx) => tx.one<any>('select count(*)::int as n from app_users'))
    assert.equal(n!.n, 1, 'nessun account creato dal tentativo respinto')
  })

  it('con --aggiungi dichiarato a mano il secondo amministratore si crea', async () => {
    const res = await bootstrapAdmin({
      email: 'altro-proprietario@example.test', firstName: 'Altro', lastName: 'Admin', addition: true,
    })
    assert.equal(res.outcome, 'creato')
    assert.deepEqual(await roles(res.userId), ['admin'])
  })

  it('rifiuta email non valide e nomi vuoti', async () => {
    await assert.rejects(
      bootstrapAdmin({ email: 'non-una-email', firstName: 'A', lastName: 'B' }),
      (err: Error) => /email non valido/i.test(err.message))
    await assert.rejects(
      bootstrapAdmin({ email: 'capo@example.test', firstName: ' ', lastName: 'B' }),
      (err: Error) => /obbligatori/i.test(err.message))
  })
})

describe('proprietario della piattaforma', () => {
  it('si rifiuta se l\'identità Supabase non esiste', async () => {
    await assert.rejects(
      promotePlatformOwner({ email: 'mai@example.test' }),
      (err: Error) => err instanceof PlatformOwnerError && /Invite user/.test(err.message),
    )
  })

  it('promuove una sola identità e la registra', async () => {
    const identity = await addIdentity('proprietario@example.test')
    const res = await promotePlatformOwner({ email: 'proprietario@example.test', note: 'contratto' })
    assert.equal(res.outcome, 'promosso')
    assert.equal(res.authUserId, identity)

    const owners = await listPlatformOwners()
    assert.deepEqual(owners.map((o) => o.email), ['proprietario@example.test'])
    assert.equal(owners[0].note, 'contratto')
  })

  it('non promuove per sbaglio gli amministratori di società', async () => {
    // `capo@example.test` è la segreteria creata dalle prove qui sopra: resta tale.
    const owners = await listPlatformOwners()
    assert.ok(owners.every((o) => o.email !== 'capo@example.test'))
    const admins = await asSystem((tx) => tx.query<any>(
      `select u.email from user_roles r join app_users u on u.id = r.user_id where r.role = 'admin'`))
    assert.ok(admins.length > 0, 'gli amministratori di società ci sono ancora')
    assert.ok(admins.every((a) => a.email !== 'proprietario@example.test'))
  })

  it('rilanciato sulla stessa identità non duplica nulla', async () => {
    const res = await promotePlatformOwner({ email: 'proprietario@example.test' })
    assert.equal(res.outcome, 'già-presente')
    assert.equal((await listPlatformOwners()).length, 1)
  })

  it('si ferma davanti a un secondo proprietario senza consenso esplicito', async () => {
    await addIdentity('secondo-proprietario@example.test')
    await assert.rejects(
      promotePlatformOwner({ email: 'secondo-proprietario@example.test' }),
      (err: Error) => err instanceof PlatformOwnerError && /--aggiungi/.test(err.message),
    )
    assert.equal((await listPlatformOwners()).length, 1)

    await promotePlatformOwner({ email: 'secondo-proprietario@example.test', addition: true })
    assert.equal((await listPlatformOwners()).length, 2)
  })
})
