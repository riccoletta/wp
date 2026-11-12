# Gestionale Società di Pallanuoto

Gestionale web privato per **una sola società di pallanuoto**. In italiano, mobile-first.
La FASE 1 copre l'amministrazione: anagrafiche, ruoli, stagioni e squadre, tesseramenti,
scadenze dei certificati medici e quote con pagamenti registrati a mano.

Le specifiche sono in `MASTER_PROMPT_PALLANUOTO.md`; lo stato dei lavori in `ROADMAP.md`;
le regole per chi ci lavora in `AGENTS.md`.

## Avvio rapido

```bash
npm install
cp .env.example .env
npm run seed     # crea il database locale con dati sintetici
npm run dev      # API su :3000, interfaccia su :5173
```

Apri http://localhost:5173 ed entra con uno degli account di esempio:

| Email | Password | Ruolo |
| --- | --- | --- |
| segreteria@example.test | password123 | Segreteria (vede e modifica tutto) |
| coach.a@example.test | password123 | Allenatore (solo la propria squadra) |
| atleta@example.test | password123 | Atleta adulto (solo i propri dati) |
| tutore@example.test | password123 | Tutore (solo il minore collegato) |

Sono dati inventati a scopo di prova: non usarli in produzione.

## Comandi

| Comando | Effetto |
| --- | --- |
| `npm run dev` | API e interfaccia in sviluppo |
| `npm run check` | Typecheck di server, frontend e prove di interfaccia |
| `npm test` | Test dell'API, compresi i casi di accesso negato |
| `npm run e2e` | Prove in un browser vero sull'interfaccia (Playwright) |
| `npm run migrate` | Applica le migrazioni mancanti |
| `npm run seed` | Inserisce i dati sintetici (rifiutato in produzione) |
| `npm run db:verify` | Prova ruolo `app_user`, `app.user_id`, RLS e licenza sul database configurato |
| `npm run build` | Build di produzione del frontend in `web/dist` |
| `npm run build:vercel` | Build di deploy: frontend in `web/dist` + API compilata in `server/dist` |

## Prove di interfaccia

`npm run e2e` apre un browser vero e clicca le pagine: login, creazione anagrafica, roster,
quota con versamento parziale, menù a 360 px, accessi negati di allenatore, atleta e tutore,
licenza sospesa e riattivata. Gira su un database PGlite dedicato (`db/e2e-data`), ricreato e
popolato a ogni esecuzione: i dati di sviluppo in `db/data` non vengono toccati.
La prima volta serve scaricare il browser: `npx playwright install chromium`.

## Com'è fatto

- `web/` — React, TypeScript, Vite, Tailwind.
- `server/` — Express e TypeScript. Espone solo `/api`.
- `db/migrations/` — SQL PostgreSQL puro, numerato e applicato in ordine.

**I permessi stanno nel database, non nell'interfaccia.** Ogni richiesta apre una transazione
con `SET LOCAL ROLE app_user` e l'identità dell'utente in `app.user_id`: da lì in poi sono le
policy di Row Level Security a decidere cosa si vede e cosa si può scrivere. Nascondere un
pulsante nel frontend non protegge nulla, e infatti i test provano gli accessi vietati
chiamando direttamente l'API.

## Database

Senza `DATABASE_URL` l'applicazione usa **PGlite**: PostgreSQL embedded, salvato in `db/data/`.
Non serve Docker, i dati restano fra un riavvio e l'altro e le migrazioni mancanti si applicano
da sole all'avvio. È la modalità di sviluppo e dei test.

Con `DATABASE_URL` si usa un Postgres vero: stesso SQL, stesse policy. Le migrazioni **non**
partono più da sole, per non farle correre a due istanze insieme; l'API si rifiuta di avviarsi
con uno schema arretrato e dice quale migrazione manca.

```bash
npm run migrate      # applica le migrazioni mancanti, in una sola transazione con lock
npm run db:verify    # verifica ruolo, identità, RLS e divieto di scrittura sulla licenza
npm run start --workspace=server
```

### Supabase (solo database)

Supabase è usato **esclusivamente come PostgreSQL gestito**: niente Supabase Auth, niente
`supabase-js`. L'unica strada verso i dati resta l'API Express con `SET LOCAL ROLE app_user`
e `app.user_id`.

