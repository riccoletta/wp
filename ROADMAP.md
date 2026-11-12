# ROADMAP — GESTIONALE SOCIETÀ DI PALLANUOTO

Stato operativo del progetto. `[x]` = completato **e verificato**. Fonte della specifica:
`MASTER_PROMPT_PALLANUOTO.md`, `ROADMAP_PALLANUOTO.md`, `AGENTS_PALLANUOTO.md` (non modificarli).

## Obiettivo
Gestionale web privato, italiano, mobile-first, per **una sola società di pallanuoto**.
FASE 1 = anagrafiche, ruoli, stagioni/squadre, tesseramenti, scadenze certificati, quote, dashboard operativa.
FASE 2 (solo dopo approvazione) = piscine/spazi + calendario allenamenti ricorrenti.

## Esclusioni definitive (non pianificare, non implementare)
Social (feed/post/like/commenti/chat/DM) · registro presenze effettive · convocazioni ·
report/statistiche/analytics/export · archivio documenti, moduli, upload certificati ·
multi-club, app native, gateway di pagamento.
Dei certificati si conservano **solo** tipo opzionale, data di scadenza e stato: nessun file, nessun dato clinico.

## Stack e decisioni tecniche
- Repo era vuoto → **React + TypeScript + Vite + Tailwind** (frontend), **Express + TypeScript** (API), **PostgreSQL con Row Level Security** (dati).
- **D7 — Driver DB a due teste.** Le migrazioni sono PostgreSQL puro. In locale girano su **PGlite**
  (Postgres embedded, persistito su file, nessun Docker necessario); in produzione su qualsiasi
  Postgres/Supabase via `DATABASE_URL`. Stesso SQL, stesse policy.
- **D8 — Auth propria invece di Supabase Auth.** Nell'ambiente di sviluppo non sono disponibili
  Docker/CLI Supabase, quindi Supabase Auth non è verificabile end-to-end. Usiamo email+password
  (`scrypt`, stdlib Node), sessione in cookie httpOnly, inviti a token. L'identità arriva al DB come
  `app.user_id`, perciò la sicurezza resta **server-side e RLS**, non frontend.
- **D9 — RLS come unica fonte di verità dei permessi.** Ogni richiesta API apre una transazione con
  `SET LOCAL ROLE app_user` + `SET LOCAL app.user_id`; l'API non ricostruisce i filtri per ruolo.
  Verificato: in PGlite, con `SET LOCAL ROLE`, le policy sono applicate davvero.
- Un solo club, niente multi-tenancy. Date e orari `Europe/Rome`. Migrazioni versionate in `db/migrations`.
- `.env.example` presente, nessun segreto nel repo, seed solo sintetici.
- Navigazione FASE 1: `Dashboard`, `Persone`, `Squadre`, `Tesseramenti`, `Scadenze`, `Quote`, `Profilo`
  (solo le voci autorizzate per il ruolo).

## Ruoli
`admin` (segreteria) · `coach` · `athlete` (atleta adulto) · `guardian` (genitore/tutore). Ruoli multipli ammessi.
Un atleta può esistere in anagrafica **senza account**. Gli accessi sono su invito.

---

## FASE 1 — MVP amministrativo

### M0 — Fondamenta [P0]
- [x] Ispezione repository (conteneva solo i tre file di specifica, conservati).
- [x] STEP 1 — `ROADMAP.md`.
- [x] STEP 2 — `AGENTS.md`.
- [x] Monorepo minimo: `server/`, `web/`, `db/migrations/`, `.env.example`, `README.md`.
- [x] Migration `0001_init.sql`: `people`, `app_users`, `user_roles`, `invites`, `sessions`, ruolo `app_user`, RLS attiva.
- [x] Auth reale: login, logout, sessione cookie httpOnly, `GET /api/me`.
- [x] Route protette lato UI + rifiuto `401` lato API.
- [x] Test: build/typecheck + login ok, login errato, accesso anonimo negato, RLS su `people`.
- **Done:** app avviabile, DB persistente su disco, login e separazione ruoli verificati.

