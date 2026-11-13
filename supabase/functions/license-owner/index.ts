/**
 * Canale del PROPRIETARIO del software: rinnovo, sospensione, riattivazione.
 *
 * D12 resta in piedi: il proprietario non è un utente del club. Non ha una sessione
 * Supabase, ha un token di servizio che vive solo nei segreti della Edge Function.
 * L'amministratore del club non può rinnovare né sospendere nemmeno chiamando la
 * REST API a mano: `license` non ha GRANT di scrittura per `authenticated`.
 *
 * D14 resta in piedi: `renew` sposta la scadenza, `reactivate` toglie la sospensione.
 * Rinnovare una licenza sospesa aggiorna le date ma non la riattiva da solo.
 *
 * D13 resta in piedi: la sola lettura non cancella e non nasconde niente.
 *
 * Questa funzione va distribuita con `verify_jwt = false` (vedi supabase/config.toml):
 * non c'è nessun JWT da verificare, l'unica chiave è il token del proprietario.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { fail, json, preflight, sameSecret } from '../_shared/http.ts'

const url = Deno.env.get('SUPABASE_URL')!
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ownerToken = Deno.env.get('LICENSE_OWNER_TOKEN') ?? ''

const db = createClient(url, serviceKey, { auth: { persistSession: false } })

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre

  // Token non configurato = canale chiuso, mai aperto.
  if (!ownerToken) return fail(503, 'Gestione licenza non configurata')

  const given = req.headers.get('x-license-token') ?? ''
  if (!given || !(await sameSecret(given, ownerToken))) {
    return fail(401, 'Token di licenza non valido')
  }

  const now = new Date().toISOString()
  const body = req.method === 'POST' ? await req.json().catch(() => null) : null
  const action = String(body?.action ?? 'state')
  const note: string | null = typeof body?.note === 'string' ? body.note.slice(0, 500) : null

  switch (action) {
    case 'state':
      return json(await state())

    case 'renew': {
      const expiresOn = String(body?.expiresOn ?? '')
      if (!ISO_DATE.test(expiresOn)) return fail(400, 'Data di scadenza non valida (AAAA-MM-GG)')
      const graceDays = body?.graceDays
      if (graceDays !== undefined
          && (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > 365)) {
        return fail(400, 'Giorni di tolleranza non validi (0–365)')
      }
      const patch: Record<string, unknown> = { expires_on: expiresOn, note, updated_at: now }
      if (graceDays !== undefined) patch.grace_days = graceDays
      return await update(patch)
    }

    case 'suspend':
      return await update({ status: 'sospesa', note, updated_at: now })

    case 'reactivate':
      return await update({ status: 'attiva', note, updated_at: now })

    default:
      return fail(400, 'Azione non riconosciuta')
  }
})

async function update(patch: Record<string, unknown>) {
  const { error } = await db.from('license').update(patch).eq('id', true)
  if (error) return fail(500, 'Aggiornamento non riuscito: ' + error.message)
  return json(await state())
}

/** Lo stato operativo è derivato nel database: qui non si calcolano date. */
async function state() {
  const { data } = await db.rpc('api_license')
  return data
}
