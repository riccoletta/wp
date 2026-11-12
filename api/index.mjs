// Ingresso serverless su Vercel: una sola funzione serve tutto `/api/*`.
// L'applicazione Express resta quella di sempre; qui cambia solo come viene avviata.
// Le migrazioni NON girano qui: restano `npm run migrate`, un atto separato (D17).
import { createApp } from '../server/dist/app.js'
import { initDb } from '../server/dist/db.js'

let ready
let app

async function boot() {
  await initDb({ migrate: false })
  app = createApp()
}

/**
 * Il runtime di Vercel può aver già letto il corpo della richiesta: in quel caso
 * `express.json()` resterebbe in attesa di uno stream consumato. Glielo consegniamo
 * già pronto, come fa body-parser quando qualcun altro ha fatto il lavoro.
 */
function normalizeBody(req) {
  const raw = req.body
  if (raw === undefined) return
  req._body = true
  if (Buffer.isBuffer(raw) || typeof raw === 'string') {
    try { req.body = JSON.parse(raw.toString() || '{}') } catch { req.body = {} }
  }
}

export default async function handler(req, res) {
  ready ??= boot()
  await ready
  normalizeBody(req)
  return app(req, res)
}
