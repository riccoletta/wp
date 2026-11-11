import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { asSystem } from '../db.js'
import { body, route } from '../http.js'
import { loadLicense, requireOwner, type LicenseState } from '../license.js'

/** Lato club la licenza è di sola lettura, admin compreso: serve solo a mostrare l'avviso. */
export const licenseRouter = Router()
licenseRouter.get('/', route((tx) => loadLicense(tx)))

export const ownerLicenseRouter = Router()

ownerLicenseRouter.use((req, _res, next) => {
  try { requireOwner(req); next() } catch (err) { next(err) }
})

/**
 * Le scritture girano come sistema: `app_user` non ha GRANT su `license`, quindi
 * questa è l'unica via possibile ed è chiusa dal token del proprietario.
 */
function ownerRoute(handler: (req: Request) => Promise<LicenseState>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try { res.json(await handler(req)) } catch (err) { next(err) }
  }
}

const noteSchema = z.object({ note: z.string().trim().max(500).nullish() })
const renewSchema = noteSchema.extend({
  expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data non valida'),
  graceDays: z.number().int().min(0).max(365).optional(),
})

const update = async (sql: string, params: unknown[]) => {
  await asSystem((tx) => tx.query(sql, params))
  return loadLicense()
}

ownerLicenseRouter.get('/', ownerRoute(() => loadLicense()))

// Il rinnovo sposta la scadenza; non toglie da solo una sospensione, che è un atto distinto.
ownerLicenseRouter.post('/renew', ownerRoute(async (req) => {
  const { expiresOn, graceDays, note } = body(renewSchema, req)
  return update(
    `update license set expires_on = $1, grace_days = coalesce($2, grace_days),
            note = $3, updated_at = now()`,
    [expiresOn, graceDays ?? null, note ?? null],
  )
}))

ownerLicenseRouter.post('/suspend', ownerRoute(async (req) =>
  update(`update license set status = 'sospesa', note = $1, updated_at = now()`,
    [body(noteSchema, req).note ?? null])))

ownerLicenseRouter.post('/reactivate', ownerRoute(async (req) =>
  update(`update license set status = 'attiva', note = $1, updated_at = now()`,
    [body(noteSchema, req).note ?? null])))
