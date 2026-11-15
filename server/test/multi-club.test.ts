/**
 * Due società sullo stesso database, e un proprietario della piattaforma.
 *
 * Come le altre prove della Data API: ruolo `authenticated` e claim del JWT, quindi
 * ogni riga passa davvero dalle policy. Qui si verifica la cosa che conta di più di
 * tutto M10: che **nessuno veda la società dell'altro**, nemmeno cambiando a mano il
 * parametro di una RPC, e che l'abbonamento di una non tocchi l'altra.
 */
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { asDataApi, asSystem, closeDb, initDb } from '../src/db.js'
import { makePlatformOwner, seedDemo } from '../src/fixtures.js'
import { call, denied, inDays, rpc, sqlstate } from './helpers.js'

type Seed = Awaited<ReturnType<typeof seedDemo>>
let milano: Seed
let brianza: Seed
const owner = randomUUID()

const enter = (auth: string, slug: string) => call(auth, 'api_club_enter', [slug])

before(async () => {
  process.env.DATABASE_URL = ''
  await initDb({ memory: true })
  milano = await seedDemo()
  brianza = await seedDemo({ slug: 'nuoto-brianza', name: 'Nuoto Brianza' })
  await makePlatformOwner(owner, 'proprietario@example.test')
})
after(async () => { await closeDb() })

describe('migrazione: i dati di prima sono di Pallanuoto Milano', () => {
  it('la prima società esiste e nessun dato è rimasto senza società', async () => {
    const club = await asSystem((tx) => tx.one<any>(
      `select id, name from clubs where slug = 'pallanuoto-milano'`))
    assert.equal(club!.name, 'Pallanuoto Milano')

    const tables = ['people', 'app_users', 'seasons', 'teams', 'team_memberships',
      'coach_assignments', 'guardian_links', 'registrations', 'medical_expiries',
      'dues', 'payment_records']
    for (const t of tables) {
      const orfane = await asSystem((tx) => tx.one<any>(
        `select count(*)::int as n from ${t} where club_id is null`))
      assert.equal(orfane!.n, 0, `${t}: nessuna riga senza società`)
    }
  })

  it("la licenza unica è diventata l'abbonamento della prima società", async () => {
    const licenza = await asSystem((tx) => tx.one<any>(
      'select status, expires_on, grace_days from license'))
    const abbonamento = await asSystem((tx) => tx.one<any>(
      'select status, expires_on, grace_days from subscriptions where club_id = $1', [milano.clubId]))
    assert.equal(abbonamento!.status, licenza!.status)
    assert.equal(abbonamento!.expires_on, licenza!.expires_on)
    assert.equal(abbonamento!.grace_days, licenza!.grace_days)
  })
})

describe('proprietario della piattaforma', () => {
  it('vede tutte le società con i contatori giusti', async () => {
    const clubs = await call<any[]>(owner, 'api_platform_clubs')
    assert.deepEqual(clubs.map((c) => c.slug).sort(), ['nuoto-brianza', 'pallanuoto-milano'])
    const pnm = clubs.find((c) => c.slug === 'pallanuoto-milano')
    assert.equal(pnm.teams, 2)
    assert.equal(pnm.athletes, 3, 'tre atleti non archiviati nei dati di esempio')
    assert.equal(pnm.admins, 1)
    assert.equal(pnm.subscription.phase, 'attiva')
  })

  it('entra in una società e vede quella, non le altre', async () => {
    await enter(owner, 'pallanuoto-milano')
    const me = await call<any>(owner, 'api_me')
    assert.equal(me.platformOwner, true)
    assert.equal(me.club.slug, 'pallanuoto-milano')
    assert.deepEqual(me.roles, ['admin'], 'dentro una società il proprietario la amministra')

    const persone = await call<any[]>(owner, 'api_people_list')
    const cognomi = persone.map((p) => `${p.lastName} ${p.firstName}`)
    assert.ok(cognomi.includes('Verdi Luca'))
    const squadre = await call<any[]>(owner, 'api_teams_list')
    assert.ok(squadre.every((t) => t.id === milano.teamA || t.id === milano.teamB),
      'solo le squadre della società in cui è entrato')
  })

  it("passa all'altra società e la vista cambia tutta", async () => {
    await enter(owner, 'nuoto-brianza')
    const me = await call<any>(owner, 'api_me')
    assert.equal(me.club.slug, 'nuoto-brianza')
    const squadre = await call<any[]>(owner, 'api_teams_list')
    assert.deepEqual(squadre.map((t) => t.id).sort(), [brianza.teamA, brianza.teamB].sort())

    const quoteMilano = await call<any[]>(owner, 'api_dues_list', [milano.seasonId, ''])
    assert.deepEqual(quoteMilano, [], 'la stagione di un’altra società non restituisce nulla')
  })

  it('uscito dalle società non amministra più niente', async () => {
    await call(owner, 'api_club_leave')
    const me = await call<any>(owner, 'api_me')
    assert.equal(me.club, null)
    assert.deepEqual(me.roles, [])
    assert.deepEqual(await call<any[]>(owner, 'api_people_list'), [])
  })
})