1. **Stringhe di connessione** (Dashboard → Project Settings → Database). Vanno messe nelle
   variabili d'ambiente dell'hosting (su Vercel: Project Settings → Environment Variables),
   mai nel repository e mai in chat.
   - `DATABASE_URL` → **Transaction Pooler**, porta `6543`: è quella giusta per Vercel e per
     qualsiasi ambiente serverless, perché regge molte istanze con poche connessioni.
   - `MIGRATION_DATABASE_URL` → **connessione diretta**, porta `5432`: le migrazioni fanno DDL
     e vogliono una sessione stabile.
2. `npm run migrate` una volta, da una macchina fidata o da un passo di deploy dedicato.
   Applica solo le migrazioni mancanti: non azzera e non ricrea nulla.
3. `npm run db:verify` per la prova sul campo: il ruolo delle migrazioni può assumere
   `app_user`, l'identità arriva al database, un utente anonimo non legge `people`, `sessions`
   e `license` rispondono `42501` al ruolo applicativo, `anon`/`authenticated` non hanno privilegi.
4. `COOKIE_SECURE=true` e `WEB_ORIGIN` sull'origine reale del frontend.

La migrazione `0005_managed_postgres.sql` sistema quello che su un Postgres gestito non è
automatico: su Supabase `postgres` non è superutente, quindi gli serve un `GRANT app_user`
esplicito per poter eseguire `SET LOCAL ROLE app_user`; `app_user` riceve l'`EXECUTE` sulle
funzioni chiamate dalle policy; i ruoli `anon` e `authenticated` — quelli che Supabase espone
via PostgREST — perdono ogni privilegio sullo schema `public`, perché qui non li usiamo.
È bene disattivare comunque la Data API del progetto Supabase.

Il pool di `pg` è configurato per il pooler in modalità transazione: nessuna query preparata
con nome, nessun `SET` fuori da una transazione, poche connessioni per istanza e TLS verificato
con le CA di sistema (`DATABASE_CA_CERT` solo se serve una CA propria).

**Dati dimostrativi.** `npm run seed` si ferma da solo con `NODE_ENV=production` o con
`DATABASE_URL` impostata: per un ambiente di prova va sbloccato a mano con `ALLOW_DEMO_SEED=true`.
Un database di produzione parte vuoto, con il primo admin creato a mano.

In produzione servire `web/dist` da un web server e inoltrare `/api` al processo Node,
con `COOKIE_SECURE=true` perché il cookie di sessione viaggi solo su HTTPS.

### Ruolo di esecuzione a privilegio minimo

L'API **non** deve collegarsi con il ruolo delle migrazioni (`postgres`: proprietario dello
schema, esente dalla RLS, capace di DDL). La migrazione `0007` crea `app_runtime`, che sa fare
due sole cose: assumere `app_user` (da lì passa tutto il traffico, sotto RLS) ed eseguire le
poche query di sistema dell'autenticazione — sessioni, login, inviti, stato licenza. Niente DDL,
nessun privilegio su squadre, tesseramenti, certificati o quote.

`LOGIN` e password non stanno nel repository: si impostano una volta sul database, con una
password lunga e casuale generata da te (Supabase → SQL Editor):

```sql
alter role app_runtime with login password '<password-lunga-e-casuale>';
```

Poi `DATABASE_URL` punta a quel ruolo. Sul Transaction Pooler di Supabase l'utente si scrive
`<ruolo>.<project-ref>`, quindi `app_runtime.<project-ref>` al posto di `postgres.<project-ref>`.
`MIGRATION_DATABASE_URL` resta sul ruolo proprietario: migrare è un atto separato (D17).
`npm run db:verify` dirà `current_user=app_runtime`.

## Deploy su Vercel

Monorepo invariato: il frontend è un sito statico, l'API una sola funzione serverless
(`api/index.mjs`) che monta la stessa app Express. Stessa origine, quindi `/api` non attraversa
nessun CORS e il cookie di sessione resta `SameSite=Lax` di prima parte.

1. **Prima del primo deploy**, da una macchina fidata: `npm run migrate` e `npm run db:verify`
   sul database Supabase. Il deploy non migra e non semina mai nulla.
2. Importa il repository su Vercel. `vercel.json` è già nel repo: build `npm run build:vercel`,
   output `web/dist`, riscrittura di `/api/*` sulla funzione e fallback SPA sul resto.