### M1 — Persone, ruoli, stagioni e squadre [P0]
- [x] CRUD anagrafiche (atleta/socio/staff) con archiviazione, senza obbligo di account.
- [x] Inviti: segreteria genera invito per una persona → registrazione con token → account attivo.
- [x] Stagioni sportive (una attiva) e squadre/categorie per stagione.
- [x] Roster: assegnazione/rimozione atleti alla squadra nella stagione; storico per stagione preservato.
- [x] `coach_assignments` (allenatore↔squadra) e `guardian_links` (tutore↔minore).
- [x] Ricerca e filtri su Persone; stati loading/vuoto/errore in tutte le liste.
- [x] Test RLS: coach squadra A non legge roster/persone squadra B; tutore vede solo i propri minori.
- **Done:** segreteria crea atleta → assegna a squadra+stagione → refresh → dati corretti; accessi non autorizzati respinti.

### M2 — Tesseramenti [P1]
- [x] `registrations`: stato per atleta+stagione (`da_completare`/`in_corso`/`attivo`/`scaduto`), date, note amministrative.
- [x] Filtri per stato e stagione; scrittura riservata ad admin (test di accesso negato per coach/atleta).
- [x] Persistenza verificata dopo refresh.
- **Done:** segreteria aggiorna lo stato tesseramento e lo ritrova dopo refresh.

### M3 — Certificati e scadenze [P1]
- [x] `medical_expiries`: tipo opzionale, data scadenza, stato derivato, ultimo aggiornamento. Nessun file, nessun dato clinico.
- [x] Pagina `Scadenze` con evidenza scaduti / in scadenza (≤30 gg).
- [x] Atleta vede la propria scadenza, tutore quella dei minori collegati, coach solo i propri atleti.
- **Done:** scadenza salvata visibile in lista e in dashboard, con permessi verificati.

### M4 — Quote e pagamenti manuali [P1]
- [x] `dues` (importo dovuto, scadenza, stato) e `payment_records` (versamenti manuali, anche parziali).
- [x] Residuo e stato (`aperta`/`parziale`/`saldata`) calcolati dai pagamenti registrati.
- [x] Atleta/tutore consultano solo la propria posizione; nessun checkout, nessun dato di pagamento elettronico.
- [x] Test: importi, stato dopo pagamento parziale e totale, scrittura negata ai non-admin.
- **Done:** segreteria crea quota → registra pagamento → stato aggiornato e persistente.

