import type { NextFunction, Request, Response } from 'express'
import { asSystem } from './db.js'
import { HttpError } from './http.js'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * CSRF: il cookie di sessione è `SameSite=Lax`, quindi un sito terzo non può già
 * farne partire una POST. Questo è il secondo giro di chiave: ogni richiesta che
 * modifica dati e dichiara un'origine deve dichiarare la *nostra*. Le richieste
 * senza `Origin` (curl, test, canale del proprietario) non vengono da un browser,
 * quindi non c'è un cookie altrui da sfruttare.
 */
export function sameOrigin(req: Request, _res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next()
  const origin = req.headers.origin
  if (!origin) return next()
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '')
  const proto = String(req.headers['x-forwarded-proto'] ?? 'https').split(',')[0]!.trim()
  const allowed = new Set([`${proto}://${host}`, `https://${host}`, `http://${host}`])
  const dev = process.env.WEB_ORIGIN?.trim()
  if (dev) allowed.add(dev)
  if (!allowed.has(origin)) return next(new HttpError(403, 'Richiesta da origine non consentita'))
  next()
}

// Finestra e soglie del freno sui tentativi di accesso.
const WINDOW_MS = 15 * 60_000
const MAX_PER_EMAIL = 10
const MAX_PER_IP = 30

export function clientIp(req: Request): string {
  const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0]?.trim()
  return fwd || req.socket.remoteAddress || 'sconosciuto'
}

const keysOf = (email: string, ip: string) => [
  { key: `e:${email.trim().toLowerCase()}`, max: MAX_PER_EMAIL },
  { key: `i:${ip}`, max: MAX_PER_IP },
]

/** Blocco temporaneo dopo troppi tentativi falliti, per email e per indirizzo. */
export async function assertLoginAllowed(email: string, ip: string) {
  const keys = keysOf(email, ip).map((k) => k.key)
  const blocked = await asSystem((t) =>
    t.one('select 1 from login_attempts where key = any($1) and blocked_until > now()', [keys]),
  )
  if (blocked) throw new HttpError(429, 'Troppi tentativi di accesso. Riprova tra qualche minuto.')
}

export async function recordLoginFailure(email: string, ip: string) {
  await asSystem(async (t) => {
    for (const { key, max } of keysOf(email, ip)) {
      const row = await t.one<any>('select attempts, first_at from login_attempts where key = $1 for update', [key])
      const fresh = !row || new Date(row.first_at).getTime() < Date.now() - WINDOW_MS
      const attempts = fresh ? 1 : Number(row.attempts) + 1
      const blockedUntil = attempts >= max ? new Date(Date.now() + WINDOW_MS).toISOString() : null
      await t.query(
        `insert into login_attempts (key, attempts, first_at, blocked_until) values ($1,$2,now(),$3)
           on conflict (key) do update set
             attempts = $2,
             first_at = case when $4 then now() else login_attempts.first_at end,
             blocked_until = coalesce($3, login_attempts.blocked_until)`,
        [key, attempts, blockedUntil, fresh],
      )
    }
    // Pulizia: i contatori esauriti non restano a invecchiare.
    await t.query(`delete from login_attempts
                    where first_at < now() - interval '1 day'
                      and (blocked_until is null or blocked_until < now())`)
  })
}

export async function clearLoginFailures(email: string, ip: string) {
  await asSystem((t) =>
    t.query('delete from login_attempts where key = any($1)', [keysOf(email, ip).map((k) => k.key)]),
  )
}
