import { defineConfig, devices } from '@playwright/test'

/**
 * Giro di verifica dell'interfaccia in un browser vero: le pagine React vengono
 * cliccate, non solo compilate.
 *
 * Non c'è più un'API da avviare: il frontend parla direttamente con Supabase.
 * Le prove hanno quindi bisogno di un **ambiente Supabase dedicato** — mai quello
 * di produzione, perché scrivono davvero — dichiarato nell'ambiente:
 *
 *   VITE_SUPABASE_URL              progetto di prova (o `supabase start` in locale)
 *   VITE_SUPABASE_PUBLISHABLE_KEY  chiave pubblicabile dello stesso progetto
 *   E2E_PASSWORD                   password degli account sintetici del seed
 *   LICENSE_OWNER_TOKEN            token del proprietario, per la prova sulla licenza
 *   E2E_LICENSE_FUNCTION_URL       URL della Edge Function `license-owner`
 *
 * Preparazione: `npm run migrate` e `npm run seed` su quel progetto, e gli account
 * sintetici creati in Supabase Auth con la stessa email (vedi README).
 */
const WEB_PORT = 5174

const required = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY']
const missing = required.filter((k) => !process.env[k])
if (missing.length) {
  throw new Error(
    `Prove end-to-end non eseguibili: mancano ${missing.join(', ')}.\n`
    + 'Servono le credenziali di un progetto Supabase DI PROVA, mai quello di produzione.',
  )
}

export default defineConfig({
  testDir: './e2e',
  // Un solo worker: le prove scrivono sullo stesso database e si leggono a vicenda.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    locale: 'it-IT',
    timezoneId: 'Europe/Rome',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `npm run dev --workspace=web -- --port ${WEB_PORT} --strictPort --host 127.0.0.1`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