### M5 — Rifinitura MVP [P1]
- [x] Dashboard per ruolo con **contatori operativi** (certificati scaduti/in scadenza, quote insolute, tesseramenti da completare). Non è un modulo di report.
- [x] Navigazione coerente col ruolo, responsive 360 px, focus/aria di base, messaggi d'errore leggibili.
- [x] Seed sintetico (`npm run seed`) e istruzioni di deploy nel README.
- [x] Suite di test dei flussi M1–M4 + casi di accesso negato (30 test sull'API reale con database vero).
- [x] Seed rieseguibile: `npm run seed` è idempotente, non crea mai una seconda stagione attiva
  e preserva i dati già presenti (fix del `duplicate key ... seasons_single_active_idx`).
- **Done:** ciclo completo persone → squadre → tesseramento → certificato → quota, verificato
  end-to-end sull'API con database persistente (il dato sopravvive al riavvio del server).

### M5c — Verifica dell'interfaccia in browser [P0]
- [x] `npm run e2e` (Playwright + Chromium): le pagine React vengono **cliccate**, non solo compilate.
  Database PGlite dedicato `db/e2e-data`, ricreato e popolato a ogni esecuzione.
- [x] Ciclo segreteria: login, dashboard, nuova anagrafica, ricerca, roster di squadra, quota,
  versamento parziale con stato derivato, uscita. Ogni passo riletto dopo `reload`.
- [x] Accessi negati visti dall'interfaccia: allenatore (solo la propria squadra, nessuna quota),
  atleta (solo la propria posizione), tutore (solo il minore collegato). L'URL digitato a mano
  non apre nulla in più: è la policy RLS a non restituire le righe.
- [x] Mobile 360 px: il menù si apre dal pulsante, nessuno scorrimento orizzontale.
- [x] Licenza: sospesa → fascia "Sola lettura" e salvataggio respinto con messaggio italiano,
  dati intatti; riattivata → la fascia sparisce e la scrittura torna.
- **Done:** il limite di verifica è sanato, la FASE 1 è stata provata in un browser vero.

### M5b — Licenza d'uso annuale [P0]
- [x] `license`: riga unica con scadenza, `grace_days` e stato (`attiva`/`sospesa`). Stato operativo **derivato**
  (attiva / in scadenza / tolleranza / scaduta / sospesa), mai un campo "sola lettura" scrivibile.
- [x] Applicazione lato server: in sola lettura ogni `POST/PUT/PATCH/DELETE` sotto `/api` esce `403`
  con messaggio italiano; `GET`, login e logout restano attivi. Nessun dato cancellato o nascosto.
- [x] Canale del proprietario `/api/owner/license` (`renew`/`suspend`/`reactivate`) chiuso dal token di
  servizio `LICENSE_OWNER_TOKEN`: nessuna sessione del club lo apre, l'admin compreso.
- [x] `app_user` non ha GRANT di scrittura su `license`: il divieto è nel database, non solo nell'API.
- [x] Fascia d'avviso in italiano in testata (in scadenza / tolleranza / sola lettura).
- [x] Test: scadenza, tolleranza, sola lettura, rinnovo, sospensione, riattivazione, 401 senza token,
  401 con la sola sessione admin, `42501` sulla UPDATE diretta dal ruolo applicativo.
- **Done:** il proprietario sospende → l'admin legge tutto ma non scrive → il proprietario riattiva →
  la scrittura torna, con i dati intatti.

### M5d — Preparazione a PostgreSQL gestito (Supabase, solo database) [P0]
- [x] `DATABASE_URL` resta l'unico aggancio: nessun Supabase Auth, nessun `supabase-js`, nessuna
  dipendenza nuova. L'identità continua ad arrivare al database come `app.user_id`.
- [x] `pg` configurato per il **Transaction Pooler** (futuro deploy su Vercel): poche connessioni
  per istanza, `allowExitOnIdle` in serverless, `statement_timeout`, nessuna query preparata con
  nome, nessun `SET` fuori transazione, errori di connessione caduta non fatali.
- [x] TLS verificato per default con le CA di sistema; `DATABASE_CA_CERT` (PEM o percorso) per una
  CA propria, `DATABASE_SSL=no-verify` solo come eccezione annunciata a console.
- [x] Migrazioni separate dall'avvio dell'API: su Postgres gestito `npm run migrate` è un atto a
  parte, tutte le migrazioni in **una transazione** protetta da `pg_advisory_xact_lock`, così due
  istanze che partono insieme non si sovrappongono. L'API non si avvia con lo schema arretrato.
  `MIGRATION_DATABASE_URL` per usare la connessione diretta invece del pooler.
- [x] `0005_managed_postgres.sql`: `grant app_user to current_user` (su Supabase `postgres` non è
  superutente e senza questo `set local role app_user` darebbe `42501`), `execute` sulle funzioni
  usate dalle policy, revoca di ogni privilegio ad `anon` e `authenticated` sullo schema `public`.
  Idempotente, nessun dato toccato, nessun reset.
- [x] `npm run seed` rifiuta i dati dimostrativi con `NODE_ENV=production` o con `DATABASE_URL`
  impostata: serve `ALLOW_DEMO_SEED=true` dichiarato a mano.
- [x] `npm run db:verify`: prova sul database realmente configurato che il ruolo delle migrazioni
  possa assumere `app_user`, che `app.user_id` arrivi, che l'anonimo non legga `people`, che
  `sessions` e `license` rispondano `42501` al ruolo applicativo e che `anon`/`authenticated` non
  abbiano privilegi residui.
- [x] PGlite intatto per sviluppo e test (migrazioni automatiche, `db/data`, `db/e2e-data`);
  licenza e `LICENSE_OWNER_TOKEN` invariati.
- **Done:** il passaggio a Supabase è una questione di variabili d'ambiente più `npm run migrate`
  e `npm run db:verify`.

### M5e — Prova sul campo su Supabase reale [P0]
- [x] Migrazioni `0001`–`0006` applicate su Supabase reale (PostgreSQL 17.11) con `npm run migrate`.
- [x] Diagnosi del `permission denied to set role "app_user"`: la connessione applicativa
  (Transaction Pooler, 6543) e quella delle migrazioni (diretta, 5432) sono **lo stesso ruolo**
  `postgres`, non superutente, con `CREATEROLE`. `pg_auth_members` mostrava
  `member=postgres, grantor=supabase_admin, admin_option=t, inherit_option=f, set_option=f`:
  da PG16 la membership implicita al creatore del ruolo arriva con **SET FALSE**, quindi
  `pg_has_role(...,'MEMBER')` è vero (ed è per questo che `0005` saltava il GRANT) ma
  `set local role app_user` esce `42501`.
- [x] `0006_app_user_set_role.sql`: `grant app_user to <ruolo corrente> with inherit false, set true`.
  Privilegio minimo (solo la facoltà di assumere il ruolo, nessuna eredità passiva), idempotente,
  nessun superutente, nessun `GRANT` a `PUBLIC`, RLS e policy invariate.
- [x] `npm run db:verify` corretta: da PG16 verifica l'opzione `SET`, non la sola `MEMBER`
  (il vecchio controllo dava OK su un ruolo che poi non poteva assumere `app_user`).
- [x] `.env` letto dal server con il loader incluso in Node (nessuna dipendenza nuova); l'ambiente
  vince sul file. `DATABASE_CA_CERT` serve davvero: Supabase firma con una CA propria.
- [x] `npm run db:verify` su Supabase reale: 9 verifiche su 9 superate — `set local role app_user`,
  `app.user_id` propagato, anonimo che non legge `people`, `42501` su `sessions` e su `license`,
  nessun privilegio residuo per `anon`/`authenticated`.
- [x] `npm run check` e `npm test` (47 test su PGlite, con i casi di accesso negato) invariati.
- **Done:** l'applicazione parla con Supabase assumendo `app_user`; i permessi restano tutti in RLS.

### M5f — Deploy su Vercel (stessa origine, API serverless) [P0]
- [x] `api/index.mjs`: la stessa app Express servita da una funzione serverless; `initDb` una
  volta per cold start, corpo della richiesta già letto dal runtime gestito senza bloccare
  `express.json()`. Nessuna migrazione e nessun seed all'avvio (D17 invariato).
- [x] `vercel.json`: build `npm run build:vercel`, statico da `web/dist`, `/api/*` riscritto
  sulla funzione, fallback SPA sul resto, intestazioni di sicurezza (`nosniff`, `DENY`,
  `Referrer-Policy`, HSTS, `no-store` sulle risposte API). Stessa origine: nessun CORS.
- [x] `0007_app_runtime_role.sql`: ruolo di esecuzione `app_runtime`, `noinherit`, che può solo
  assumere `app_user` ed eseguire le query di sistema dell'autenticazione (sessioni, login,
  inviti, stato licenza). Nessun DDL, nessun privilegio su squadre/tesseramenti/certificati/quote.
  `LOGIN` e password si impostano a mano sul database: nel repository non entra nessun segreto.
