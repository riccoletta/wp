import { createContext, useContext, type ReactNode } from 'react'
import { Link as RouterLink, NavLink as RouterNavLink, useParams,
  type LinkProps, type NavLinkProps } from 'react-router-dom'
import { enterClub, getSubscription, type Club, type Subscription } from './data'
import { useAuth } from './auth'
import { Async, useApi, type AsyncState } from '../components/ui'
import ClubClosed from '../pages/ClubClosed'

/**
 * La società in cui si sta lavorando.
 *
 * `api_club_enter` registra la scelta **nel database**, che la rivalida a ogni
 * chiamata: da lì in poi ogni policy filtra su quella società. Questo contesto
 * serve solo a due cose di interfaccia — sapere come si chiama la società e
 * costruire gli indirizzi `/club/<slug>/...`. Non è un filtro di sicurezza:
 * digitare l'indirizzo di un'altra società non apre niente, perché la chiamata
 * qui sotto viene respinta e, anche se non lo fosse, le righe non arriverebbero.
 */
interface ClubValue {
  club: Club
  /** Prefisso degli indirizzi interni: `/club/<slug>`. */
  base: string
  subscription: AsyncState<Subscription | null>
}

const ClubContext = createContext<ClubValue | null>(null)

export function useClub() {
  const ctx = useContext(ClubContext)
  if (!ctx) throw new Error('useClub fuori da ClubProvider')
  return ctx
}

/** Fuori da una società (portale della piattaforma) il prefisso è vuoto. */
export const useClubBase = () => useContext(ClubContext)?.base ?? ''

const prefixed = (base: string, to: LinkProps['to']) =>
  typeof to === 'string' && to.startsWith('/') && !to.startsWith('/club/') && to !== '/admin'
    ? base + to
    : to

/**
 * Gli stessi `Link` e `NavLink` di react-router, ma dentro la società corrente:
 * `/persone` diventa `/club/<slug>/persone`. Le pagine della FASE 1 non hanno
 * dovuto cambiare un indirizzo: cambia l'import, non il codice.
 */
export const Link = ({ to, ...rest }: LinkProps) => {
  const base = useClubBase()
  return <RouterLink to={prefixed(base, to)} {...rest} />
}

export const NavLink = ({ to, ...rest }: NavLinkProps) => {
  const base = useClubBase()
  return <RouterNavLink to={prefixed(base, to) as NavLinkProps['to']} {...rest} />
}

export function ClubProvider({ children }: { children: ReactNode }) {
  const { slug } = useParams<{ slug: string }>()
  const { me, refresh } = useAuth()

  // Entrare nella società e rileggere chi si è: ruoli e permessi del client
  // dipendono dalla società, quindi `api_me()` va richiesto dopo l'ingresso.
  const entered = useApi<Club>(async () => {
    const club = await enterClub(slug!)
    await refresh()
    return club
  }, [slug])

  const subscription = useApi<Subscription | null>(
    entered.data ? getSubscription : null, [entered.data?.id])

  return (
    <Async state={entered}>
      {(club) => (
        <ClubContext.Provider value={{ club, base: `/club/${club.slug}`, subscription }}>
          <Async state={subscription}>
            {(sub) => (
              // Abbonamento scaduto o sospeso: la società non è consultabile e il
              // database non restituisce nulla. Si mostra il perché, non una pagina
              // vuota. Il proprietario della piattaforma entra lo stesso.
              sub?.blocked && !me?.platformOwner
                ? <ClubClosed club={club} subscription={sub} />
                : <>{children}</>
            )}
          </Async>
        </ClubContext.Provider>
      )}
    </Async>
  )
}
