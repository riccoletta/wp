import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto'
import { promisify } from 'node:util'
import type { Request, Response } from 'express'
import { asSystem } from './db.js'

const scryptAsync = promisify(scrypt)
const SESSION_DAYS = 14
export const COOKIE = 'pn_session'

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = (await scryptAsync(password, salt, 64)) as Buffer
  return `scrypt:${salt.toString('hex')}:${key.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, saltHex, keyHex] = stored.split(':')
  if (!saltHex || !keyHex) return false
  const key = (await scryptAsync(password, Buffer.from(saltHex, 'hex'), 64)) as Buffer
  const expected = Buffer.from(keyHex, 'hex')
  return key.length === expected.length && timingSafeEqual(key, expected)
}

export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex')
export const newToken = () => randomBytes(32).toString('base64url')

export interface CurrentUser {
  userId: string
  personId: string
  email: string
  roles: string[]
  firstName: string
  lastName: string
}

/** In produzione il cookie viaggia solo su HTTPS, anche se nessuno lo ha dichiarato. */
const secureCookie = () =>
  process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true'
    : process.env.NODE_ENV === 'production' || !!process.env.VERCEL

export async function createSession(res: Response, userId: string) {
  const token = newToken()
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5)
  await asSystem((tx) =>
    tx.query('insert into sessions (token_hash, user_id, expires_at) values ($1,$2,$3)', [
      sha256(token), userId, expires.toISOString(),
    ]),
  )
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookie(),
    expires,
    path: '/',
  })
}

export async function destroySession(req: Request, res: Response) {
  const token = req.cookies?.[COOKIE]
  if (token) await asSystem((tx) => tx.query('delete from sessions where token_hash = $1', [sha256(token)]))
  res.clearCookie(COOKIE, { path: '/' })
}

/** Risolve la sessione leggendo il cookie. Gira come sistema: è il solo punto che lo fa. */
export async function currentUser(req: Request): Promise<CurrentUser | null> {
  const token = req.cookies?.[COOKIE]
  if (!token) return null
  return asSystem(async (tx) => {
    const row = await tx.one<any>(
      `select u.id as user_id, u.person_id, u.email, p.first_name, p.last_name,
              coalesce(array_agg(r.role) filter (where r.role is not null), '{}') as roles
         from sessions s
         join app_users u on u.id = s.user_id and u.active
         join people p on p.id = u.person_id
         left join user_roles r on r.user_id = u.id
        where s.token_hash = $1 and s.expires_at > now()
        group by u.id, u.person_id, u.email, p.first_name, p.last_name`,
      [sha256(token)],
    )
    if (!row) return null
    return {
      userId: row.user_id,
      personId: row.person_id,
      email: row.email,
      roles: row.roles as string[],
      firstName: row.first_name,
      lastName: row.last_name,
    }
  })
}