- [x] CSRF: ogni scrittura che dichiara un'origine deve dichiarare la nostra, oltre al cookie
  `SameSite=Lax`. Le letture non sono toccate.
- [x] `0008_login_attempts.sql` + freno ai tentativi di accesso: dieci password sbagliate sulla
  stessa email (trenta per indirizzo) valgono quindici minuti di `429`. Tabella invisibile ai
  ruoli applicativi, scritta solo dal ruolo di sistema.
- [x] Cookie di sessione `Secure` per default in produzione, anche senza `COOKIE_SECURE`.
- [x] `DATABASE_CA_CERT` accetta il PEM inline o in base64: su Vercel è una variabile
  d'ambiente, non un percorso di file di una macchina.
- [x] `npm run check`, `npm test` (52 test, compresi CSRF e `429`), `npm run build:vercel`.
  Ingresso serverless provato davvero in locale: `health`, login con cookie `HttpOnly`, `/api/me`,
  lettura di `people`, `401` senza sessione, `403` da origine estranea.
- [ ] `npm run migrate` + `npm run db:verify` su Supabase con `0007`/`0008` e con
  `DATABASE_URL` sul ruolo `app_runtime` (richiede la password impostata a mano sul database).
- [ ] Deploy su Vercel e prova di fumo sul dominio reale.
- **Done quando:** il dominio serve l'interfaccia, `/api` risponde sulla stessa origine e
  `db:verify` dice `current_user=app_runtime`.

