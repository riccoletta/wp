# Gestionale Società di Pallanuoto

Gestionale web privato per società di pallanuoto. In italiano, mobile-first.
La FASE 1 copre l'amministrazione: anagrafiche, ruoli, stagioni e squadre, tesseramenti,
scadenze dei certificati medici e quote con pagamenti registrati a mano.

Da M10 è una **piattaforma multi-società**: ogni società cliente ha il suo ambiente
(`/club/<slug>`) e il suo abbonamento; il proprietario della piattaforma ha un portale
separato (`/admin`) da cui crea le società, ne gestisce l'abbonamento e vi entra.

Le specifiche sono in `MASTER_PROMPT_PALLANUOTO.md`; lo stato dei lavori in `ROADMAP.md`;
le regole per chi ci lavora in `AGENTS.md`.

## Com'è fatto

```
browser (React + Vite, statico su Vercel)
   │
   │  @supabase/supabase-js — VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY
   ▼
Supabase Auth ──▶ JWT ──▶ PostgREST (ruolo `authenticated`, auth.uid())
                               │
                               ▼
                    PostgreSQL + Row Level Security
                      • funzioni api_* (letture composte e operazioni atomiche)
                      • policy = unica fonte di verità dei permessi
                               ▲
                               │  chiave di servizio, solo server-side
                    Supabase Edge Functions
                      • club-invite    (inviti, solo segreteria della società)
                      • license-owner  (licenza unica pre-M10, superata dagli abbonamenti)
```

Non c'è un backend applicativo da mantenere. Non ci sono credenziali PostgreSQL nel
frontend, né certificati, né sessioni fatte in casa. **I permessi vivono solo nelle
policy RLS**: se un dato non deve essere visibile, è la policy a non restituirlo.

- `web/` — React 19 + TypeScript + Vite + Tailwind. Unico artefatto distribuito.
- `db/migrations/` — PostgreSQL puro, numerato, additivo. Nessun ORM.
- `supabase/functions/` — Edge Function (Deno) per le sole operazioni privilegiate.
- `server/` — **non è un server**: sono gli strumenti del database (migrazioni, seed,
  verifica di sicurezza, test di integrazione sulle policy). Gira sul computer di chi
  amministra, non in produzione.

## Avvio rapido

```bash
npm install
cp .env.example .env          # poi compila VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY
npm run dev                   # Vite su http://localhost:5173
```

Per lavorare sul database (migrazioni, test, verifica) servono anche `DATABASE_URL` e
`MIGRATION_DATABASE_URL`: vedi `.env.example`, sezione 2.

## Comandi

| Comando | Che cosa fa |
| --- | --- |
| `npm run dev` | frontend in sviluppo |
| `npm run build` | build di produzione in `web/dist` |
| `npm run check` | typecheck di tutto (database, web, prove e2e) |
| `npm test` | test di integrazione sulle policy RLS e sui flussi FASE 1 (PGlite) |
| `npm run migrate` | applica le migrazioni mancanti, in una transazione sola |
| `npm run db:verify` | prova sul database vero che la sicurezza regga. Non scrive nulla |
| `npm run seed` | dati sintetici per lo sviluppo. Rifiutato in produzione |
| `npm run admin:bootstrap` | collega il primo amministratore di una società alla sua identità Supabase |
| `npm run platform:owner` | promuove una identità a proprietario della piattaforma (`--elenco` per vederli) |
| `npm run e2e` | prove di interfaccia in Chromium (serve un progetto Supabase di prova) |

`npm test` gira su **PGlite**, un PostgreSQL vero in-process: le query vengono eseguite
come ruolo `authenticated` con i claim del JWT nella stessa variabile di sessione che
PostgREST popola, quindi le policy sono applicate davvero e non simulate.

## Autenticazione e ruoli

Le credenziali stanno in **Supabase Auth**. La tabella `app_users` conserva solo il
legame fra la persona in anagrafica e l'identità Supabase (`auth_user_id`).

- **I ruoli non stanno nei metadati dell'account**, che l'utente potrebbe modificare:
  stanno in `user_roles`, che dalla Data API è in **sola lettura per chiunque**. Nessuno
  può assegnarsi un ruolo né cambiare la propria mappatura.
- **Non esiste registrazione pubblica.** Gli accessi si creano per invito, dalla
  segreteria, attraverso la Edge Function `club-invite`, che verifica da sé che il
  chiamante sia admin secondo il database.
