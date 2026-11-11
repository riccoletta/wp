import { Router } from 'express'
import { z } from 'zod'
import { newToken, sha256 } from '../auth.js'
import { body, denyIfEmpty, notFound, route } from '../http.js'

export const peopleRouter = Router()

const personSchema = z.object({
  firstName: z.string().trim().min(1, 'Nome obbligatorio'),
  lastName: z.string().trim().min(1, 'Cognome obbligatorio'),
  birthDate: z.string().date().nullish(),
  email: z.string().email().nullish().or(z.literal('')),
  phone: z.string().trim().max(32).nullish(),
  kind: z.enum(['atleta', 'socio', 'staff']),
})
const empty = (v: unknown) => (v === '' || v === undefined ? null : v)

const SELECT_PERSON = `select id, first_name as "firstName", last_name as "lastName",
  birth_date as "birthDate", email, phone, kind, archived, created_at as "createdAt" from people`

peopleRouter.get('/', route(async (tx, req) => {
  const q = String(req.query.q ?? '').trim()
  const kind = String(req.query.kind ?? '')
  const archived = req.query.archived === 'true'
  return tx.query(
    `${SELECT_PERSON} where archived = $1
       and ($2 = '' or lower(first_name || ' ' || last_name) like '%' || lower($2) || '%')
       and ($3 = '' or kind = $3)
     order by lower(last_name), lower(first_name)`,
    [archived, q, kind],
  )
}))

peopleRouter.post('/', route(async (tx, req) => {
  const p = body(personSchema, req)
  const rows = await tx.query(
    `insert into people (first_name, last_name, birth_date, email, phone, kind)
     values ($1,$2,$3,$4,$5,$6) returning id`,
    [p.firstName, p.lastName, empty(p.birthDate), empty(p.email), empty(p.phone), p.kind],
  )
  return denyIfEmpty(rows)
}))

peopleRouter.get('/:id', route(async (tx, req) => {
  const id = req.params.id!
  const person = notFound(await tx.one(`${SELECT_PERSON} where id = $1`, [id]))
  const [teams, guardians, wards, account, registrations, medical, dues] = await Promise.all([
    tx.query(
      `select t.id, t.name, t.category, s.name as season, s.is_active as "seasonActive"
         from team_memberships m join teams t on t.id = m.team_id join seasons s on s.id = t.season_id
        where m.person_id = $1 order by s.start_date desc, t.name`, [id]),
    tx.query(
      `select p.id, p.first_name as "firstName", p.last_name as "lastName"
         from guardian_links g join people p on p.id = g.guardian_person_id
        where g.minor_person_id = $1`, [id]),
    tx.query(
      `select p.id, p.first_name as "firstName", p.last_name as "lastName"
         from guardian_links g join people p on p.id = g.minor_person_id
        where g.guardian_person_id = $1`, [id]),
    tx.one(`select email, active from app_users where person_id = $1`, [id]),
    tx.query(
      `select r.id, r.status, r.submitted_on as "submittedOn", r.valid_until as "validUntil", r.notes,
              s.id as "seasonId", s.name as season
         from registrations r join seasons s on s.id = r.season_id
        where r.person_id = $1 order by s.start_date desc`, [id]),
    tx.one(`select kind, expires_on as "expiresOn", updated_at as "updatedAt"
              from medical_expiries where person_id = $1`, [id]),
    tx.query(
      `select d.id, d.description, d.amount_cents as "amountCents", d.paid_cents as "paidCents",
              d.remaining_cents as "remainingCents", d.status, d.due_date as "dueDate", s.name as season
         from dues_status d join seasons s on s.id = d.season_id
        where d.person_id = $1 order by d.created_at desc`, [id]),
  ])
  return { ...person, teams, guardians, wards, registrations, dues,
           account: account ?? null, medical: medical ?? null }
}))

peopleRouter.patch('/:id', route(async (tx, req) => {
  const p = body(personSchema.partial().extend({ archived: z.boolean().optional() }), req)
  const rows = await tx.query(
    `update people set
       first_name = coalesce($2, first_name), last_name = coalesce($3, last_name),
       birth_date = coalesce($4, birth_date), email = coalesce($5, email),
       phone = coalesce($6, phone), kind = coalesce($7, kind),
       archived = coalesce($8, archived)
     where id = $1 returning id`,
    [req.params.id, p.firstName ?? null, p.lastName ?? null, empty(p.birthDate), empty(p.email),
     empty(p.phone), p.kind ?? null, p.archived ?? null],
  )
  return denyIfEmpty(rows)
}))

/**
 * Crea un invito. L'anagrafica esiste già: l'account è un atto separato e facoltativo.
 * Non inviamo email: la segreteria consegna il link. Nel db resta solo l'hash del token.
 */
peopleRouter.post('/:id/invite', route(async (tx, req) => {
  const { email, roles } = body(
    z.object({ email: z.string().email(), roles: z.array(z.enum(['admin', 'coach', 'athlete', 'guardian'])).min(1) }),
    req,
  )
  const token = newToken()
  const rows = await tx.query(
    `insert into invites (person_id, email, roles, token_hash, expires_at)
     values ($1,$2,$3,$4, now() + interval '14 days') returning id`,
    [req.params.id, email, roles, sha256(token)],
  )
  denyIfEmpty(rows)
  return { token }
}))

peopleRouter.post('/:id/guardians', route(async (tx, req) => {
  const { guardianPersonId } = body(z.object({ guardianPersonId: z.string().uuid() }), req)
  const rows = await tx.query(
    `insert into guardian_links (guardian_person_id, minor_person_id) values ($1,$2)
     on conflict do nothing returning minor_person_id`,
    [guardianPersonId, req.params.id],
  )
  return denyIfEmpty(rows)
}))

peopleRouter.delete('/:id/guardians/:guardianId', route(async (tx, req) => {
  const rows = await tx.query(
    `delete from guardian_links where minor_person_id = $1 and guardian_person_id = $2 returning minor_person_id`,
    [req.params.id, req.params.guardianId],
  )
  return denyIfEmpty(rows)
}))