---

## FASE 2 — Impianti e pianificazione (NON iniziare senza richiesta esplicita)

### M6 — Piscine e spazi [P2]
- [ ] `facilities`, `spaces` (vasche/corsie) con fasce orarie assegnabili.
- [ ] Rilevazione sovrapposizioni incompatibili tra squadre/spazi/orari.
- [ ] Test permessi e conflitti reali.

### M7 — Calendario allenamenti ricorrenti [P2]
- [ ] `training_series`, `training_occurrences`, `training_exceptions`; ricorrenze settimanali valide per stagione.
- [ ] Modifica/annullamento di una singola occorrenza senza alterare le altre.
- [ ] Vista calendario per ruolo e squadra, integrata con l'occupazione spazi di M6.
- [ ] `Europe/Rome` e ora legale: l'orario locale dell'allenamento non si sposta.

### M8 — Disponibilità [P2, opzionale]
- [ ] Solo se esplicitamente approvato: `training_responses` con `Sì/No/Forse` per singolo allenamento.
- [ ] Mai presenze effettive, mai convocazioni.

---

## Schema dati (progressivo, non anticipare)
- Attuale (FASE 1): `people`, `app_users`, `user_roles`, `invites`, `sessions`, `guardian_links`,
  `seasons`, `teams`, `team_memberships`, `coach_assignments`, `registrations`, `medical_expiries`,
  `dues`, `payment_records`, `license`.
- FASE 2, da creare solo allora: `facilities`, `spaces`, `training_series`, `training_occurrences`,
  `training_exceptions`, `training_responses` (ultima solo se approvata).
- **Mai creare:** `attendance_records`, `match_callups`, `documents`, `document_files`, `posts`,
  `comments`, `conversations`, `analytics_reports`.

## Quality gates
- [x] Ogni slice è reale end-to-end dall'interfaccia al database e persiste dopo il riavvio.
- [x] `npm run check` (typecheck web + server + prove e2e), `npm test` e `npm run e2e` eseguiti,
  con casi di accesso negato sia sull'API sia nell'interfaccia.
- [x] Loading, vuoto, errore e feedback azione gestiti in tutte le pagine.
- [x] Dati dei minori e dei certificati minimizzati; permessi in RLS server-side; nessun segreto nel repo.
- [x] Nessuna funzionalità vietata introdotta.

## Decision log
- D1 — Una sola società, niente multi-tenant.
- D2 — Clubster è solo riferimento organizzativo; questa specifica prevale.
- D3 — Social, presenze, convocazioni, report, documenti: fuori scope in ogni fase.
- D4 — FASE 1 = amministrazione. D5 — FASE 2 = impianti + calendario. D6 — ROADMAP, poi AGENTS, poi codice.
- D7 — Migrazioni Postgres pure: PGlite in locale, `DATABASE_URL` in produzione.
- D8 — Auth propria (scrypt + cookie httpOnly) al posto di Supabase Auth, non verificabile offline.
- D9 — Permessi espressi una sola volta, come policy RLS; l'API non li duplica.
- D10 — Lo stato di quota e certificato è **derivato** dai dati (pagamenti, data odierna), non un campo editabile a mano.
- D12 — **La licenza è infrastruttura, non un ruolo applicativo.** Il proprietario del software non è un
  utente del club: si autentica con un token di servizio (`LICENSE_OWNER_TOKEN`, header `x-license-token`)
  su `/api/owner/license`, fuori dalla catena di sessione. `app_user` non ha GRANT di scrittura su
  `license`, quindi l'admin del club non può rinnovare né sospendere nemmeno aggirando l'API.
  Token non configurato = canale chiuso (`503`), mai aperto.
- D13 — **La scadenza toglie la scrittura, non i dati.** Oltre la tolleranza, o da sospesa, l'applicazione
  resta in sola lettura: tutte le `GET` rispondono, login e logout funzionano, niente viene cancellato,
  archiviato o nascosto. Il blocco è un middleware server-side: la fascia d'avviso nel frontend è solo
  informativa. Nessun gateway di pagamento, nessun abbonamento, nessun multi-tenant.
