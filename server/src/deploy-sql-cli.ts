import { DEPLOY_FILE, writeDeploySql } from './deploy-sql.js'

// Rigenera lo script da incollare nel SQL Editor di Supabase. Non tocca nessun
// database: legge le migrazioni del repository e scrive un file.
const sql = await writeDeploySql()
console.log(`Scritto ${DEPLOY_FILE} — ${sql.split('\n').length} righe.`)
console.log('Da incollare nel pannello Supabase → SQL Editor → New query → Run.')
