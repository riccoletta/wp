import { expect, type Page } from '@playwright/test'

export const ACCOUNTS = {
  admin: 'segreteria@example.test',
  coachA: 'coach.a@example.test',
  athlete: 'atleta@example.test',
  guardian: 'tutore@example.test',
} as const

export const PASSWORD = 'password123'

/** Entra davvero dal form di login e attende la dashboard. */
export async function login(page: Page, email: string) {
  await page.goto('/accedi')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Accedi' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Ciao')
}

/** Voci di menù effettivamente mostrate dalla navigazione principale. */
export function navLabels(page: Page) {
  return page.getByRole('navigation', { name: 'Navigazione principale' }).getByRole('link')
}