- D14 — **Rinnovo e riattivazione sono atti distinti.** `renew` sposta la scadenza, `reactivate` toglie la
  sospensione: rinnovare una licenza sospesa aggiorna le date ma non la riattiva da solo. Preavviso a
  30 giorni, come per i certificati; tolleranza predefinita 15 giorni, configurabile per licenza.
- D15 — **L'interfaccia si verifica cliccandola.** Playwright con Chromium è l'unica dipendenza di
  sviluppo aggiunta dopo l'impianto iniziale: senza un browser vero "typecheck pulito" non dice nulla
  su un form che non si invia. Le prove girano su un database dedicato (`db/e2e-data`) perché una
  verifica che sporca i dati di sviluppo non è ripetibile. Il canale del proprietario della licenza
  resta fuori dalla sessione: nelle prove si chiama con il token di servizio, non cliccando.
- D16 — **Supabase è solo il database.** Niente Supabase Auth, niente `supabase-js`, niente
  PostgREST: `anon` e `authenticated` restano senza privilegi sullo schema `public`. L'unica via
  ai dati è l'API Express con RLS, quindi D8 e D9 non cambiano di una riga.
- D17 — **Migrare non è avviare.** Su Postgres gestito le migrazioni sono un comando separato
  (`npm run migrate`, una transazione con lock consultivo, connessione diretta); l'API con lo
  schema arretrato si rifiuta di partire invece di migrare da sola. Su PGlite, processo singolo
  su file locale, l'automatismo resta perché non c'è nessuna corsa da arbitrare.
- D18 — **Su PostgreSQL 16+ essere membri non basta.** La membership ha opzioni separate
  (`INHERIT`/`SET`) e quella implicita del creatore arriva con `SET FALSE`: il ruolo delle
  migrazioni va abilitato con `GRANT ... WITH SET TRUE`, lasciando `INHERIT FALSE` perché assuma
  `app_user` solo quando lo dichiara. Mai alzare il problema disattivando la RLS o usando un
  superutente: il permesso concesso è il minimo che serve a `set local role`.
- D19 — **Chi serve le richieste non è chi le migra.** L'API gira con `app_runtime`: può
  assumere `app_user` e fare le sole query di sistema dell'autenticazione. Il ruolo proprietario
  resta alle migrazioni, su una connessione diversa e lanciata a mano. Una credenziale rubata
  all'applicazione non dà DDL, non bypassa la RLS e non tocca quote, squadre o certificati.
- D20 — **Vercel: stessa origine, una funzione sola.** Il frontend è statico, `/api/*` è
  riscritto su `api/index.mjs` che monta la stessa app Express. Niente CORS da allargare,
  cookie di prima parte, nessun secondo backend da tenere allineato. CSRF coperto da
  `SameSite=Lax` più il controllo d'origine sulle scritture; il freno sui tentativi di accesso
  sta nel database perché in serverless la memoria di un'istanza non vale nulla.
- D11 — Il seed è **cerca-o-crea**, non ricrea-da-zero. La stagione attiva già presente viene
  riusata (il vincolo `seasons_single_active_idx` ammette una sola riga `is_active`); persone e account
  si riconoscono da email o nome+data di nascita; gli stati amministrativi già modificati dalla segreteria
  non vengono sovrascritti. Tutto in un'unica transazione: un errore a metà non lascia dati parziali.

