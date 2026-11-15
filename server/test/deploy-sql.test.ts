/**
 * Gli script che si incollano nel pannello Supabase, eseguiti davvero.
 *
 * Non si consegna uno script SQL senza averlo visto girare: qui i quattro file
 * di `db/deploy/` passano su un PostgreSQL vero (PGlite), nell'ordine previsto,
 * su un database che parte **pre-M10** — migrazioni `0001`–`0011` e basta —
 * come il progetto remoto. Si usa PGlite direttamente perché questi file sono
 * multi-istruzione, come il SQL Editor li manda.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { deploySqlIsCurrent } from '../src/deploy-sql.js'
import { refuseRemoteDatabase } from '../src/remote-guard.js'

const root = path.resolve(import.meta.dirname, '../..')
const leggi = (p: string) => readFile(path.join(root, p), 'utf8')
const righe = async (db: PGlite, sql: string) => (await db.query<any>(sql)).rows

let db: PGlite

before(async () => {
  db = new PGlite({ parsers: { 1082: (v: string) => v } })
  await db.waitReady

  // Schema di partenza: tutto tranne M10, come il progetto remoto prima del passo 2.
  const files = (await readdir(path.join(root, 'db/migrations'))).filter((f) => f.endsWith('.sql')).sort()
  await db.exec('create table schema_migrations (version text primary key, applied_at timestamptz default now())')
  for (const f of files) {
    if (f.startsWith('0012') || f.startsWith('0013')) continue
    await db.exec(await leggi(`db/migrations/${f}`))
    await db.query('insert into schema_migrations (version) values ($1)', [f])
  }

  // Impalcatura: fuori da Supabase `auth.users` non esiste. Gli script la usano
  // per i controlli sulle identità, quindi qui la si costruisce com'è là.
  await db.exec(`create table auth.users (
    id uuid primary key default gen_random_uuid(), email text unique,
    created_at timestamptz default now(), last_sign_in_at timestamptz, email_confirmed_at timestamptz)`)

  // Un po' di dati "di prima", con l'amministratore collegato alla sua identità.
  await db.exec(`
    insert into auth.users (email, last_sign_in_at) values ('segreteria@example.test', now());
    insert into auth.users (email) values ('riccardocoletta@yahoo.it');
    insert into people (first_name, last_name, kind, email)
      values ('Giulia','Segreteria','staff','segreteria@example.test');
    insert into people (first_name, last_name, birth_date) values ('Luca','Verdi','2000-04-12');
    insert into app_users (person_id, email, auth_user_id)
      select p.id, 'segreteria@example.test', (select id from auth.users where email = 'segreteria@example.test')
        from people p where p.email = 'segreteria@example.test';
    insert into user_roles (user_id, role) select id, 'admin' from app_users;
    insert into seasons (name, start_date, end_date, is_active)
      values ('2025/2026','2025-09-01','2026-07-31', true);
    insert into teams (season_id, name, category) select id, 'Under 16', 'U16' from seasons;
    insert into team_memberships (team_id, person_id)
      select t.id, p.id from teams t, people p where p.last_name = 'Verdi';
    insert into registrations (person_id, season_id, status)
      select p.id, s.id, 'attivo' from people p, seasons s where p.last_name = 'Verdi';
    insert into medical_expiries (person_id, expires_on)
      select id, current_date + 30 from people where last_name = 'Verdi';
    insert into dues (person_id, season_id, description, amount_cents)
      select p.id, s.id, 'Quota annuale', 45000 from people p, seasons s where p.last_name = 'Verdi';
    insert into payment_records (due_id, amount_cents) select id, 20000 from dues;`)
})
after(async () => { await db.close() })

describe('script per il pannello Supabase', () => {
  it('lo script di migrazione è ancora quello generato dalle migrazioni', async () => {
    assert.ok(await deploySqlIsCurrent(),
      'db/deploy/02-migrazione-m10.sql è vecchio: rilancia `npm run deploy:sql`')
  })

  it('01 — ispeziona senza toccare niente', async () => {
    const prima = await righe(db, 'select count(*)::int as n from people')
    await db.exec(await leggi('db/deploy/01-ispezione.sql'))
    const esito = await righe(db, 'select sezione, voce, valore from ispezione order by voce')

    assert.ok(esito.some((r) => r.sezione === 'conteggi' && r.voce === 'people' && r.valore === '2'))
    assert.ok(esito.some((r) => r.sezione === 'conteggi' && r.voce === 'clubs'
      && r.valore === 'tabella non presente'), 'prima della migrazione le società non esistono')
    assert.ok(esito.some((r) => r.sezione === 'account' && /admin/.test(r.valore)))
    assert.ok(esito.some((r) => r.voce === 'dovuto (quote)' && r.valore === '45000 centesimi'))
    assert.deepEqual(await righe(db, 'select count(*)::int as n from people'), prima)
  })

  it('02 — applica M10 e registra le migrazioni', async () => {
    await db.exec(await leggi('db/deploy/02-migrazione-m10.sql'))

    const applicate = await righe(db,
      `select version from schema_migrations
        where version in ('0012_clubs.sql', '0013_platform_api.sql') order by version`)
    assert.deepEqual(applicate.map((r) => r.version), ['0012_clubs.sql', '0013_platform_api.sql'])

    const club = await righe(db, 'select slug, name from clubs')
    assert.deepEqual(club, [{ slug: 'pallanuoto-milano', name: 'Pallanuoto Milano' }])

    // I dati di prima sono ancora tutti lì, e ora appartengono alla società.
    const persone = await righe(db, 'select count(*)::int as n from people where club_id is not null')
    assert.equal(persone[0].n, 2)
    const versamenti = await righe(db, 'select sum(amount_cents)::int as somma from payment_records')
    assert.equal(versamenti[0].somma, 20000)
  })

  it('02 — rieseguito non cambia niente', async () => {
    const prima = await righe(db,
      `select (select count(*) from people)::int as persone, (select count(*) from clubs)::int as societa,
              (select count(*) from subscriptions)::int as abbonamenti,
              (select count(*) from pg_policies where schemaname='public')::int as policy`)
    await db.exec(await leggi('db/deploy/02-migrazione-m10.sql'))
    const dopo = await righe(db,
      `select (select count(*) from people)::int as persone, (select count(*) from clubs)::int as societa,
              (select count(*) from subscriptions)::int as abbonamenti,
              (select count(*) from pg_policies where schemaname='public')::int as policy`)
    assert.deepEqual(dopo, prima)
  })

  it('03 — la verifica passa tutti i controlli', async () => {
    const esiti = await righe(db, await leggi('db/deploy/03-verifica.sql'))
    const falliti = esiti.filter((r) => r.esito === 'NO')
    assert.deepEqual(falliti, [], 'controlli falliti sul database appena migrato')

    const complessivo = esiti.find((r) => r.controllo === 'ESITO COMPLESSIVO')
    assert.equal(complessivo.esito, 'TUTTO OK')
    assert.ok(esiti.length >= 30, 'la verifica deve coprire tutto, non due righe')
  })

  it('03 — si accorge se un dato manca davvero', async () => {
    const conAttesi = (await leggi('db/deploy/03-verifica.sql'))
      .replace('null::bigint as persone,', '999::bigint as persone,')
    const esiti = await righe(db, conAttesi)
    const persone = esiti.find((r) => r.controllo === 'persone conservate')
    assert.equal(persone.esito, 'NO', 'un conteggio che non torna deve dare NO')
    assert.equal(esiti.find((r) => r.controllo === 'ESITO COMPLESSIVO').esito, 'CONTROLLI FALLITI')
  })

  it('04 — promuove soltanto quell\'indirizzo', async () => {
    await db.exec(await leggi('db/deploy/04-proprietario.sql'))
    const owner = await righe(db, 'select email from platform_owners')
    assert.deepEqual(owner.map((r) => r.email), ['riccardocoletta@yahoo.it'])

    // La segreteria resta segreteria: nessuna promozione di contorno.
    const admin = await righe(db,
      `select u.email from app_users u join user_roles r on r.user_id = u.id where r.role = 'admin'`)
    assert.deepEqual(admin.map((r) => r.email), ['segreteria@example.test'])
  })

  it('04 — rilanciato non duplica, e si ferma davanti a un secondo proprietario', async () => {
    await db.exec(await leggi('db/deploy/04-proprietario.sql'))
    assert.equal((await righe(db, 'select count(*)::int as n from platform_owners'))[0].n, 1)

    await db.exec(`insert into auth.users (email) values ('altro@example.test')`)
    const altro = (await leggi('db/deploy/04-proprietario.sql'))
      .replace(/riccardocoletta@yahoo\.it/g, 'altro@example.test')
    await assert.rejects(() => db.exec(altro), /altro proprietario/i)
    assert.equal((await righe(db, 'select count(*)::int as n from platform_owners'))[0].n, 1)
  })
})

describe('il terminale non parla più col database remoto', () => {
  const salva = { ...process.env }
  const prova = (env: Record<string, string | undefined>) => {
    Object.assign(process.env, env)
    try { refuseRemoteDatabase('npm run migrate'); return null }
    catch (err) { return (err as Error).message }
    finally { process.env = { ...salva } }
  }

  it('si ferma davanti a un database gestito', () => {
    const msg = prova({ DATABASE_URL: 'postgresql://u:p@aws-0-eu-west-3.pooler.supabase.com:5432/postgres' })
    assert.match(msg ?? '', /pannello Supabase/)
    assert.match(msg ?? '', /db\/deploy/)
  })

  it('lascia lavorare in locale', () => {
    assert.equal(prova({ DATABASE_URL: '', MIGRATION_DATABASE_URL: '' }), null, 'PGlite')
    assert.equal(prova({ DATABASE_URL: 'postgresql://u:p@localhost:5432/postgres' }), null, 'Postgres locale')
  })

  it('la scappatoia è dichiarata, non nascosta', () => {
    assert.equal(prova({
      DATABASE_URL: 'postgresql://u:p@db.example.supabase.co:5432/postgres',
      ALLOW_REMOTE_DB: 'true',
    }), null)
  })
})
