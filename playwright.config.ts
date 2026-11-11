import { defineConfig, devices } from '@playwright/test'

/**
 * Giro di verifica dell'interfaccia in un browser vero: le pagine React vengono
 * cliccate, non solo compilate. Gira su un database PGlite dedicato (`db/e2e-data`)
 * ricreato e popolato da `npm run e2e`, quindi non tocca mai i dati di sviluppo.
 */
const API_PORT = 3100
const WEB_PORT = 5174

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
      command: 'npm run start --workspace=server',
      env: { PORT: String(API_PORT), PGLITE_DIR: './db/e2e-data', WEB_ORIGIN: `http://127.0.0.1:${WEB_PORT}`,
        LICENSE_OWNER_TOKEN: process.env.LICENSE_OWNER_TOKEN || 'token-di-prova-e2e' },
      // `/api/auth/me` risponde 401 da anonimo: basta a sapere che l'API è in ascolto.
      url: `http://127.0.0.1:${API_PORT}/api/auth/me`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npm run dev --workspace=web -- --port ${WEB_PORT} --strictPort --host 127.0.0.1`,
      env: { API_URL: `http://127.0.0.1:${API_PORT}` },
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
