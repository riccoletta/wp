import { useApi } from './ui'
import { getLicense, type License } from '../lib/data'

/**
 * Avviso sullo stato della licenza. È solo informativo: il blocco delle scritture
 * lo applica il database con le policy di scrittura, non questa fascia.
 */
const tones: Record<string, string> = {
  in_scadenza: 'border-amber-300 bg-amber-50 text-amber-900',
  tolleranza: 'border-orange-300 bg-orange-50 text-orange-900',
  scaduta: 'border-red-300 bg-red-50 text-red-900',
  sospesa: 'border-red-300 bg-red-50 text-red-900',
}

export default function LicenseBanner() {
  const { data } = useApi<License>(getLicense)
  if (!data?.message) return null
  return (
    <div role="status" aria-live="polite"
      className={`border-b px-4 py-2 text-sm ${tones[data.phase] ?? 'border-slate-200 bg-slate-50'}`}>
      <p className="mx-auto max-w-6xl">
        <span className="font-semibold">{data.readOnly ? 'Sola lettura — ' : 'Avviso — '}</span>
        {data.message}
      </p>
    </div>
  )
}
