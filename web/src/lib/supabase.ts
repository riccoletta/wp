import { createClient } from '@supabase/supabase-js'

/**
 * Unico client Supabase dell'applicazione.
 *
 * Nel frontend entrano soltanto l'URL del progetto e la chiave pubblicabile: nessuna
 * credenziale PostgreSQL, nessun certificato, nessuna chiave di servizio. La chiave
 * pubblicabile non concede permessi di per sé — dà accesso a PostgREST come ruolo
 * `anon`, che nel nostro schema non ha privilegi su nulla. Tutto ciò che si vede
 * dopo il login lo decide la RLS a partire da `auth.uid()`.
 */
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!url || !key) {
  throw new Error(
    'Configurazione mancante: VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY '
    + 'devono essere impostate nell\'ambiente di build.',
  )
}

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