- Un atleta può esistere in anagrafica **senza account**: l'invito è un atto separato.
- Il recupero password è quello di Supabase Auth: il link atterra su `/accedi`.

### Primo amministratore

Atto unico e manuale, come le migrazioni — non esiste una pagina di registrazione del
primo utente, sarebbe una porta aperta sul deploy appena fatto.

1. Pannello Supabase → **Authentication → Users → Invite user**, con l'email
   dell'amministratore. La persona riceve l'email e imposta la password da sé.
2. Poi, con la connessione diretta del ruolo proprietario:

```bash
npm run admin:bootstrap -- --email=nome@dominio.it --nome=Mario --cognome=Rossi
# --societa=<slug> per una società diversa da `pallanuoto-milano`
```

Il comando crea `people` + `app_users` + `user_roles('admin')` **in quella società**, in
una transazione sola, e si rifiuta di creare un secondo amministratore della stessa
società (salvo `--aggiungi` dichiarato a mano). Gli accessi successivi si creano per
invito, dalla segreteria.

### Proprietario della piattaforma

È un'altra cosa dall'amministratore di società, e non si diventa l'uno dall'altro.
Non sta in `user_roles`: sta in `platform_owners`, tabella **senza GRANT per nessun
ruolo della Data API**. L'unica via è questo comando, con la connessione diretta del
ruolo proprietario del database:

```bash
npm run platform:owner -- --email=nome@dominio.it --nota="contratto 2026"
npm run platform:owner -- --elenco
```

Promuove **solo** l'indirizzo indicato, registra data e nota, è idempotente e si ferma
davanti a un secondo proprietario salvo `--aggiungi`. Se quell'identità è anche la
segreteria di una società lo dice, e i due poteri restano distinti.

## Database

Le migrazioni sono PostgreSQL puro in `db/migrations`, applicate in ordine dentro **una
transazione** protetta da un lock consultivo: due processi che partono insieme non si
sovrappongono. Migrare è un atto separato dall'avvio.

In locale lo stesso SQL gira su **PGlite** (PostgreSQL embedded, su file, senza Docker);
in produzione su Supabase. La migrazione `0009` crea da sé lo schema `auth` e i ruoli
`anon`/`authenticated`/`service_role` solo dove non esistono: su Supabase è un no-op.

```bash
npm run migrate      # applica le migrazioni mancanti
npm run db:verify    # verifica la sicurezza sul database realmente configurato
```

`npm run db:verify` prova, sul database vero: che l'anonimo non raggiunga nulla, che
l'identità arrivi da `auth.uid()`, che `sessions`, `login_attempts`, `invites`,
`password_hash`, `platform_owners` e `club_sessions` siano irraggiungibili dalla Data
API, che il portale della piattaforma sia chiuso a chi non è proprietario, che senza
identità non ci sia nessuna società corrente, che ogni dato abbia una società e ogni
società il suo abbonamento, che i ruoli non siano assegnabili da sé e che `anon` non
abbia privilegi.

### Passaggio a multi-società (migrazione `0012`/`0013`)

Additiva: nessuna migrazione precedente è stata riscritta, nessuna tabella ricreata,
nessun dato cancellato. `0012` crea **Pallanuoto Milano** come prima società e vi
associa tutto quello che c'era, trasformando la licenza unica nel suo abbonamento.

```bash
npm run migrate      # prima su un database di prova
npm run db:verify
npm test
# poi, solo dopo approvazione esplicita, sul progetto di produzione:
npm run migrate
npm run db:verify
npm run platform:owner -- --email=<proprietario>
```

Il passo `platform:owner` è l'unico che aggiunge un potere nuovo: promuove **una sola**
identità già esistente in Supabase Auth e non tocca gli amministratori di società.

### Che cosa è esposto dalla Data API

| Esposto in lettura (sotto RLS) | Esposto in scrittura (solo admin, solo con abbonamento operativo) | Mai esposto |
| --- | --- | --- |
| `people`, `guardian_links`, `seasons`, `teams`, `team_memberships`, `coach_assignments`, `registrations`, `medical_expiries`, `dues`, `payment_records`, `dues_status`, `user_roles`, `clubs` e `subscriptions` della propria società, e di `app_users` le sole colonne non sensibili | tutte le tabelle della società, tramite le policy `*_ins` / `*_upd` / `*_del`; `clubs` e `subscriptions` solo per il proprietario della piattaforma | `sessions`, `login_attempts`, `invites`, `app_users.password_hash`, `platform_owners`, `club_sessions`, scrittura su `user_roles` |

