import { Router } from 'express'
import { route } from '../http.js'

export const dashboardRouter = Router()

/**
 * Contatori operativi, non un modulo di report: scadenze da verificare e quote da sollecitare.
 * I numeri passano dalla RLS, quindi ogni ruolo conta soltanto ciò che può vedere.
 */
dashboardRouter.get('/', route(async (tx, _req, user) => {
  const [counts, season, teams] = await Promise.all([
    tx.one<any>(`select
      (select count(*) from medical_expiries m join people p on p.id = m.person_id
        where not p.archived and m.expires_on < current_date) as medical_expired,
      (select count(*) from medical_expiries m join people p on p.id = m.person_id
        where not p.archived and m.expires_on >= current_date
          and m.expires_on <= current_date + 30) as medical_soon,
      (select count(*) from people where not archived) as people_active,
      (select count(*) from dues_status where status <> 'saldata') as dues_open,
      (select coalesce(sum(remaining_cents), 0) from dues_status where status <> 'saldata') as dues_remaining,
      (select count(*) from registrations r join seasons s on s.id = r.season_id
        where s.is_active and r.status in ('da_completare','in_corso')) as registrations_pending`),
    tx.one(`select id, name, start_date as "startDate", end_date as "endDate" from seasons where is_active`),
    tx.query(
      `select t.id, t.name, t.category, s.name as season,
              (select count(*) from team_memberships m where m.team_id = t.id) as "rosterSize"
         from teams t join seasons s on s.id = t.season_id
        where s.is_active order by lower(t.name)`),
  ])
  return {
    roles: user.roles,
    season: season ?? null,
    teams,
    counts: {
      medicalExpired: Number(counts!.medical_expired),
      medicalSoon: Number(counts!.medical_soon),
      peopleActive: Number(counts!.people_active),
      duesOpen: Number(counts!.dues_open),
      duesRemainingCents: Number(counts!.dues_remaining),
      registrationsPending: Number(counts!.registrations_pending),
    },
  }
}))
