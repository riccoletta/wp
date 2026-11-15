import { useClub } from '../lib/club'

/**
 * Avviso sullo stato dell'abbonamento della società. È solo informativo: a chiudere
 * la società quando l'abbonamento è fermo sono le policy del database, non questa
 * fascia. Durante la tolleranza si lavora come sempre, con l'avviso in testata.
 */
const tones: Record<string, string> = {
  in_scadenza: 'border-amber-300 bg-amber-50 text-amber-900',
  tolleranza: 'border-orange-300 bg-orange-50 text-orange-900',
  scaduta: 'border-red-300 bg-red-50 text-red-900',
  sospesa: 'border-red-300 bg-red-50 text-red-900',
}

export default function SubscriptionBanner() {
  const { subscription } = useClub()
  const data = subscription.data
  if (!data?.message) return null
  return (
    <div role="status" aria-live="polite"
      className={`border-b px-4 py-2 text-sm ${tones[data.phase] ?? 'border-slate-200 bg-slate-50'}`}>
      <p className="mx-auto max-w-6xl">
        <span className="font-semibold">{data.blocked ? 'Società chiusa — ' : 'Avviso — '}</span>
        {data.message}
      </p>
    </div>
  )
}
