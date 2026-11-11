import { hashPassword } from './auth.js'
import { asSystem, type Tx } from './db.js'

/**
 * Crea una persona e, se servono ruoli, il relativo account. Dati sintetici.
 * Idempotente: l'account è identificato dall'email, la persona senza account
 * da nome + data di nascita. Al secondo giro non duplica nulla.
 */
export async function makePerson(
  tx: Tx,
  p: { firstName: string; lastName: string; kind?: string; birthDate?: string | null },
  account?: { email: string; password: string; roles: string[] },
) {
  let personId: string | undefined
  let userId: string | null = null

  if (account) {
    const existing = await tx.one<any>(
      'select id, person_id from app_users where lower(email) = lower($1)', [account.email])
    if (existing) { userId = existing.id; personId = existing.person_id }
  }
  if (!personId) {
    const found = await tx.one<any>(
      `select id from people
        where first_name = $1 and last_name = $2 and birth_date is not distinct from $3::date`,
      [p.firstName, p.lastName, p.birthDate ?? null])
    personId = found?.id ?? (await tx.one<any>(
      `insert into people (first_name, last_name, kind, birth_date) values ($1,$2,$3,$4) returning id`,
      [p.firstName, p.lastName, p.kind ?? 'atleta', p.birthDate ?? null]))!.id
  }
  if (account && !userId) {
    userId = (await tx.one<any>(
      `insert into app_users (person_id, email, password_hash) values ($1,$2,$3) returning id`,
      [personId, account.email, await hashPassword(account.password)]))!.id
  }
  if (account) {
    for (const role of account.roles) {
      await tx.query(
        'insert into user_roles (user_id, role) values ($1,$2) on conflict do nothing', [userId, role])
    }
  }
  return { personId: personId as string, userId }
}

/** La stagione sportiva corrente: da settembre a luglio. Così i dati di esempio non invecchiano. */
export function currentSeason() {
  const now = new Date()
  const start = now.getMonth() + 1 >= 9 ? now.getFullYear() : now.getFullYear() - 1
  return { name: `${start}/${start + 1}`, startDate: `${start}-09-01`, endDate: `${start + 1}-07-31` }
}

/**
 * La stagione su cui appoggiare i dati di esempio.
 * Se una stagione attiva esiste già la riusa: `seasons_single_active_idx` ammette
 * una sola riga con `is_active`, e la stagione reale della società va preservata.
 */
async function activeSeason(tx: Tx) {
  const s = currentSeason()
  const active = await tx.one<any>('select id, name, start_date from seasons where is_active')
  if (active) return active
  const existing = await tx.one<any>('select id, name, start_date from seasons where name = $1', [s.name])
  if (existing) {
    await tx.query('update seasons set is_active = true where id = $1', [existing.id])
    return existing
  }
  return (await tx.one<any>(
    `insert into seasons (name, start_date, end_date, is_active)
     values ($1,$2,$3, true) returning id, name, start_date`,
    [s.name, s.startDate, s.endDate]))!
}

/**
 * Società di esempio: una stagione, due squadre, segreteria, due allenatori, atleti e un tutore.
 * Rieseguibile: ogni scrittura è un "cerca o crea", i dati già presenti non vengono sovrascritti.
 * Gira in un'unica transazione, quindi un errore a metà non lascia dati parziali.
 */
