/**
 * Ferri del mestiere condivisi dalle prove sulla Data API.
 *
 * Le query girano come ruolo `authenticated` con i claim del JWT nella stessa
 * variabile di sessione che PostgREST popola: le policy sono applicate davvero.
 */
import { asDataApi, type Tx } from '../src/db.js'

/** Chiama una funzione `api_*` dentro una transazione già aperta. */
export const rpc = <T = any>(tx: Tx, fn: string, args: unknown[] = []) =>
  tx.one<any>(`select ${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) as r`, args)
    .then((row) => row!.r as T)

/** Una chiamata RPC come un ruolo, in una transazione tutta sua (come farebbe PostgREST). */
export const call = <T = any>(authUserId: string | null, fn: string, args: unknown[] = []) =>
  asDataApi(authUserId, (tx) => rpc<T>(tx, fn, args))

/** Il codice SQLSTATE di una query che deve fallire, o `null` se è passata. */
export async function sqlstate(fn: () => Promise<unknown>): Promise<string | null> {
  try { await fn(); return null } catch (err: any) { return err?.code ?? err?.message ?? 'errore' }
}

/** Diniego vero: `insufficient_privilege`, dalla RLS o da un GRANT mancante. */
export const denied = (code: string | null) =>
  code === '42501' || (code !== null && /permission denied/i.test(code))

/** Data di calendario a N giorni da oggi: le prove non devono invecchiare. */
export const inDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10)
