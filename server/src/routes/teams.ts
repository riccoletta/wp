import { Router } from 'express'
import { z } from 'zod'
import { body, denyIfEmpty, notFound, route } from '../http.js'

export const seasonsRouter = Router()
export const teamsRouter = Router()

const SELECT_SEASON = `select id, name, start_date as "startDate", end_date as "endDate",
  is_active as "isActive" from seasons`

seasonsRouter.get('/', route((tx) => tx.query(`${SELECT_SEASON} order by start_date desc`)))

seasonsRouter.post('/', route(async (tx, req) => {
  const s = body(
    z.object({ name: z.string().trim().min(1), startDate: z.string().date(), endDate: z.string().date() }),
    req,
  )
  return denyIfEmpty(
    await tx.query('insert into seasons (name, start_date, end_date) values ($1,$2,$3) returning id',
      [s.name, s.startDate, s.endDate]),
  )
}))

/** Una sola stagione attiva: le altre vengono disattivate nella stessa transazione. */
seasonsRouter.post('/:id/activate', route(async (tx, req) => {
  await tx.query('update seasons set is_active = false where is_active')
  return denyIfEmpty(await tx.query('update seasons set is_active = true where id = $1 returning id', [req.params.id]))
}))

const SELECT_TEAM = `select t.id, t.name, t.category, t.season_id as "seasonId", s.name as season,
  s.is_active as "seasonActive" from teams t join seasons s on s.id = t.season_id`

teamsRouter.get('/', route(async (tx, req) => {
  const seasonId = String(req.query.seasonId ?? '')
  return tx.query(
    `${SELECT_TEAM} where ($1 = '' or t.season_id = $1::uuid)
       order by s.start_date desc, lower(t.name)`, [seasonId])
}))

teamsRouter.post('/', route(async (tx, req) => {
  const t = body(
    z.object({ name: z.string().trim().min(1), category: z.string().trim().nullish(), seasonId: z.string().uuid() }),
    req,
  )
  return denyIfEmpty(
    await tx.query('insert into teams (name, category, season_id) values ($1,$2,$3) returning id',
      [t.name, t.category || null, t.seasonId]),
  )
}))

teamsRouter.get('/:id', route(async (tx, req) => {
  const id = req.params.id!
  const team = notFound(await tx.one(`${SELECT_TEAM} where t.id = $1`, [id]))
  const [roster, coaches] = await Promise.all([
    tx.query(
      `select p.id, p.first_name as "firstName", p.last_name as "lastName", p.birth_date as "birthDate",
              m.added_at as "addedAt", med.expires_on as "medicalExpiresOn"
         from team_memberships m
         join people p on p.id = m.person_id
         left join medical_expiries med on med.person_id = p.id
        where m.team_id = $1 order by lower(p.last_name), lower(p.first_name)`, [id]),
    tx.query(
      `select p.id, p.first_name as "firstName", p.last_name as "lastName"
         from coach_assignments c join people p on p.id = c.person_id
        where c.team_id = $1 order by lower(p.last_name)`, [id]),
  ])
  return { ...team, roster, coaches }
}))

teamsRouter.delete('/:id', route(async (tx, req) =>
  denyIfEmpty(await tx.query('delete from teams where id = $1 returning id', [req.params.id]))))

const personIdSchema = z.object({ personId: z.string().uuid() })

teamsRouter.post('/:id/members', route(async (tx, req) => {
  const { personId } = body(personIdSchema, req)
  return denyIfEmpty(
    await tx.query(
      `insert into team_memberships (team_id, person_id) values ($1,$2)
       on conflict (team_id, person_id) do update set team_id = excluded.team_id returning id`,
      [req.params.id, personId]),
  )
}))

teamsRouter.delete('/:id/members/:personId', route(async (tx, req) =>
  denyIfEmpty(await tx.query(
    'delete from team_memberships where team_id = $1 and person_id = $2 returning id',
    [req.params.id, req.params.personId]))))

teamsRouter.post('/:id/coaches', route(async (tx, req) => {
  const { personId } = body(personIdSchema, req)
  return denyIfEmpty(
    await tx.query(
      `insert into coach_assignments (team_id, person_id) values ($1,$2)
       on conflict do nothing returning team_id`, [req.params.id, personId]),
  )
}))

teamsRouter.delete('/:id/coaches/:personId', route(async (tx, req) =>
  denyIfEmpty(await tx.query(
    'delete from coach_assignments where team_id = $1 and person_id = $2 returning team_id',
    [req.params.id, req.params.personId]))))
