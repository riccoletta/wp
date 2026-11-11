import { expect, request, test } from '@playwright/test'
import { ACCOUNTS, login } from './helpers'

/**
 * La licenza vista dall'interfaccia: sospensione → fascia di sola lettura e
 * scrittura respinta in italiano; riattivazione → tutto torna, dati intatti.
 * Il canale del proprietario è fuori dalla sessione del club, quindi qui lo si
 * chiama con il token di servizio, non cliccando.
 */
const OWNER = 'http://127.0.0.1:3100/api/owner/license'
const TOKEN = process.env.LICENSE_OWNER_TOKEN || 'token-di-prova-e2e'

async function owner(action: 'suspend' | 'reactivate') {
  const api = await request.newContext({ extraHTTPHeaders: { 'x-license-token': TOKEN } })
  const res = await api.post(`${OWNER}/${action}`, { data: {} })
  expect(res.ok(), await res.text()).toBeTruthy()
  await api.dispose()
}

test('licenza sospesa: l\'app resta leggibile ma la segreteria non scrive', async ({ page }) => {
  await owner('suspend')
  try {
    await login(page, ACCOUNTS.admin)
    await expect(page.getByRole('status').filter({ hasText: 'Sola lettura' })).toContainText('Licenza sospesa')

    // Lettura intatta.
    await page.getByRole('link', { name: 'Persone' }).click()
    await expect(page.getByRole('link', { name: 'Neri Sofia' })).toBeVisible()

    // Scrittura respinta dal server, con messaggio leggibile nel form.
    await page.getByRole('button', { name: 'Nuova persona' }).click()
    const form = page.getByRole('dialog', { name: 'Nuova persona' })
    await form.getByLabel('Nome', { exact: true }).fill('Mai')
    await form.getByLabel('Cognome').fill('Salvata')
    await form.getByRole('button', { name: 'Salva' }).click()
    await expect(form.getByRole('alert')).toContainText('sola lettura')

    await page.reload()
    await expect(page.getByRole('link', { name: 'Salvata Mai' })).toHaveCount(0)
  } finally {
    await owner('reactivate')
  }
})

test('riattivata: la fascia sparisce e la scrittura torna', async ({ page }) => {
  await login(page, ACCOUNTS.admin)
  await expect(page.getByRole('status').filter({ hasText: 'Sola lettura' })).toHaveCount(0)

  await page.getByRole('link', { name: 'Persone' }).click()
  await page.getByRole('button', { name: 'Nuova persona' }).click()
  const form = page.getByRole('dialog', { name: 'Nuova persona' })
  await form.getByLabel('Nome', { exact: true }).fill('Dopo')
  await form.getByLabel('Cognome').fill('Riattivazione')
  await form.getByRole('button', { name: 'Salva' }).click()
  await expect(form).toBeHidden()
  await expect(page.getByRole('link', { name: 'Riattivazione Dopo' })).toBeVisible()
})