export async function seedDemo() {
  return asSystem(async (tx) => {
    const season = await activeSeason(tx)
    const seasonId = season.id as string
    const seasonName = season.name as string
    const seasonStart = season.start_date as string

    const team = async (name: string, category: string) => (await tx.one<any>(
      `insert into teams (season_id, name, category) values ($1,$2,$3)
       on conflict (season_id, name) do update set category = excluded.category returning id`,
      [seasonId, name, category]))!.id as string
    const teamA = await team('Under 16', 'U16')
    const teamB = await team('Prima Squadra', 'Serie C')

    const admin = await makePerson(tx, { firstName: 'Giulia', lastName: 'Segreteria', kind: 'staff' },
      { email: 'segreteria@example.test', password: 'password123', roles: ['admin'] })
    const coachA = await makePerson(tx, { firstName: 'Marco', lastName: 'Rossi', kind: 'staff' },
      { email: 'coach.a@example.test', password: 'password123', roles: ['coach'] })
    const coachB = await makePerson(tx, { firstName: 'Elena', lastName: 'Bianchi', kind: 'staff' },
      { email: 'coach.b@example.test', password: 'password123', roles: ['coach'] })
    const athlete = await makePerson(tx, { firstName: 'Luca', lastName: 'Verdi', birthDate: '2000-04-12' },
      { email: 'atleta@example.test', password: 'password123', roles: ['athlete'] })
    const minor = await makePerson(tx, { firstName: 'Sofia', lastName: 'Neri', birthDate: '2012-02-20' })
    const guardian = await makePerson(tx, { firstName: 'Paolo', lastName: 'Neri', kind: 'socio' },
      { email: 'tutore@example.test', password: 'password123', roles: ['guardian'] })
    const other = await makePerson(tx, { firstName: 'Chiara', lastName: 'Gialli', birthDate: '2011-10-05' })

    const coachOf = (teamId: string, personId: string) => tx.query(
      'insert into coach_assignments (team_id, person_id) values ($1,$2) on conflict do nothing',
      [teamId, personId])
    const memberOf = (teamId: string, personId: string) => tx.query(
      'insert into team_memberships (team_id, person_id) values ($1,$2) on conflict do nothing',
      [teamId, personId])
    await coachOf(teamA, coachA.personId)
    await coachOf(teamB, coachB.personId)
    await memberOf(teamA, minor.personId)
    await memberOf(teamB, athlete.personId)
    await memberOf(teamB, other.personId)
    await tx.query(
      `insert into guardian_links (guardian_person_id, minor_person_id) values ($1,$2)
       on conflict do nothing`, [guardian.personId, minor.personId])

    // Stato amministrativo: se la segreteria l'ha già aggiornato, il seed non lo tocca.
    await tx.query(
      `insert into registrations (person_id, season_id, status, submitted_on)
       values ($1,$2,'attivo', $3::date + 9) on conflict (person_id, season_id) do nothing`,
      [athlete.personId, seasonId, seasonStart])
    await tx.query(
      `insert into registrations (person_id, season_id, status) values ($1,$2,'da_completare')
       on conflict (person_id, season_id) do nothing`, [minor.personId, seasonId])
    await tx.query(
      `insert into medical_expiries (person_id, kind, expires_on)
       values ($1,'agonistico', current_date + 10) on conflict (person_id) do nothing`, [minor.personId])
    await tx.query(
      `insert into medical_expiries (person_id, kind, expires_on)
       values ($1,'agonistico', current_date - 5) on conflict (person_id) do nothing`, [athlete.personId])

    // `dues` non ha chiave naturale: la coppia persona+descrizione nella stagione fa da identità.
    const due = async (personId: string, description: string, cents: number) => {
      const found = await tx.one<any>(
        'select id from dues where person_id = $1 and season_id = $2 and description = $3',
        [personId, seasonId, description])
      return (found ?? (await tx.one<any>(
        `insert into dues (person_id, season_id, description, amount_cents, due_date)
         values ($1,$2,$3,$4, $5::date + 60) returning id`,
        [personId, seasonId, description, cents, seasonStart]))!).id as string
    }
    const dueId = await due(minor.personId, `Quota annuale ${seasonName}`, 45000)
    if (!(await tx.one('select 1 from payment_records where due_id = $1', [dueId]))) {
      await tx.query(
        `insert into payment_records (due_id, amount_cents, paid_on, method)
         values ($1, 20000, $2::date + 31, 'bonifico')`, [dueId, seasonStart])
    }
    await due(athlete.personId, `Quota annuale ${seasonName}`, 52000)

    return {
      seasonName,
      seasonId,
      teamA, teamB,
      admin, coachA, coachB, athlete, minor, guardian, other,
      dueId,
    }
  })
}
