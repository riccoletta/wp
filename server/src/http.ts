import type { NextFunction, Request, Response } from 'express'
import { ZodError, type ZodSchema } from 'zod'
import { currentUser, type CurrentUser } from './auth.js'
import { asUser, type Tx } from './db.js'

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: CurrentUser
      cookies: Record<string, string>
    }
  }
}

/** Richiede una sessione valida. Senza di essa: 401, nessun dato. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const user = await currentUser(req)
  if (!user) return next(new HttpError(401, 'Autenticazione richiesta'))
  req.user = user
  next()
}

/**
 * Esegue l'handler dentro una transazione legata all'utente: la RLS filtra i dati.
 * Il codice qui non riapplica i filtri di ruolo, altrimenti i permessi starebbero in due posti.
 */
export function route<T>(handler: (tx: Tx, req: Request, user: CurrentUser) => Promise<T>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const out = await asUser(req.user!.userId, (tx) => handler(tx, req, req.user!))
      res.json(out ?? { ok: true })
    } catch (err) { next(err) }
  }
}

export function body<S extends ZodSchema>(schema: S, req: Request): ReturnType<S['parse']> {
  return schema.parse(req.body)
}

/** Una INSERT/UPDATE respinta dalla RLS non restituisce righe: è un 403, non un errore generico. */
export function denyIfEmpty<T>(rows: T[]): T {
  if (!rows[0]) throw new HttpError(403, 'Operazione non consentita')
  return rows[0]
}

export function notFound<T extends object>(row: T | undefined | null): T {
  if (!row) throw new HttpError(404, 'Risorsa non trovata')
  return row
}

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Dati non validi', details: err.flatten().fieldErrors })
  }
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message })
  if (err?.code === '23505') return res.status(409).json({ error: 'Valore già presente' })
  if (err?.code === '42501') return res.status(403).json({ error: 'Operazione non consentita' })
  console.error(err)
  res.status(500).json({ error: 'Errore interno' })
}

export function cookieParser(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.cookie
  req.cookies = {}
  if (header) {
    for (const part of header.split(';')) {
      const i = part.indexOf('=')
      if (i > 0) req.cookies[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
    }
  }
  next()
}