describe('una società non vede l’altra', () => {
  it("l'admin di Milano vede solo Milano, anche cambiando i parametri", async () => {
    const admin = milano.admin.authUserId!
    const mie = await call<any[]>(admin, 'api_my_clubs')
    assert.deepEqual(mie.map((c) => c.slug), ['pallanuoto-milano'])

    // Parametri falsificati: id veri, ma di un'altra società.
    assert.equal(await call(admin, 'api_team_get', [brianza.teamA]), null)
    assert.equal(await call(admin, 'api_person_get', [brianza.athlete.personId]), null)
    assert.deepEqual(await call<any[]>(admin, 'api_dues_list', [brianza.seasonId, '']), [])
    assert.deepEqual(await call<any[]>(admin, 'api_registrations_list', [brianza.seasonId, '']), [])

    const seasons = await call<any[]>(admin, 'api_seasons_list')
    assert.ok(seasons.every((s) => s.id === milano.seasonId))
  })

  it("l'admin di Milano non scrive niente in Brianza", async () => {
    const admin = milano.admin.authUserId!
    assert.ok(denied(await sqlstate(() =>
      call(admin, 'api_person_update', [brianza.athlete.personId, JSON.stringify({ lastName: 'Rubata' })]))))
    assert.ok(denied(await sqlstate(() =>
      call(admin, 'api_team_member_remove', [brianza.teamB, brianza.athlete.personId]))))

    // L'anagrafica di Brianza resta quella che era.
    const intatta = await asSystem((tx) => tx.one<any>(
      'select last_name from people where id = $1', [brianza.athlete.personId]))
    assert.equal(intatta!.last_name, 'Verdi')
  })

  it('non si entra in una società che non è la propria', async () => {
    assert.ok(denied(await sqlstate(() => enter(milano.admin.authUserId!, 'nuoto-brianza'))))
    const me = await call<any>(milano.admin.authUserId!, 'api_me')
    assert.equal(me.club.slug, 'pallanuoto-milano')
  })

  it('i poteri di piattaforma sono chiusi agli amministratori di società', async () => {
    const admin = milano.admin.authUserId!
    assert.ok(denied(await sqlstate(() => call(admin, 'api_platform_clubs'))))
    assert.ok(denied(await sqlstate(() =>
      call(admin, 'api_platform_club_create', ['Società Fantasma', 'societa-fantasma', null]))))
    assert.ok(denied(await sqlstate(() =>
      call(admin, 'api_platform_subscription', [milano.clubId, 'rinnovata', inDays(900), null]))))

    // Nemmeno scavalcando le RPC: le tabelle di piattaforma non hanno GRANT.
    assert.ok(denied(await sqlstate(() => asDataApi(admin, (tx) =>
      tx.query(`insert into platform_owners (auth_user_id, email) values ($1,'io@example.test')`,
        [randomUUID()])))))
    assert.ok(denied(await sqlstate(() => asDataApi(admin, (tx) =>
      tx.query('select * from club_sessions')))))
    assert.ok(denied(await sqlstate(() => asDataApi(admin, (tx) =>
      tx.query(`insert into clubs (slug, name) values ('mia-societa','Mia')`)))))
    // L'UPDATE sull'abbonamento non solleva: la policy la filtra via, e non tocca niente.
    const prima = await asSystem((tx) => tx.one<any>(
      'select expires_on from subscriptions where club_id = $1', [milano.clubId]))
    await asDataApi(admin, (tx) => tx.query(
      `update subscriptions set expires_on = current_date + 3650 where club_id = $1`, [milano.clubId]))
    const dopo = await asSystem((tx) => tx.one<any>(
      'select expires_on from subscriptions where club_id = $1', [milano.clubId]))
    assert.equal(dopo!.expires_on, prima!.expires_on,
      "la segreteria non può allungarsi l'abbonamento da sé")
  })

  it('allenatore, atleta e tutore restano chiusi nella propria società', async () => {
    const coach = milano.coachA.authUserId!
    const persone = await call<any[]>(coach, 'api_people_list')
    assert.ok(persone.length > 0 && persone.every((p) => p.id !== brianza.minor.personId))
    assert.deepEqual(await call<any[]>(coach, 'api_dues_list'), [], 'nessun dato economico')

    const atleta = await call<any[]>(brianza.athlete.authUserId!, 'api_dues_list')
    assert.ok(atleta.every((d) => d.personId === brianza.athlete.personId))

    const tutore = await call<any[]>(milano.guardian.authUserId!, 'api_people_list')
    assert.ok(tutore.every((p) => p.id === milano.guardian.personId || p.id === milano.minor.personId))
  })
})

