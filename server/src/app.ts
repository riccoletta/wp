import express from 'express'
import { authRouter } from './routes/auth.js'
import { peopleRouter } from './routes/people.js'
import { seasonsRouter, teamsRouter } from './routes/teams.js'
import { registrationsRouter, medicalRouter, duesRouter } from './routes/admin.js'
import { dashboardRouter } from './routes/dashboard.js'
import { licenseRouter, ownerLicenseRouter } from './routes/license.js'
import { cookieParser, errorHandler, requireAuth } from './http.js'
import { licenseGate } from './license.js'
import { sameOrigin } from './security.js'

export function createApp() {
  const app = express()
  app.use(express.json())
  app.use(cookieParser)
  // CSRF: nessuna scrittura da un'origine che non sia la nostra.
  app.use(sameOrigin)

  app.get('/api/health', (_req, res) => res.json({ ok: true }))
  app.use('/api/auth', authRouter)

  // Canale del proprietario del software: token di servizio, non sessione del club.
  app.use('/api/owner/license', ownerLicenseRouter)

  // Da qui in poi serve una sessione: senza cookie valido si esce con 401.
  app.use('/api', requireAuth)
  // Licenza non attiva: sola lettura. Login e logout restano sempre possibili.
  app.use('/api', licenseGate)
  app.use('/api/license', licenseRouter)
  app.use('/api/people', peopleRouter)
  app.use('/api/seasons', seasonsRouter)
  app.use('/api/teams', teamsRouter)
  app.use('/api/registrations', registrationsRouter)
  app.use('/api/medical', medicalRouter)
  app.use('/api/dues', duesRouter)
  app.use('/api/dashboard', dashboardRouter)

  app.use(errorHandler)
  return app
}