## Registro progressi
`2026-11-11 | M0–M5 | FASE 1 implementata: auth+inviti, persone/ruoli/tutori, stagioni/squadre/roster,
tesseramenti, scadenze certificati, quote e pagamenti manuali, dashboard per ruolo | npm run check (pulito),
npm test (30/30), npm run build (ok), prova manuale su API con riavvio del server e accessi negati per
coach/tutore/atleta/anonimo | prossimo: giro di verifica dell'interfaccia in browser, poi attendere
l'approvazione per la FASE 2 (M6) | nessun blocker`
`2026-11-11 | fix seed | `npm run seed` era monouso e falliva al secondo giro su un database già
popolato (`duplicate key value violates unique constraint "seasons_single_active_idx"`). Ora `seedDemo`
riusa la stagione attiva esistente e fa upsert su squadre, persone, account, ruoli, roster, tutori,
tesseramenti, certificati, quote e pagamenti; `seed.ts` esce con codice 1 e chiude il database in caso di
errore | npm run check (pulito), npm test (33/33, 3 nuovi test di idempotenza), npm run build (ok),
`npm run seed` eseguito tre volte di fila sul database su disco: nessun errore, conteggi tabella identici,
una sola stagione attiva, dati preesistenti (Marta Esposito e la sua quota) intatti, API verificata a server
avviato (401 anonimo, login admin, /api/auth/me, /api/seasons, /api/dashboard) | gli script npm non
contengono commenti inline: `npm run seed|check|test|build|migrate` girano puliti | prossimo: giro di
verifica dell'interfaccia in browser | nessun blocker`
`2026-11-11 | M5b | Licenza d'uso annuale: migrazione `0004_license.sql` (riga unica, RLS in sola lettura,
nessun GRANT di scrittura ad app_user), `server/src/license.ts` (stato derivato calcolato in SQL con
current_date, middleware di sola lettura, guardia del token proprietario), `server/src/routes/license.ts`
(`GET /api/license` per il club; `/api/owner/license` renew/suspend/reactivate per il proprietario),
fascia d'avviso italiana in testata, sezione README e `LICENSE_OWNER_TOKEN` in `.env.example` |
npm run check (pulito), npm test (47/47, 14 nuovi test di licenza), npm run build (ok), prova manuale
su server reale con database su disco: sospensione → GET /api/people 200 e POST 403 con messaggio
italiano, admin senza token respinto 401, riattivazione → POST 200, rinnovo a 5 giorni → avviso
"Licenza in scadenza tra 5 giorni" | prossimo: giro di verifica dell'interfaccia in browser |
nessun blocker`
`2026-11-11 | M5c | Giro di verifica dell'interfaccia in un browser vero: aggiunti `playwright.config.ts`
(due webServer, API su 3100 e Vite su 5174, database `db/e2e-data`), `e2e/01-admin.spec.ts`,
`e2e/02-permessi.spec.ts`, `e2e/03-licenza.spec.ts`, `e2e/helpers.ts`, `tsconfig.json` di radice per il
typecheck delle prove, script `npm run e2e`, voce README. Due difetti reali trovati solo in browser e
corretti nelle prove, non nel prodotto: il messaggio di login errato è "Email o password non corretti"
e l'etichetta "Nome" è ambigua accanto a "Cognome" | npm run e2e (12/12 su Chromium), npm run check
(pulito, ora include e2e), npm test (47/47), npm run build (ok) | nessun difetto dell'applicazione
emerso: login, anagrafiche, roster, quote con versamento parziale, menù a 360 px, accessi negati di
allenatore/atleta/tutore e sola lettura da licenza sospesa si comportano come specificato |
prossimo: FASE 2 (M6) solo su approvazione esplicita | nessun blocker`
`2026-11-12 | M5d | Preparazione a PostgreSQL gestito (Supabase, solo database): `server/src/db.ts`
riscritto (pool `pg` per Transaction Pooler, TLS verificato, migrazioni in una transazione con
`pg_advisory_xact_lock`, `pendingMigrations`), `migrate.ts` separato dall'avvio con
`MIGRATION_DATABASE_URL`, `index.ts` che non parte con schema arretrato, `seed.ts` che rifiuta la
produzione, nuovo `0005_managed_postgres.sql` (GRANT `app_user` a chi migra, EXECUTE sulle funzioni
delle policy, revoca totale ad `anon`/`authenticated`), nuovo `npm run db:verify`, `.env.example` e
README aggiornati | npm run check (pulito), npm test (47/47), npm run e2e (12/12 su Chromium),
`npm run migrate` su database vergine (0001→0005 applicate in ordine), `npm run db:verify` su
database popolato (7 persone in tabella, 0 visibili all'anonimo, `42501` su `sessions` e su
`license`), `NODE_ENV=production npm run seed` respinto | prossimo: impostare `DATABASE_URL` e
`MIGRATION_DATABASE_URL` di Supabase nell'ambiente, poi `npm run migrate` e `npm run db:verify`
sul progetto reale | BLOCKER: nessuna `DATABASE_URL` disponibile qui, la verifica su Supabase
reale resta da eseguire`
