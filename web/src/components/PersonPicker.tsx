import { useState } from 'react'
import { ApiError, listPeople, type Person } from '../lib/data'
import { Async, Button, Field, Modal, Select, useApi } from './ui'

/**
 * Sceglie una persona fra quelle visibili e la consegna a chi ha aperto il dialogo.
 * L'elenco arriva dalla RLS: un allenatore vede solo i propri atleti, quindi qui non
 * c'è nessun filtro di permessi, solo quello delle persone già assegnate.
 */
export default function PersonPicker({ title, exclude = [], confirmLabel = 'Conferma', onClose, onPick }: {
  title: string
  exclude?: string[]
  confirmLabel?: string
  onClose: () => void
  onPick: (personId: string) => Promise<void>
}) {
  const people = useApi<Person[]>(() => listPeople())
  const [selected, setSelected] = useState('')
  const [error, setError] = useState<string | null>(null)

  return (
    <Modal title={title} onClose={onClose}>
      <Async state={people} empty={{ title: 'Nessuna persona disponibile.' }}>
        {(list) => {
          const options = list.filter((p) => !exclude.includes(p.id))
          return (
            <form className="space-y-3" onSubmit={async (e) => {
              e.preventDefault()
              setError(null)
              try { await onPick(selected) } catch (err) {
                setError(err instanceof ApiError ? err.message : 'Server non raggiungibile.')
              }
            }}>
              <Field label="Persona">
                <Select value={selected} required onChange={(e) => setSelected(e.target.value)}>
                  <option value="">Scegli…</option>
                  {options.map((p) => (
                    <option key={p.id} value={p.id}>{p.lastName} {p.firstName}</option>
                  ))}
                </Select>
              </Field>
              {options.length === 0 && (
                <p className="text-sm text-slate-600">Tutte le persone disponibili sono già assegnate.</p>
              )}
              {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={onClose}>Annulla</Button>
                <Button type="submit" disabled={!selected}>{confirmLabel}</Button>
              </div>
            </form>
          )
        }}
      </Async>
    </Modal>
  )
}
