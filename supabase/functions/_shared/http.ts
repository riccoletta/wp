/** Intestazioni e risposte comuni alle Edge Function. */

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-license-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' },
  })

/** Messaggi d'errore in italiano: li legge direttamente l'interfaccia. */
export const fail = (status: number, error: string) => json({ error }, status)

export const preflight = (req: Request) =>
  req.method === 'OPTIONS' ? new Response('ok', { headers: cors }) : null

/**
 * Confronto a tempo costante fra due segreti. `!==` esce al primo byte diverso e
 * lascia misurare quanti caratteri si erano indovinati.
 */
export async function sameSecret(given: string, expected: string): Promise<boolean> {
  const digest = async (s: string) =>
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
  const [a, b] = [await digest(given), await digest(expected)]
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}
