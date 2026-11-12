import { Router } from 'express'
import { z } from 'zod'
import { asSystem } from '../db.js'
import {
  COOKIE, createSession, currentUser, destroySession, hashPassword, newToken, sha256, verifyPassword,
} from '../auth.js'
import { HttpError, body } from '../http.js'
import { assertLoginAllowed, clearLoginFailures, clientIp, recordLoginFailure } from '../security.js'

export const authRouter = Router()

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) })

authRouter.post('/login', async (req, res, next) => {
  try {
    const { email, password } = body(loginSchema, req)
    const ip = clientIp(req)
    await assertLoginAllowed(email, ip)
    const user = await asSystem((tx) =>
      tx.one<any>('select id, password_hash, active from app_users where lower(email) = lower($1)', [email]),
    )
    // Stessa risposta per utente inesistente, disattivato o password errata.
    const ok = user?.active && (await verifyPassword(password, user.password_hash))
    if (!ok) {
      await recordLoginFailure(email, ip)
      throw new HttpError(401, 'Email o password non corretti')
    }
    await clearLoginFailures(email, ip)
    await createSession(res, user.id)
    res.json({ ok: true })
  } catch (err) { next(err) }
})

authRouter.post('/logout', async (req, res, next) => {
  try {
    await destroySession(req, res)
    res.json({ ok: true })
  } catch (err) { next(err) }
})

authRouter.get('/me', async (req, res, next) => {
  try {
    const user = await currentUser(req)
    if (!user) return res.status(401).json({ error: 'Autenticazione richiesta' })
    res.json(user)
  } catch (err) { next(err) }
})

/** Dati minimi dell'invito, per mostrare a chi si registra di chi è l'account. */
authRouter.get('/invite/:token', async (req, res, next) => {
  try {
    const invite = await asSystem((tx) =>
      tx.one<any>(
        `select i.email, p.first_name, p.last_name
           from invites i join people p on p.id = i.person_id
          where i.token_hash = $1 and i.accepted_at is null and i.expires_at > now()`,
        [sha256(req.params.token!)],
      ),
    )
    if (!invite) throw new HttpError(404, 'Invito non valido o scaduto')
    res.json({ email: invite.email, firstName: invite.first_name, lastName: invite.last_name })
  } catch (err) { next(err) }
})

const acceptSchema = z.object({ token: z.string().min(1), password: z.string().min(8) })

authRouter.post('/accept-invite', async (req, res, next) => {
  try {
    const { token, password } = body(acceptSchema, req)
    const hash = await hashPassword(password)
    const userId = await asSystem(async (tx) => {
      const invite = await tx.one<any>(
        `select id, person_id, email, roles from invites
          where token_hash = $1 and accepted_at is null and expires_at > now() for update`,
        [sha256(token)],
      )
      if (!invite) throw new HttpError(404, 'Invito non valido o scaduto')
      const user = await tx.one<any>(
        `insert into app_users (person_id, email, password_hash) values ($1,$2,$3) returning id`,
        [invite.person_id, invite.email, hash],
      )
      for (const role of invite.roles as string[]) {
        await tx.query('insert into user_roles (user_id, role) values ($1,$2) on conflict do nothing', [user!.id, role])
      }
      await tx.query('update invites set accepted_at = now() where id = $1', [invite.id])
      return user!.id as string
    })
    await createSession(res, userId)
    res.json({ ok: true })
  } catch (err) { next(err) }
})

export { COOKIE, newToken }