3. Variabili d'ambiente del progetto (Production, e Preview se lo usi):

   | Variabile | Valore |
   | --- | --- |
   | `DATABASE_URL` | Transaction Pooler, porta 6543, utente `app_runtime.<project-ref>` |
   | `DATABASE_CA_CERT` | contenuto del certificato CA di Supabase, incollato per intero (PEM) |
   | `COOKIE_SECURE` | `true` |
   | `LICENSE_OWNER_TOKEN` | token di servizio del proprietario (solo se vuoi il canale licenza) |
   | `NODE_ENV` | `production` (impostata da Vercel) |

   `MIGRATION_DATABASE_URL`, `PGLITE_DIR`, `WEB_ORIGIN` e `ALLOW_DEMO_SEED` **non** vanno su
   Vercel: migrazioni e seed si lanciano a mano, l'origine è la stessa del sito.
   `DATABASE_CA_CERT` accetta il PEM inline (anche con `\n` letterali o in base64): nessun
   percorso di file, che su Vercel non esisterebbe.
4. Deploy. Prova di fumo: `https://<dominio>/api/health` risponde `{"ok":true}`, il login
   funziona e `https://<dominio>/api/people` senza sessione risponde `401`.

Cosa resta valido in produzione: i permessi sono solo policy RLS, il cookie è `httpOnly` e
`Secure`, le scritture da un'origine estranea sono respinte con `403` (oltre a `SameSite=Lax`),
dieci password sbagliate sulla stessa email valgono quindici minuti di `429`, e la licenza
scaduta toglie la scrittura senza toccare i dati.

## Dati personali

Il gestionale tiene il minimo indispensabile. Dei certificati medici registra **soltanto**
tipologia facoltativa, data di scadenza e stato: nessun file, nessun referto, nessuna
informazione clinica. I minori sono visibili solo alla segreteria, ai tutori collegati e
all'allenatore della loro squadra. Questa è minimizzazione dei dati, non una dichiarazione
di conformità GDPR: quella richiede una verifica legale.

## Licenza d'uso annuale

La licenza è una riga sola nella tabella `license`: scadenza, giorni di tolleranza e stato
(`attiva` / `sospesa`). Lo stato operativo è **derivato**, mai scritto a mano:

| Situazione | Accesso |
| --- | --- |
| In corso di validità | completo |
| Entro 30 giorni dalla scadenza | completo, con avviso in testata |
| Scaduta, entro la tolleranza | completo, con avviso in testata |
| Tolleranza finita, oppure sospesa | **sola lettura**: si consulta tutto, non si scrive nulla |

In sola lettura il server respinge ogni `POST/PUT/PATCH/DELETE` sotto `/api` con `403` e un
messaggio in italiano; `GET` e login restano attivi, così i dati restano consultabili ed
estraibili. **Nessun dato viene mai cancellato alla scadenza.**

Rinnovo, sospensione e riattivazione sono riservati al **proprietario del software** e non
passano da un account del club: la tabella non ha GRANT di scrittura per `app_user`, quindi
nemmeno l'admin può toccarla dal database. Il canale è `/api/owner/license`, autenticato dal
token di servizio `LICENSE_OWNER_TOKEN` (header `x-license-token`); se la variabile è vuota il
canale è chiuso.

```bash
curl -s localhost:3000/api/owner/license -H "x-license-token: $LICENSE_OWNER_TOKEN"
curl -s localhost:3000/api/owner/license/renew -H "x-license-token: $LICENSE_OWNER_TOKEN" \
  -H 'content-type: application/json' -d '{"expiresOn":"2027-11-11","graceDays":15}'
curl -s localhost:3000/api/owner/license/suspend -H "x-license-token: $LICENSE_OWNER_TOKEN" \
  -H 'content-type: application/json' -d '{"note":"mancato pagamento"}'
curl -s localhost:3000/api/owner/license/reactivate -H "x-license-token: $LICENSE_OWNER_TOKEN" \
  -H 'content-type: application/json' -d '{}'
```

## Fuori perimetro

Per scelta esplicita non esistono e non verranno aggiunti: registro presenze, convocazioni,
report e statistiche, archivio documenti, upload di certificati, funzioni social
(feed, post, commenti, chat) e pagamenti online.

Piscine, spazi e calendario degli allenamenti ricorrenti sono la **FASE 2**: pianificata in
`ROADMAP.md`, non ancora iniziata.
