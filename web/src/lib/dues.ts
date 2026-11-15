/**
 * Somme delle quote: per persona e per squadra.
 *
 * Gli importi arrivano già calcolati dal database (vista `dues_status`): qui si
 * sommano soltanto. Lo stato resta **derivato** con la stessa regola del database
 * — saldata se il versato copre il dovuto, parziale se c'è almeno un versamento,
 * aperta altrimenti — perché una persona può avere più di una quota nella stagione.
 *
 * Nessun import: questo file è logica pura, provata fuori dal browser.
 */

export type DueStatus = 'aperta' | 'parziale' | 'saldata'

/** Una quota come la restituisce `api_dues_list`, ridotta a quello che serve qui. */
export interface DueAmounts {
  personId: string
  amountCents: number
  paidCents: number
  remainingCents: number
}

export interface PersonDues {
  count: number
  amountCents: number
  paidCents: number
  remainingCents: number
  status: DueStatus
}

/** Le quote di una stagione raccolte per persona. Chi non compare non ha quote. */
export function duesByPerson(dues: DueAmounts[]): Map<string, PersonDues> {
  const byPerson = new Map<string, PersonDues>()
  for (const d of dues) {
    const acc = byPerson.get(d.personId)
      ?? { count: 0, amountCents: 0, paidCents: 0, remainingCents: 0, status: 'aperta' as DueStatus }
    acc.count += 1
    acc.amountCents += d.amountCents
    acc.paidCents += d.paidCents
    acc.remainingCents += d.remainingCents
    acc.status = acc.paidCents >= acc.amountCents ? 'saldata' : acc.paidCents > 0 ? 'parziale' : 'aperta'
    byPerson.set(d.personId, acc)
  }
  return byPerson
}

export interface TeamTotals {
  amountCents: number
  paidCents: number
  remainingCents: number
  /** Atleti in rosa senza nessuna quota assegnata nella stagione. */
  withoutDues: number
}

/** Il quadro economico della sola rosa: le quote di chi non è in squadra non entrano. */
export function teamTotals(rosterIds: string[], byPerson: Map<string, PersonDues>): TeamTotals {
  const totals: TeamTotals = { amountCents: 0, paidCents: 0, remainingCents: 0, withoutDues: 0 }
  for (const id of rosterIds) {
    const dues = byPerson.get(id)
    if (!dues) { totals.withoutDues += 1; continue }
    totals.amountCents += dues.amountCents
    totals.paidCents += dues.paidCents
    totals.remainingCents += dues.remainingCents
  }
  return totals
}
