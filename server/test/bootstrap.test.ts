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
    await addIdentity('secondo@example.test')
    await assert.rejects(
      bootstrapAdmin({ email: 'secondo@example.test', firstName: 'Altro', lastName: 'Admin' }),
      (err: Error) => err instanceof BootstrapError && /Esiste già un amministratore/.test(err.message),
    )
    const n = await asSystem((tx) => tx.one<any>('select count(*)::int as n from app_users'))
    assert.equal(n!.n, 1, 'nessun account creato dal tentativo respinto')
  })

  it('con --aggiungi dichiarato a mano il secondo amministratore si crea', async () => {
    const res = await bootstrapAdmin({
      email: 'secondo@example.test', firstName: 'Altro', lastName: 'Admin', addition: true,
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
