import { expect, test } from '@playwright/test'
import { ACCOUNTS, login, navLabels } from './helpers'

/**
 * Accessi negati visti dall'interfaccia. Quello che manca qui manca perché la
 * policy RLS non lo restituisce, non perché il frontend lo nasconde.
 */

test('l\'allenatore vede solo la propria squadra e nessuna quota', async ({ page }) => {
  await login(page, ACCOUNTS.coachA)

  await expect(navLabels(page)).toHaveText(['Dashboard', 'Persone', 'Squadre', 'Scadenze', 'Profilo'])

  await page.getByRole('link', { name: 'Persone' }).click()
  await expect(page.getByRole('link', { name: 'Neri Sofia' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Nuova persona' })).toHaveCount(0)
  // Atleti della Prima Squadra: fuori dalla sua portata.
  await expect(page.getByRole('link', { name: 'Verdi Luca' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Gialli Chiara' })).toHaveCount(0)

  // L'URL digitato a mano non apre nulla di più: la lista arriva vuota dal database.
  await page.goto('/quote')
  await expect(page.getByText('Nessuna quota.')).toBeVisible()

  await page.goto('/squadre')
  await expect(page.getByRole('link', { name: 'Under 16' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Prima Squadra' })).toHaveCount(0)
})

test('l\'atleta vede solo la propria posizione', async ({ page }) => {
  await login(page, ACCOUNTS.athlete)

  await expect(navLabels(page)).toHaveText(['Dashboard', 'Scadenze', 'Quote', 'Profilo'])

  await page.getByRole('link', { name: 'Quote' }).first().click()
  await expect(page.getByRole('link', { name: 'Verdi Luca' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Neri Sofia' })).toHaveCount(0)
  await expect(page.getByText('La tua posizione.', { exact: false })).toBeVisible()

  await page.goto('/scadenze')
  await expect(page.getByText('Verdi Luca')).toBeVisible()
  await expect(page.getByText('Neri Sofia')).toHaveCount(0)
})

test('il tutore vede il minore collegato e non gli altri', async ({ page }) => {
  await login(page, ACCOUNTS.guardian)

  await page.getByRole('link', { name: 'Persone' }).click()
  await expect(page.getByRole('link', { name: 'Neri Sofia' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Gialli Chiara' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Caveman Nadia' })).toHaveCount(0)

  await page.getByRole('link', { name: 'Quote' }).first().click()
  const riga = page.getByRole('row').filter({ hasText: 'Neri Sofia' })
  await expect(riga).toContainText('450,00')
  await expect(riga).toContainText('Parziale')
  await expect(page.getByRole('row').filter({ hasText: 'Verdi Luca' })).toHaveCount(0)
})
