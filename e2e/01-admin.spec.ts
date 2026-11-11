import { expect, test } from '@playwright/test'
import { ACCOUNTS, login } from './helpers'

/**
 * Ciclo completo della segreteria cliccato in un browser vero:
 * persona → roster → quota → versamento, con verifica di persistenza dopo reload.
 */

// Le prove di questo file condividono il database: l'ordine è voluto.
test.describe.configure({ mode: 'serial' })

const ATLETA = { nome: 'Nadia', cognome: 'Caveman', nascita: '2009-03-14' }
const NOME_COMPLETO = `${ATLETA.cognome} ${ATLETA.nome}`

test('accesso anonimo respinto e login errato segnalato', async ({ page }) => {
  await page.goto('/quote')
  await expect(page).toHaveURL(/\/accedi$/)

  await page.getByLabel('Email').fill(ACCOUNTS.admin)
  await page.getByLabel('Password').fill('password-sbagliata')
  await page.getByRole('button', { name: 'Accedi' }).click()
  await expect(page.getByRole('alert')).toContainText('Email o password non corretti')
  await expect(page).toHaveURL(/\/accedi$/)
})

test('dashboard admin mostra i contatori operativi', async ({ page }) => {
  await login(page, ACCOUNTS.admin)
  await expect(page.getByText('Certificati scaduti')).toBeVisible()
  await expect(page.getByText('Quote non saldate')).toBeVisible()
  await expect(page.getByText('Tesseramenti da completare')).toBeVisible()
  await expect(page.getByText('Stagione', { exact: false }).first()).toBeVisible()
})

test('la segreteria crea una persona e la ritrova dopo il reload', async ({ page }) => {
  await login(page, ACCOUNTS.admin)
  await page.getByRole('link', { name: 'Persone' }).click()

  await page.getByRole('button', { name: 'Nuova persona' }).click()
  const form = page.getByRole('dialog', { name: 'Nuova persona' })
  await form.getByLabel('Nome', { exact: true }).fill(ATLETA.nome)
  await form.getByLabel('Cognome').fill(ATLETA.cognome)
  await form.getByLabel('Data di nascita').fill(ATLETA.nascita)
  await form.getByRole('button', { name: 'Salva' }).click()

  await expect(form).toBeHidden()
  await expect(page.getByRole('link', { name: NOME_COMPLETO })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('link', { name: NOME_COMPLETO })).toBeVisible()

  // Ricerca: il filtro restringe davvero la lista.
  await page.getByLabel('Cerca').fill(ATLETA.cognome)
  await expect(page.getByRole('link', { name: NOME_COMPLETO })).toBeVisible()
  await page.getByLabel('Cerca').fill('nessunocosì')
  await expect(page.getByText('Nessuna persona trovata.')).toBeVisible()
})

test('la segreteria mette l\'atleta in rosa e la rosa resta dopo il reload', async ({ page }) => {
  await login(page, ACCOUNTS.admin)
  await page.getByRole('link', { name: 'Squadre' }).click()
  await page.getByRole('link', { name: 'Under 16' }).first().click()

  await expect(page.getByRole('heading', { name: 'Under 16' })).toBeVisible()
  await page.getByRole('button', { name: 'Aggiungi atleta' }).click()
  const picker = page.getByRole('dialog', { name: 'Aggiungi atleta alla rosa' })
  await picker.getByLabel('Persona').selectOption({ label: NOME_COMPLETO })
  await picker.getByRole('button', { name: 'Conferma' }).click()

  await expect(picker).toBeHidden()
  await expect(page.getByRole('link', { name: NOME_COMPLETO })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('link', { name: NOME_COMPLETO })).toBeVisible()
  // Senza certificato registrato la rosa lo dice, invece di tacere.
  await expect(page.getByText('Non registrato').first()).toBeVisible()
})

test('quota creata, versamento parziale registrato, stato derivato aggiornato', async ({ page }) => {
  await login(page, ACCOUNTS.admin)
  await page.getByRole('link', { name: 'Persone' }).click()
  await page.getByRole('link', { name: NOME_COMPLETO }).click()

  await page.getByRole('button', { name: 'Nuova quota' }).click()
  const quota = page.getByRole('dialog', { name: 'Nuova quota' })
  await quota.getByLabel('Descrizione').fill('Quota prova browser')
  await quota.getByLabel('Importo').fill('100,00')
  await quota.getByRole('button', { name: 'Crea quota' }).click()
  await expect(quota).toBeHidden()
  await expect(page.getByRole('link', { name: 'Quota prova browser' })).toBeVisible()

  await page.getByRole('link', { name: 'Quote' }).first().click()
  const riga = page.getByRole('row').filter({ hasText: 'Quota prova browser' })
  await expect(riga).toContainText('100,00')
  await riga.getByRole('link', { name: 'Dettaglio' }).click()

  const dettaglio = page.getByRole('dialog', { name: 'Dettaglio quota' })
  await expect(dettaglio.getByText('Nessun versamento registrato.')).toBeVisible()
  await dettaglio.getByRole('button', { name: 'Registra versamento' }).click()
  await dettaglio.getByLabel('Importo').fill('40,00')
  await dettaglio.getByRole('button', { name: 'Registra' }).click()

  // Lo stato non è un campo scritto a mano: deriva dai versamenti.
  await expect(dettaglio.getByText('Parziale')).toBeVisible()
  await expect(dettaglio.getByText('60,00')).toBeVisible()

  await page.reload()
  const rigaDopo = page.getByRole('row').filter({ hasText: 'Quota prova browser' })
  await expect(rigaDopo).toContainText('40,00')
  await expect(rigaDopo).toContainText('60,00')
  await expect(rigaDopo).toContainText('Parziale')
})

test('uscire riporta al login e chiude la sessione', async ({ page }) => {
  await login(page, ACCOUNTS.admin)
  await page.getByRole('button', { name: 'Esci' }).click()
  await expect(page).toHaveURL(/\/accedi$/)
  await page.goto('/persone')
  await expect(page).toHaveURL(/\/accedi$/)
})

test('a 360 px il menù si apre dal pulsante e non si scrolla in orizzontale', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await login(page, ACCOUNTS.admin)

  const menu = page.getByRole('navigation', { name: 'Navigazione principale' })
  await expect(menu).toBeHidden()
  await page.getByRole('button', { name: 'Menù' }).click()
  await expect(menu).toBeVisible()
  await menu.getByRole('link', { name: 'Persone' }).click()
  await expect(page).toHaveURL(/\/persone$/)

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})
