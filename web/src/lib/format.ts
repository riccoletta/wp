/** Le date arrivano dal server come giorni di calendario 'YYYY-MM-DD', senza fuso. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' })
}

export const euro = (cents: number) =>
  (cents / 100).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })

/** Converte '45,50' o '45.50' in centesimi. Restituisce null se non è un importo valido. */
export function parseEuro(input: string): number | null {
  const normalized = input.replace(/\s|€/g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null
  return Math.round(parseFloat(normalized) * 100)
}

export function age(birthDate: string | null): number | null {
  if (!birthDate) return null
  const [y, m, d] = birthDate.slice(0, 10).split('-').map(Number)
  const today = new Date()
  let a = today.getFullYear() - y!
  if (today.getMonth() + 1 < m! || (today.getMonth() + 1 === m! && today.getDate() < d!)) a--
  return a
}

export const isMinor = (birthDate: string | null) => {
  const a = age(birthDate)
  return a !== null && a < 18
}

export const todayISO = () => {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Rome' }))
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export const REGISTRATION_LABELS: Record<string, string> = {
  da_completare: 'Da completare',
  in_corso: 'In corso',
  attivo: 'Attivo',
  scaduto: 'Scaduto',
}

export const DUE_LABELS: Record<string, string> = {
  aperta: 'Aperta',
  parziale: 'Parziale',
  saldata: 'Saldata',
}

export const KIND_LABELS: Record<string, string> = {
  atleta: 'Atleta',
  socio: 'Socio',
  staff: 'Staff',
}

export const MEDICAL_LABELS: Record<string, string> = {
  agonistico: 'Agonistico',
  non_agonistico: 'Non agonistico',
}
