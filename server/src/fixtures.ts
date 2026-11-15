import { asSystem, type Tx } from './db.js'

/**
 * Dati sintetici per sviluppo e prove. Da M10 tutto nasce dentro una **società**:
 * `seedDemo({ slug, name })` popola quella società e non tocca le altre, così le
 * prove possono mettere due clienti fianco a fianco e verificare che non si vedano.
 */

/** La società, con il suo abbonamento. Rieseguibile: se c'è già, la riusa. */
export async function ensureClub(
  tx: Tx, club: { slug: string; name: string; expiresOn?: string; status?: string },
): Promise<string> {
  const found = await tx.one<any>('select id from clubs where slug = $1', [club.slug])
  const id = found?.id ?? (await tx.one<any>(
    'insert into clubs (slug, name) values ($1,$2) returning id', [club.slug, club.name]))!.id
  await tx.query(
    `insert into subscriptions (club_id, status, expires_on)
     values ($1, coalesce($2, 'attiva'), coalesce($3::date, current_date + 365))
     on conflict (club_id) do nothing`,
    [id, club.status ?? null, club.expiresOn ?? null])
  return id as string
}

/**
 * Crea una persona della società e, se servono ruoli, il relativo account.
 * Idempotente: l'account è identificato da società + email, la persona senza
 * account da società + nome + data di nascita. Al secondo giro non duplica nulla.
 *
 * L'account porta un `auth_user_id` sintetico: le credenziali vere stanno in
 * Supabase Auth, qui serve solo un'identità con cui provare le policy.
 */
export async function makePerson(
  tx: Tx,
  clubId: string,
  p: { firstName: string; lastName: string; kind?: string; birthDate?: string | null },
  account?: { email: string; roles: string[] },
) {
  let personId: string | undefined
  let userId: string | null = null
  let authUserId: string | null = null

  if (account) {
    const existing = await tx.one<any>(
      `select id, person_id, auth_user_id from app_users
        where club_id = $1 and lower(email) = lower($2)`, [clubId, account.email])
    if (existing) { userId = existing.id; personId = existing.person_id; authUserId = existing.auth_user_id }
  }
  if (!personId) {
    const found = await tx.one<any>(
      `select id from people
        where club_id = $1 and first_name = $2 and last_name = $3
          and birth_date is not distinct from $4::date`,
      [clubId, p.firstName, p.lastName, p.birthDate ?? null])
    personId = found?.id ?? (await tx.one<any>(
      `insert into people (club_id, first_name, last_name, kind, birth_date)
       values ($1,$2,$3,$4,$5) returning id`,
      [clubId, p.firstName, p.lastName, p.kind ?? 'atleta', p.birthDate ?? null]))!.id
  }
  if (account && !userId) {
    const row = await tx.one<any>(
      `insert into app_users (club_id, person_id, email, auth_user_id)
       values ($1, $2, $3, gen_random_uuid()) returning id, auth_user_id`,
      [clubId, personId, account.email])
    userId = row!.id
    authUserId = row!.auth_user_id
  }
  if (account) {
    for (const role of account.roles) {
      await tx.query(
        'insert into user_roles (user_id, role) values ($1,$2) on conflict do nothing', [userId, role])
    }
  }
  return { personId: personId as string, userId, authUserId }
}

/** La stagione sportiva corrente: da settembre a luglio. Così i dati di esempio non invecchiano. */
export function currentSeason() {
  const now = new Date()
  const start = now.getMonth() + 1 >= 9 ? now.getFullYear() : now.getFullYear() - 1
  return { name: `${start}/${start + 1}`, startDate: `${start}-09-01`, endDate: `${start + 1}-07-31` }
}

/**
 * La stagione su cui appoggiare i dati di esempio, **dentro una società**.
 * Se quella società ha già una stagione attiva la riusa: `seasons_single_active_idx`
 * ammette una sola riga attiva per società, e la stagione reale va preservata.
 */
async function activeSeason(tx: Tx, clubId: string) {
  const s = currentSeason()
  const active = await tx.one<any>(
    'select id, name, start_date from seasons where club_id = $1 and is_active', [clubId])
  if (active) return active
  const existing = await tx.one<any>(
    'select id, name, start_date from seasons where club_id = $1 and name = $2', [clubId, s.name])
  if (existing) {
    await tx.query('update seasons set is_active = true where id = $1', [existing.id])
    return existing
  }
  return (await tx.one<any>(
    `insert into seasons (club_id, name, start_date, end_date, is_active)
     values ($1,$2,$3,$4, true) returning id, name, start_date`,
    [clubId, s.name, s.startDate, s.endDate]))!
}

/**
 * Società di esempio: una stagione, due squadre, segreteria, due allenatori, atleti e un tutore.
 * Rieseguibile: ogni scrittura è un "cerca o crea", i dati già presenti non vengono sovrascritti.
 * Gira in un'unica transazione, quindi un errore a metà non lascia dati parziali.
 */
