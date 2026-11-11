import { Router } from 'express'
import { z } from 'zod'
import { body, denyIfEmpty, notFound, route } from '../http.js'

export const registrationsRouter = Router()
export const medicalRouter = Router()
export const duesRouter = Router()

/* ---------------- Tesseramenti ---------------- */

registrationsRouter.get('/', route(async (tx, req) => {
  const seasonId = String(req.query.seasonId ?? '')
  const status = String(req.query.status ?? '')
  return tx.query(
    `select r.id, r.status, r.submitted_on as "submittedOn", r.valid_until as "validUntil", r.notes,
            r.updated_at as "updatedAt", p.id as "personId",
            p.first_name as "firstName", p.last_name as "lastName",
            s.id as "seasonId", s.name as season
       from registrations r join people p on p.id = r.person_id join seasons s on s.id = r.season_id
      where ($1 = '' or r.season_id = $1::uuid) and ($2 = '' or r.status = $2)
      order by lower(p.last_name), lower(p.first_name)`,
    [seasonId, status],
  )
}))

const registrationSchema = z.object({
  personId: z.string().uuid(),
  seasonId: z.string().uuid(),
  status: z.enum(['da_completare', 'in_corso', 'attivo', 'scaduto']),
  submittedOn: z.string().date().nullish(),
  validUntil: z.string().date().nullish(),
  notes: z.string().max(500).nullish(),
})

/** Un tesseramento per atleta e stagione: la seconda scrittura aggiorna la prima. */
registrationsRouter.put('/', route(async (tx, req) => {
  const r = body(registrationSchema, req)
  return denyIfEmpty(await tx.query(
    `insert into registrations (person_id, season_id, status, submitted_on, valid_until, notes)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (person_id, season_id) do update
       set status = excluded.status, submitted_on = excluded.submitted_on,
           valid_until = excluded.valid_until, notes = excluded.notes, updated_at = now()
     returning id`,
    [r.personId, r.seasonId, r.status, r.submittedOn || null, r.validUntil || null, r.notes || null],
  ))
}))

/* ------- Certificati: solo scadenza e stato, mai file o dati clinici ------- */

medicalRouter.get('/', route(async (tx, req) => {
  const filter = String(req.query.filter ?? '')
  return tx.query(
    `select m.person_id as "personId", m.kind, m.expires_on as "expiresOn", m.updated_at as "updatedAt",
            p.first_name as "firstName", p.last_name as "lastName",
            (m.expires_on - current_date) as "daysLeft"
       from medical_expiries m join people p on p.id = m.person_id
      where not p.archived
        and case $1 when 'scaduti' then m.expires_on < current_date
                    when 'in_scadenza' then m.expires_on >= current_date
                                        and m.expires_on <= current_date + 30
                    else true end
      order by m.expires_on`,
    [filter],
  )
}))

medicalRouter.put('/:personId', route(async (tx, req) => {
  const m = body(
    z.object({ kind: z.enum(['agonistico', 'non_agonistico']).nullish(), expiresOn: z.string().date() }),
    req,
  )
  return denyIfEmpty(await tx.query(
    `insert into medical_expiries (person_id, kind, expires_on) values ($1,$2,$3)
     on conflict (person_id) do update
       set kind = excluded.kind, expires_on = excluded.expires_on, updated_at = now()
     returning person_id`,
    [req.params.personId, m.kind || null, m.expiresOn],
  ))
}))

medicalRouter.delete('/:personId', route(async (tx, req) =>
  denyIfEmpty(await tx.query('delete from medical_expiries where person_id = $1 returning person_id',
    [req.params.personId]))))

/* ---------------- Quote e pagamenti manuali ---------------- */

duesRouter.get('/', route(async (tx, req) => {
  const seasonId = String(req.query.seasonId ?? '')
  const status = String(req.query.status ?? '')
  return tx.query(
    `select d.id, d.description, d.amount_cents as "amountCents", d.paid_cents as "paidCents",
            d.remaining_cents as "remainingCents", d.status, d.due_date as "dueDate",
            d.person_id as "personId", p.first_name as "firstName", p.last_name as "lastName",
            s.id as "seasonId", s.name as season
       from dues_status d join people p on p.id = d.person_id join seasons s on s.id = d.season_id
      where ($1 = '' or d.season_id = $1::uuid) and ($2 = '' or d.status = $2)
      order by lower(p.last_name), d.due_date nulls last`,
    [seasonId, status],
  )
}))

duesRouter.post('/', route(async (tx, req) => {
  const d = body(
    z.object({
      personId: z.string().uuid(),
      seasonId: z.string().uuid(),
      description: z.string().trim().min(1),
      amountCents: z.number().int().positive(),
      dueDate: z.string().date().nullish(),
    }),
    req,
  )
  return denyIfEmpty(await tx.query(
    `insert into dues (person_id, season_id, description, amount_cents, due_date)
     values ($1,$2,$3,$4,$5) returning id`,
    [d.personId, d.seasonId, d.description, d.amountCents, d.dueDate || null],
  ))
}))

duesRouter.get('/:id', route(async (tx, req) => {
  const due = notFound(await tx.one(
    `select d.id, d.description, d.amount_cents as "amountCents", d.paid_cents as "paidCents",
            d.remaining_cents as "remainingCents", d.status, d.due_date as "dueDate",
            d.person_id as "personId", p.first_name as "firstName", p.last_name as "lastName", s.name as season
       from dues_status d join people p on p.id = d.person_id join seasons s on s.id = d.season_id
      where d.id = $1`, [req.params.id]))
  const payments = await tx.query(
    `select id, amount_cents as "amountCents", paid_on as "paidOn", method, note
       from payment_records where due_id = $1 order by paid_on, created_at`, [req.params.id])
  return { ...due, payments }
}))

duesRouter.delete('/:id', route(async (tx, req) =>
  denyIfEmpty(await tx.query('delete from dues where id = $1 returning id', [req.params.id]))))

/** Versamento registrato a mano dalla segreteria. Nessun pagamento online, nessun dato di carta. */
duesRouter.post('/:id/payments', route(async (tx, req) => {
  const p = body(
    z.object({
      amountCents: z.number().int().positive(),
      paidOn: z.string().date(),
      method: z.enum(['contanti', 'bonifico', 'assegno', 'altro']),
      note: z.string().max(200).nullish(),
    }),
    req,
  )
  return denyIfEmpty(await tx.query(
    `insert into payment_records (due_id, amount_cents, paid_on, method, note)
     values ($1,$2,$3,$4,$5) returning id`,
    [req.params.id, p.amountCents, p.paidOn, p.method, p.note || null],
  ))
}))

duesRouter.delete('/:id/payments/:paymentId', route(async (tx, req) =>
  denyIfEmpty(await tx.query('delete from payment_records where id = $1 and due_id = $2 returning id',
    [req.params.paymentId, req.params.id]))))
