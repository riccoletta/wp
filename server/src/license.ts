import { createHash, timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { asSystem, type Tx } from './db.js'
import { HttpError } from './http.js'

/** Giorni di preavviso prima della scadenza, come per i certificati medici. */
const WARN_DAYS = 30
const OWNER_HEADER = 'x-license-token'

export type LicensePhase = 'attiva' | 'in_scadenza' | 'tolleranza' | 'scaduta' | 'sospesa'

export interface LicenseState {
  status: 'attiva' | 'sospesa'
  expiresOn: string
  graceDays: number
  graceUntil: string
  daysLeft: number
  graceDaysLeft: number
  phase: LicensePhase
  readOnly: boolean
  message: string | null
  note: string | null
  updatedAt: string
}

// I giorni li conta il database con current_date: niente aritmetica di date in JS,
// che sposterebbe il giorno a seconda del fuso.
const STATE_SQL = `select status, expires_on, grace_days, note, updated_at,
         (expires_on + grace_days) as grace_until,
         (expires_on - current_date) as days_left,
         (expires_on + grace_days - current_date) as grace_days_left
    from license`

const it = (iso: string) => iso.split('-').reverse().join('/')
const when = (n: number) => (n === 0 ? 'oggi' : n === 1 ? 'domani' : `tra ${n} giorni`)

function describe(r: Record<string, any>): LicenseState {
  const expiresOn = String(r.expires_on)
  const graceUntil = String(r.grace_until)
  const daysLeft = Number(r.days_left)
  const graceDaysLeft = Number(r.grace_days_left)
  const phase: LicensePhase =
    r.status === 'sospesa' ? 'sospesa'
    : graceDaysLeft < 0 ? 'scaduta'
    : daysLeft < 0 ? 'tolleranza'
    : daysLeft <= WARN_DAYS ? 'in_scadenza'
    : 'attiva'
  const messages: Record<LicensePhase, string | null> = {
    attiva: null,
    in_scadenza: `Licenza in scadenza ${when(daysLeft)}, il ${it(expiresOn)}. `
      + 'Contatta il fornitore per il rinnovo.',
    tolleranza: `Licenza scaduta il ${it(expiresOn)}. Periodo di tolleranza fino al ${it(graceUntil)} `
      + `(${when(graceDaysLeft)}): dopo quella data l'applicazione passa in sola lettura.`,
    scaduta: `Licenza scaduta il ${it(expiresOn)} e tolleranza conclusa il ${it(graceUntil)}. `
      + "L'applicazione è in sola lettura: i dati restano consultabili, ma non modificabili. "
      + 'Contatta il fornitore per il rinnovo.',
    sospesa: "Licenza sospesa. L'applicazione è in sola lettura: i dati restano consultabili, "
      + 'ma non modificabili. Contatta il fornitore per la riattivazione.',
  }
  return {
    status: r.status,
    expiresOn,
    graceDays: Number(r.grace_days),
    graceUntil,
    daysLeft,
    graceDaysLeft,
    phase,
    readOnly: phase === 'sospesa' || phase === 'scaduta',
    message: messages[phase],
    note: r.note ?? null,
    updatedAt: new Date(r.updated_at).toISOString(),
  }
}

/** Con `tx` legge dentro la transazione dell'utente (quindi passando dalla RLS). */
export async function loadLicense(tx?: Tx): Promise<LicenseState> {
  const row = tx ? await tx.one<any>(STATE_SQL) : await asSystem((t) => t.one<any>(STATE_SQL))
  if (!row) throw new HttpError(503, 'Licenza non configurata')
  return describe(row)
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Applicazione della licenza lato server. Scaduta oltre la tolleranza o sospesa:
 * restano le letture (consultazione ed estrazione dei dati), cadono le scritture.
 * Nessun dato viene cancellato o nascosto.
 */
export async function licenseGate(req: Request, _res: Response, next: NextFunction) {
  try {
    if (SAFE_METHODS.has(req.method)) return next()
    const state = await loadLicense()
    if (!state.readOnly) return next()
    next(new HttpError(403, state.message!))
  } catch (err) {
    next(err)
  }
}

/**
 * Il proprietario del software non è un utente del club: si autentica con un token di
 * servizio, non con una sessione. Nessun ruolo applicativo, admin compreso, lo possiede.
 */
export function requireOwner(req: Request) {
  const expected = process.env.LICENSE_OWNER_TOKEN ?? ''
  if (!expected) throw new HttpError(503, 'Gestione licenza non configurata')
  const given = String(req.headers[OWNER_HEADER] ?? '')
  const a = createHash('sha256').update(given).digest()
  const b = createHash('sha256').update(expected).digest()
  if (!timingSafeEqual(a, b)) throw new HttpError(401, 'Token di licenza non valido')
}