describe('chiavi esterne incrociate: impossibili, non solo vietate', () => {
  const crossFk = (sql: string, params: unknown[]) =>
    sqlstate(() => asSystem((tx) => tx.query(sql, params)))

  it('una rosa non può prendere un atleta di un’altra società', async () => {
    assert.equal(await crossFk(
      'insert into team_memberships (club_id, team_id, person_id) values ($1,$2,$3)',
      [milano.clubId, milano.teamA, brianza.athlete.personId]), '23503')
  })

  it('una quota non può essere intestata a una persona di un’altra società', async () => {
    assert.equal(await crossFk(
      `insert into dues (club_id, person_id, season_id, description, amount_cents)
       values ($1,$2,$3,'Quota incrociata', 1000)`,
      [milano.clubId, brianza.athlete.personId, milano.seasonId]), '23503')
  })

  it('un tutore non può essere legato a un minore di un’altra società', async () => {
    assert.equal(await crossFk(
      'insert into guardian_links (club_id, guardian_person_id, minor_person_id) values ($1,$2,$3)',
      [milano.clubId, milano.guardian.personId, brianza.minor.personId]), '23503')
  })

  it('una squadra non può stare nella stagione di un’altra società', async () => {
    assert.equal(await crossFk(
      `insert into teams (club_id, season_id, name) values ($1,$2,'Squadra incrociata')`,
      [milano.clubId, brianza.seasonId]), '23503')
  })

  it('un versamento non può appartenere a una quota di un’altra società', async () => {
    assert.equal(await crossFk(
      'insert into payment_records (club_id, due_id, amount_cents) values ($1,$2,1000)',
      [brianza.clubId, milano.dueId]), '23503')
  })
})

describe('abbonamenti: uno per società', () => {
  const phase = (auth: string) => call<any>(auth, 'api_subscription').then((s) => s?.phase)

  it('sospendere Milano non tocca Brianza', async () => {
    await call(owner, 'api_platform_subscription', [milano.clubId, 'sospesa', null, 'prova'])

    assert.equal(await phase(milano.admin.authUserId!), 'sospesa')
    assert.deepEqual(await call<any[]>(milano.admin.authUserId!, 'api_people_list'), [],
      'società sospesa: nessun dato operativo, nemmeno dalla Data API')
    const quote = await asDataApi(milano.admin.authUserId!, (tx) => tx.query('select id from dues'))
    assert.deepEqual(quote, [], 'anche la tabella diretta non restituisce nulla')

    assert.equal(await phase(brianza.admin.authUserId!), 'attiva')
    const brianzaPersone = await call<any[]>(brianza.admin.authUserId!, 'api_people_list')
    assert.ok(brianzaPersone.length > 0, 'l’altra società lavora come prima')
  })

  it('il proprietario entra lo stesso nella società sospesa', async () => {
    await enter(owner, 'pallanuoto-milano')
    const persone = await call<any[]>(owner, 'api_people_list')
    assert.ok(persone.length > 0, 'altrimenti non potrebbe rimetterla in piedi')
    await call(owner, 'api_club_leave')
  })

  it('riattivata, Milano torna come prima, con tutti i suoi dati', async () => {
    const prima = await asSystem((tx) => tx.one<any>(
      'select count(*)::int as n from people where club_id = $1', [milano.clubId]))
    await call(owner, 'api_platform_subscription', [milano.clubId, 'riattivata', null, null])

    assert.equal(await phase(milano.admin.authUserId!), 'attiva')
    const persone = await call<any[]>(milano.admin.authUserId!, 'api_people_list')
    assert.equal(persone.length + 0, prima!.n - (await archiviate(milano.clubId)),
      'nessun dato perso durante la sospensione')
  })

  it('ogni atto del proprietario lascia traccia', async () => {
    const eventi = await call<any[]>(owner, 'api_platform_clubs').then(() =>
      asSystem((tx) => tx.query<any>(
        'select action from subscription_events where club_id = $1 order by created_at', [milano.clubId])))
    const azioni = eventi.map((e) => e.action)
    assert.ok(azioni.includes('sospesa') && azioni.includes('riattivata'))
  })

  it('il proprietario crea una società nuova, già con il suo abbonamento', async () => {
    const created = await call<any>(owner, 'api_platform_club_create',
      ['Rari Nantes Prova', 'rari-nantes-prova', inDays(400)])
    const clubs = await call<any[]>(owner, 'api_platform_clubs')
    const nuova = clubs.find((c) => c.id === created.id)
    assert.equal(nuova.slug, 'rari-nantes-prova')
    assert.equal(nuova.athletes, 0)
    assert.equal(nuova.subscription.phase, 'attiva')
  })
})

/** Le persone archiviate non escono da `api_people_list`: qui servono per il conto. */
const archiviate = (clubId: string) => asSystem((tx) => tx.one<any>(
  'select count(*)::int as n from people where club_id = $1 and archived', [clubId])).then((r) => r!.n)
