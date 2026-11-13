# Audit di qualità, semplificazione e peso del codice

Ramo di partenza: `supabase-native` (`3a86c11`). Niente FASE 2, niente nuove funzioni.
L'obiettivo non è il conteggio di righe: è togliere codice morto, duplicazione vera e
accoppiamenti che costano manutenzione. Dove ridurre righe peggiorerebbe la leggibilità
o la sicurezza, non si riduce.

## Baseline misurata

| Area | File | Righe |
| --- | ---: | ---: |
| Frontend (`web/src`) | 19 | **2 547** |
| Migrazioni SQL (`db/migrations`, 0001→0011) | 11 | **1 225** |
| — di cui M9 (0009–0011) | 3 | 758 |
| Edge Function (`supabase/functions`) | 3 | **252** |
| Strumenti del database (`server/`) | 10 | **1 305** |
| Prove di interfaccia (`e2e/`) | 4 | **286** |

- Bundle: `index.js` **456,95 kB** (gzip 127,88 kB) · `index.css` 18,96 kB (gzip 4,64 kB).
- Test: **38/38** verdi (`npm test`, PGlite). `npm run check` pulito. Build ok.
- Dipendenze di runtime del frontend: 4 (`@supabase/supabase-js`, `react`, `react-dom`,
  `react-router-dom`). Nessuna superflua.
- `server/` ha 2 dipendenze (`pg`, `@electric-sql/pglite`): servono entrambe, la prima per
  migrare e verificare Supabase, la seconda per far girare i test su PostgreSQL vero.

## Vincolo che governa tutto l'audit

**Le migrazioni applicate non si riscrivono.** `0009`–`0011` sono già su `pnm`: modificarle
non cambierebbe nulla in produzione e farebbe divergere repository e database. Qualsiasi
semplificazione SQL costerebbe una migrazione nuova, cioè **più** righe, non meno. Per
questo l'SQL resta fuori dalla fase di ottimizzazione, salvo difetti veri (non ce ne sono).

## Rilievi