Ogni riga di dati porta `club_id` e **ogni policy passa da `app_club_open(club_id)`**:
fuori dalla società in cui si è dichiarato di entrare i dati non esistono, nemmeno per
contarli. Le chiavi esterne sono composite `(figlio, club_id) → (padre, club_id)`:
legare fra loro righe di società diverse non è vietato dall'applicazione, è impossibile
nel database.

I privilegi sono **GRANT espliciti**: `EXECUTE` è revocato a `PUBLIC`, quindi una funzione
nuova nello schema `public` non diventa un endpoint RPC per distrazione.

## Deploy

### Frontend (Vercel)

Il progetto è statico. Le uniche variabili d'ambiente sono:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<chiave pubblicabile>
```

Nient'altro. **Niente `DATABASE_URL`, niente certificati, niente chiave di servizio**: la
chiave di servizio scavalca la RLS, e in una variabile `VITE_*` finisce nel bundle che
chiunque può aprire.

### Supabase

1. `npm run migrate` con la connessione diretta del ruolo proprietario.
2. `npm run db:verify`: tutte le verifiche devono passare **prima** di attivare la
   Data API.
3. Authentication → URL Configuration: *Site URL* e *Redirect URLs* sul dominio Vercel
   reale, altrimenti i link di invito e di recupero password tornano su `localhost`.
4. Edge Function:

```bash
supabase functions deploy club-invite
supabase functions deploy license-owner --no-verify-jwt
supabase secrets set LICENSE_OWNER_TOKEN=... APP_SITE_URL=https://<dominio>
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` le fornisce Supabase
alle funzioni: non si impostano a mano e non escono da lì.

## Dati personali

Il gestionale tiene il minimo indispensabile. Dei certificati medici registra **soltanto**
tipologia facoltativa, data di scadenza e stato: nessun file, nessun referto, nessuna
informazione clinica. I minori sono visibili solo alla segreteria, ai tutori collegati e
all'allenatore della loro squadra. Questa è minimizzazione dei dati, non una dichiarazione
di conformità GDPR: quella richiede una verifica legale.

## Abbonamento per società

Ogni società ha una riga in `subscriptions`: scadenza, giorni di tolleranza e stato
(`attiva` / `sospesa`). Lo stato operativo è **derivato**, mai scritto a mano:

| Situazione | Accesso della società |
| --- | --- |
| In corso di validità | completo |
| Entro 30 giorni dalla scadenza | completo, con avviso in testata |
| Scaduto, entro la tolleranza | completo, con avviso in testata |
| Tolleranza finita, oppure sospeso | **nessun dato operativo**: restano accesso, motivo e uscita |

**Il blocco è nel database, non nel browser.** Le policy passano da `app_club_open()` in
lettura e da `app_can_write()` in scrittura: un utente autenticato che chiama la REST API
di Supabase a mano incontra lo stesso muro dell'interfaccia, con lo stesso messaggio
italiano. **Nessun dato viene mai cancellato o archiviato**: tornano tutti visibili alla
riattivazione. Il proprietario della piattaforma entra anche in una società sospesa,
altrimenti non potrebbe rimetterla in piedi.

Rinnovo, sospensione e riattivazione sono riservati al **proprietario della piattaforma**
e si fanno dal portale `/admin`: le RPC `api_platform_*` verificano `platform_owners` e le
policy di `clubs`/`subscriptions` non concedono scrittura a nessun altro. Nemmeno la
segreteria può allungarsi l'abbonamento. Ogni atto lascia una riga in
`subscription_events` (chi, quando, che cosa).

La vecchia licenza unica (tabella `license`, Edge Function `license-owner`) resta solo
come storia: `0012` ne ha copiato stato e date nell'abbonamento della prima società.

## Prove di interfaccia

`npm run e2e` apre Chromium e clicca davvero le pagine. Servono le credenziali di un
**progetto Supabase di prova** — mai quello di produzione, perché le prove scrivono — e
gli account sintetici del seed creati in Supabase Auth. I nomi delle variabili sono in
`playwright.config.ts`.

## Fuori perimetro

Per scelta esplicita non esistono e non verranno aggiunti: registro presenze, convocazioni,
report e statistiche, archivio documenti, upload di certificati, funzioni social
(feed, post, commenti, chat) e pagamenti online.

Piscine, spazi e calendario degli allenamenti ricorrenti sono la **FASE 2**: pianificata in
`ROADMAP.md`, non ancora iniziata.