export async function seedDemo(club: { slug?: string; name?: string } = {}) {
  const slug = club.slug ?? 'pallanuoto-milano'
  const name = club.name ?? 'Pallanuoto Milano'

  return asSystem(async (tx) => {
    const clubId = await ensureClub(tx, { slug, name })
    const season = await activeSeason(tx, clubId)
    const seasonId = season.id as string
    const seasonName = season.name as string
    const seasonStart = season.start_date as string

    const team = async (teamName: string, category: string) => (await tx.one<any>(
      `insert into teams (club_id, season_id, name, category) values ($1,$2,$3,$4)
       on conflict (season_id, name) do update set category = excluded.category returning id`,
      [clubId, seasonId, teamName, category]))!.id as string
    const teamA = await team('Under 16', 'U16')
    const teamB = await team('Prima Squadra', 'Serie C')

    const person = (p: Parameters<typeof makePerson>[2], account?: Parameters<typeof makePerson>[3]) =>
      makePerson(tx, clubId, p, account)

    const admin = await person({ firstName: 'Giulia', lastName: 'Segreteria', kind: 'staff' },
      { email: 'segreteria@example.test', roles: ['admin'] })
    const coachA = await person({ firstName: 'Marco', lastName: 'Rossi', kind: 'staff' },
      { email: 'coach.a@example.test', roles: ['coach'] })
    const coachB = await person({ firstName: 'Elena', lastName: 'Bianchi', kind: 'staff' },
      { email: 'coach.b@example.test', roles: ['coach'] })
    const athlete = await person({ firstName: 'Luca', lastName: 'Verdi', birthDate: '2000-04-12' },
      { email: 'atleta@example.test', roles: ['athlete'] })
    const minor = await person({ firstName: 'Sofia', lastName: 'Neri', birthDate: '2012-02-20' })
    const guardian = await person({ firstName: 'Paolo', lastName: 'Neri', kind: 'socio' },
      { email: 'tutore@example.test', roles: ['guardian'] })
    const other = await person({ firstName: 'Chiara', lastName: 'Gialli', birthDate: '2011-10-05' })

    const coachOf = (teamId: string, personId: string) => tx.query(
      `insert into coach_assignments (club_id, team_id, person_id) values ($1,$2,$3)
       on conflict do nothing`, [clubId, teamId, personId])
    const memberOf = (teamId: string, personId: string) => tx.query(
      `insert into team_memberships (club_id, team_id, person_id) values ($1,$2,$3)
       on conflict do nothing`, [clubId, teamId, personId])
    await coachOf(teamA, coachA.personId)
    await coachOf(teamB, coachB.personId)
    await memberOf(teamA, minor.personId)
    await memberOf(teamB, athlete.personId)
    await memberOf(teamB, other.personId)
    await tx.query(
      `insert into guardian_links (club_id, guardian_person_id, minor_person_id) values ($1,$2,$3)
       on conflict do nothing`, [clubId, guardian.personId, minor.personId])

    // Stato amministrativo: se la segreteria l'ha già aggiornato, il seed non lo tocca.
    await tx.query(
      `insert into registrations (club_id, person_id, season_id, status, submitted_on)
       values ($1,$2,$3,'attivo', $4::date + 9) on conflict (person_id, season_id) do nothing`,
      [clubId, athlete.personId, seasonId, seasonStart])
    await tx.query(
      `insert into registrations (club_id, person_id, season_id, status) values ($1,$2,$3,'da_completare')
       on conflict (person_id, season_id) do nothing`, [clubId, minor.personId, seasonId])
    await tx.query(
      `insert into medical_expiries (club_id, person_id, kind, expires_on)
       values ($1,$2,'agonistico', current_date + 10) on conflict (person_id) do nothing`,
      [clubId, minor.personId])
    await tx.query(
      `insert into medical_expiries (club_id, person_id, kind, expires_on)
       values ($1,$2,'agonistico', current_date - 5) on conflict (person_id) do nothing`,
      [clubId, athlete.personId])

    // `dues` non ha chiave naturale: la coppia persona+descrizione nella stagione fa da identità.
    const due = async (personId: string, description: string, cents: number) => {
      const found = await tx.one<any>(
        'select id from dues where person_id = $1 and season_id = $2 and description = $3',
        [personId, seasonId, description])
      return (found ?? (await tx.one<any>(
        `insert into dues (club_id, person_id, season_id, description, amount_cents, due_date)
         values ($1,$2,$3,$4,$5, $6::date + 60) returning id`,
        [clubId, personId, seasonId, description, cents, seasonStart]))!).id as string
    }
    const dueId = await due(minor.personId, `Quota annuale ${seasonName}`, 45000)
    if (!(await tx.one('select 1 from payment_records where due_id = $1', [dueId]))) {
      await tx.query(
        `insert into payment_records (club_id, due_id, amount_cents, paid_on, method)
         values ($1, $2, 20000, $3::date + 31, 'bonifico')`, [clubId, dueId, seasonStart])
    }
    await due(athlete.personId, `Quota annuale ${seasonName}`, 52000)

    return {
      clubId, slug, clubName: name,
      seasonName,
      seasonId,
      teamA, teamB,
      admin, coachA, coachB, athlete, minor, guardian, other,
      dueId,
    }
  })
}

/** Promuove una identità Supabase a proprietario della piattaforma. Solo per le prove. */
export async function makePlatformOwner(authUserId: string, email = 'owner@example.test') {
  return asSystem((tx) => tx.query(
    `insert into platform_owners (auth_user_id, email, note) values ($1,$2,'fixture')
     on conflict (auth_user_id) do nothing`, [authUserId, email]))
}
