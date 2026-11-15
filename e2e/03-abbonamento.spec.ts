import { expect, test } from '@playwright/test'
import { ACCOUNTS, CLUB, login, PASSWORD } from './helpers'

/**
 * Abbonamento della società visto dall'interfaccia (M10).
 *
 * Sostituisce la prova della licenza unica: da D27 una società con l'abbonamento
 * fermo non è più "in sola lettura", è chiusa — e a chiuderla è il database, non
 * il frontend. Qui si guida il portale del proprietario, cliccandolo.
 *
 * Serve l'identità del proprietario della piattaforma nell'ambiente di prova,
 * promossa con `npm run platform:owner`. Senza, la prova si salta invece di
 * fingere un verde.
 */
const OWNER = process.env.E2E_OWNER_EMAIL
test.skip(!OWNER, 'E2E_OWNER_EMAIL non impostata: nessun proprietario nell\'ambiente di prova.')
test.describe.configure({ mode: 'serial' })

async function entraNelPortale(page: import('@playwright/test').Page) {
  await page.goto('/accedi')
  await page.getByLabel('Email').fill(OWNER!)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Accedi' }).click()
  await expect(page).toHaveURL(/\/admin$/)
}

const riga = (page: import('@playwright/test').Page) =>
  page.getByRole('row').filter({ hasText: CLUB })

test('il proprietario vede le società ed entra nella sua', async ({ page }) => {
  await entraNelPortale(page)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Società')
  await expect(riga(page)).toContainText('Attivo')

  await riga(page).getByRole('button', { name: 'Entra nella società' }).click()
  await expect(page).toHaveURL(new RegExp(`/club/${CLUB}$`))
  await expect(page.getByRole('button', { name: 'Torna alle società' })).toBeVisible()

  await page.getByRole('button', { name: 'Torna alle società' }).click()
  await expect(page).toHaveURL(/\/admin$/)
})

test('società sospesa: la segreteria vede il perché, non una pagina vuota', async ({ page }) => {
  await entraNelPortale(page)
  await riga(page).getByRole('button', { name: 'Sospendi' }).click()
  await expect(riga(page)).toContainText('Sospeso')

  try {
    // Il proprietario entra lo stesso: deve poterla rimettere in piedi.
    await riga(page).getByRole('button', { name: 'Entra nella società' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Ciao')

    // La segreteria della società, invece, trova la porta chiusa.
    await page.getByRole('button', { name: 'Esci' }).click()
    await page.getByLabel('Email').fill(ACCOUNTS.admin)
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Accedi' }).click()
    await expect(page.getByText('Abbonamento sospeso')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Persone' })).toHaveCount(0)
  } finally {
    await page.getByRole('button', { name: 'Esci' }).click()
    await entraNelPortale(page)
    await riga(page).getByRole('button', { name: 'Riattiva' }).click()
    await expect(riga(page)).toContainText('Attivo')
  }
})

test('riattivata: la segreteria ritrova i suoi dati', async ({ page }) => {
  await login(page, ACCOUNTS.admin)
  await page.getByRole('link', { name: 'Persone' }).click()
  await expect(page.getByRole('link', { name: 'Neri Sofia' })).toBeVisible()
})