| Area | Problema | Modifica proposta | Beneficio atteso | Rischio | Pr. |
| --- | --- | --- | --- | --- | --- |
| `web/src/lib/data.ts` | `deleteDue` e `deleteTeam` non sono chiamate da nessuna parte: wrapper di RPC che l'interfaccia non usa | Rimuovere le due funzioni (le RPC restano nel database) | −6 righe, superficie client più piccola | nullo | **P0** |
| `web/src/lib/format.ts` | `age()` esportata ma usata solo da `isMinor()`, nello stesso file | Renderla locale (**rilievo corretto in corsa: non era morta**, la prima scansione escludeva i riferimenti nello stesso file) | superficie pubblica più piccola | nullo | P2 |
| `server/src/db.ts` | `Driver.exec` dichiarata nell'interfaccia e implementata nei due driver, **mai chiamata** dall'esterno | Rimuovere dall'interfaccia e dalle due implementazioni | −4 righe, un'astrazione in meno | nullo | **P0** |
| `PersonDetail.tsx` / `TeamDetail.tsx` | `GuardianPicker` (38 righe) è `PersonPicker` (41 righe) con un'opzione in meno: stesso form, stessa `listPeople()`, stesso errore, stessa `Select` | Estrarre un solo `PersonPicker` condiviso e cancellare il duplicato | −~45 righe, un comportamento solo da correggere | basso | **P0** |
| `server/test/*.test.ts` | Gli helper `rpc`/`call` sono copiati in due file di prova | Spostarli in un helper unico | −~10 righe | nullo | **P0** |
| 13 punti in `web/src/pages` | `err instanceof ApiError ? err.message : 'Server non raggiungibile.'` ripetuto 13 volte, stringa magica compresa | Una funzione `messaggioErrore(err)` in `data.ts` | messaggio in un posto solo | basso | **P1** |
| `PersonDetail.tsx` | Esporta `MedicalBadge`, `RegistrationBadge`, `DueBadge`, importate da `Medical`, `Registrations`, `TeamDetail`, `Dues`: quattro pagine dipendono da un file di 551 righe per tre badge | Spostare i badge in `components/badges.tsx` | accoppiamento sciolto, `PersonDetail` più corto; **sposta righe, non le toglie** | basso | **P1** |
| `server/src/db.ts` | Il pool `pg` è ancora tarato per Vercel (`process.env.VERCEL`, `allowExitOnIdle`, `DATABASE_POOL_IDLE_MS`): non esiste più nessun runtime serverless, quei comandi girano da riga di comando | Togliere il ramo serverless e la variabile d'ambiente che non serve più | −6 righe, una variabile in meno da documentare | basso | **P1** |
| `web/src/components/ui.tsx` | `EmptyState` e `ErrorState` sono esportate ma usate solo dentro `ui.tsx` | Renderle locali | superficie pubblica più piccola | nullo | P2 |
| `web/src/lib/auth.tsx` | **Da approvare.** Alla login `api_me()` parte **due volte** (l'evento `SIGNED_IN` e la `refresh()` esplicita); `TOKEN_REFRESHED` rilancia `api_me()` a ogni rinnovo del token, circa ogni ora, anche se l'identità non cambia | Togliere `TOKEN_REFRESHED` dagli eventi che ricaricano e lasciare che sia l'evento `SIGNED_IN` a popolare `me` | −1 chiamata per login, −1 chiamata all'ora per sessione | **tocca l'autenticazione** | P1 → **proposta** |
| `db/migrations/0010_api_rpc.sql` | ~8 funzioni ripetono lo stesso scheletro `declare hit; … if hit is null then perform api_deny()` | **Nessuna.** Migrazione già applicata: toccarla non cambia il database e una 0012 che riscrive 8 funzioni aggiungerebbe righe | — | — | **non fare** |
| `api_dashboard()` | Restituisce `roles`, che il client ha già da `api_me()` | **Nessuna.** Toglierlo richiede una migrazione nuova per risparmiare un campo | — | — | **non fare** |
| Bundle | **Da approvare.** `@supabase/supabase-js` include il client Realtime, che non usiamo (verificato: `RealtimeClient` è nel bundle, `StorageClient` no) | Sostituire `supabase-js` con `auth-js` + `postgrest-js` + `functions-js` | bundle più piccolo (stima 60–90 kB non compressi) | **tocca l'autenticazione**, più dipendenze da tenere allineate | P2 → **proposta** |
| Routing | Un solo chunk da 457 kB: nessun code splitting | `React.lazy` sulle rotte | primo caricamento più leggero | basso, ma è ottimizzazione speculativa su un gestionale privato | P2 |
| `e2e/` | 286 righe non eseguibili finché non c'è un progetto Supabase di prova | **Nessuna.** Non sono codice morto: sono prove in attesa di un ambiente | — | — | **non fare** |

## Che cosa resta fuori per scelta

- **SQL e RLS**: nessuna modifica. Le policy sono l'unica fonte di verità dei permessi e
  il blocco della licenza vive lì: una riscrittura "per pulizia" è un rischio di sicurezza
  senza contropartita.
- **Edge Function** (252 righe): nessun codice morto, nessuna duplicazione reale.
  `_shared/http.ts` è condiviso da entrambe, come dev'essere.
- **Strumenti del database**: `pg` e PGlite servono entrambi, `bootstrap.ts` serve una
  volta sola ma serve. Non si tocca ciò che migra o prova.
- **Test**: nessun test rimosso, nessuna asserzione indebolita.

## Esito misurato

Applicato su `supabase-native-slim`, in cinque lotti verificati uno per uno.

| Metrica | Prima | Dopo | Δ |
| --- | ---: | ---: | ---: |
| Frontend `web/src` | 2 547 | 2 540 | −7 |
| Edge Function | 252 | 252 | 0 |
| Migrazioni SQL | 1 225 | 1 225 | 0 |
| Strumenti del database `server/src` | 814 | 814 | −5 netto in `db.ts`, +5 altrove |
| Prove `server/test` | 487 | 592 | **+105** (nuova copertura, non gonfiore) |
| Bundle `index.js` | 456,95 kB | 455,62 kB | −1,33 kB |
| Bundle gzip | 127,88 kB | 127,81 kB | −0,07 kB |
| Test | 38/38 | **44/44** | +6 |
| Dipendenze | 4 + 2 | 4 + 2 | 0 |

### Che cosa toglie codice davvero

- `deleteDue`, `deleteTeam`: wrapper mai chiamati — **−6 righe**.
- `Driver.exec`: metodo d'interfaccia mai invocato dall'esterno — **−4 righe**.
- Ramo serverless del pool `pg` e `DATABASE_POOL_IDLE_MS`: morti da quando Express
  non c'è più — **−5 righe, −1 variabile d'ambiente**.
- `GuardianPicker`: duplicato di `PersonPicker` — **−21 righe nette** e, soprattutto,
  un comportamento solo da mantenere invece di due.
- Helper delle prove duplicati nei due file — **−1 duplicazione**.

### Che cosa sposta soltanto

- `PersonPicker` e `badges.tsx`: il codice esce da `PersonDetail.tsx` (551 → 498) e
  da `TeamDetail.tsx` (149 → 107), ma riappare quasi per intero nei file condivisi.
  Il guadagno è l'accoppiamento sciolto — quattro pagine non dipendono più da un
  modulo di 500 righe — **non il conteggio**.
- `errorMessage(err)`: 12 copie della stessa riga diventano una. Righe quasi
  invariate, una stringa invece di dodici.

### Che cosa aggiunge codice, a ragion veduta

- `server/test/bootstrap.test.ts` (+105 righe): `bootstrapAdmin` era rimasto **senza
  prove** dopo la migrazione, ed è il percorso che crea l'unico account capace di
  scrivere tutto. Qui l'obiettivo "meno righe" cede al fatto che un percorso di
  sicurezza scoperto costa più di cento righe di prova.
- `denied()` nelle prove è stata **ristretta**, non allargata: ora riconosce solo
  `42501` e `permission denied`. I test restano verdi, quindi l'asserzione è più
  forte di prima.

### Conclusione onesta

Il codice era già magro: non c'erano grossi blocchi da buttare, e le due riduzioni
davvero sostanziose disponibili sono entrambe bloccate.

1. **L'SQL (1 225 righe, di cui 758 di M9)** è già applicato a `pnm`. Riscriverlo non
   cambia il database e costa una migrazione in più.
2. **Il bundle (456 kB)** scenderebbe togliendo il client Realtime che non usiamo, ma
   vuol dire sostituire `supabase-js` con tre pacchetti e rimettere mano
   all'autenticazione.

## Resta da approvare (non eseguito)

| # | Proposta | Perché non l'ho fatto |
| --- | --- | --- |
| 1 | `auth.tsx`: togliere `TOKEN_REFRESHED` dagli eventi che ricaricano `api_me()` e lasciare che sia il solo `SIGNED_IN` a popolare `me`. Risparmia una chiamata per login e una all'ora per sessione | Tocca l'autenticazione e non esiste copertura e2e del livello React: la verifica richiede un ambiente Supabase di prova |
| 2 | Sostituire `@supabase/supabase-js` con `auth-js` + `postgrest-js` + `functions-js` per non imbarcare Realtime | Tocca l'autenticazione, aggiunge tre dipendenze da tenere allineate, beneficio stimato ma non misurato |
| 3 | `React.lazy` sulle rotte | Ottimizzazione speculativa: un gestionale privato con un bundle da 128 kB gzip non ha un problema di primo caricamento |
| 4 | `SeasonField` condiviso fra `RegistrationForm` e `DueForm` in `PersonDetail` | ~10 righe: sotto la soglia in cui un'astrazione in più conviene |
