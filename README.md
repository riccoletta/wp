# Gestionale Società di Pallanuoto

Gestionale web privato per **una sola società di pallanuoto**. In italiano, mobile-first.
La FASE 1 copre l'amministrazione: anagrafiche, ruoli, stagioni e squadre, tesseramenti,
scadenze dei certificati medici e quote con pagamenti registrati a mano.

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
                      • club-invite    (inviti, solo segreteria)
                      • license-owner  (licenza, solo proprietario)
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
| `npm run admin:bootstrap` | collega il primo amministratore alla sua identità Supabase |
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
```

Il comando crea `people` + `app_users` + `user_roles('admin')` in una transazione sola e
si rifiuta di creare un secondo amministratore (salvo `--aggiungi` dichiarato a mano).
Gli accessi successivi si creano per invito, dalla segreteria.

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
l'identità arrivi da `auth.uid()`, che `sessions`, `login_attempts`, `invites` e
`password_hash` siano irraggiungibili dalla Data API, che la licenza non sia scrivibile
dal club, che i ruoli non siano assegnabili da sé e che `anon` non abbia privilegi.

### Che cosa è esposto dalla Data API

| Esposto in lettura (sotto RLS) | Esposto in scrittura (solo admin, solo con licenza operativa) | Mai esposto |
| --- | --- | --- |
| `people`, `guardian_links`, `seasons`, `teams`, `team_memberships`, `coach_assignments`, `registrations`, `medical_expiries`, `dues`, `payment_records`, `dues_status`, `license`, `user_roles`, e di `app_users` le sole colonne non sensibili | tutte le tabelle del club, tramite le policy `*_ins` / `*_upd` / `*_del` | `sessions`, `login_attempts`, `invites`, `app_users.password_hash`, scrittura su `license` e su `user_roles` |

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

## Licenza d'uso annuale

La licenza è una riga sola nella tabella `license`: scadenza, giorni di tolleranza e stato
(`attiva` / `sospesa`). Lo stato operativo è **derivato**, mai scritto a mano:

| Situazione | Accesso |
| --- | --- |
| In corso di validità | completo |
| Entro 30 giorni dalla scadenza | completo, con avviso in testata |
| Scaduta, entro la tolleranza | completo, con avviso in testata |
| Tolleranza finita, oppure sospesa | **sola lettura**: si consulta tutto, non si scrive nulla |

**Il blocco è nel database, non nel browser.** Le policy di scrittura chiamano
`app_can_write()`, che è `admin` *e* licenza operativa: un utente autenticato che chiama
la REST API di Supabase a mano incontra lo stesso muro dell'interfaccia, con lo stesso
messaggio italiano. Le letture non sono toccate: i dati restano consultabili ed
estraibili. **Nessun dato viene mai cancellato alla scadenza.**

Rinnovo, sospensione e riattivazione sono riservati al **proprietario del software** e non
passano da un account del club: `license` non ha GRANT di scrittura per `authenticated`,
quindi nemmeno l'admin può toccarla. Il canale è la Edge Function `license-owner`,
autenticata dal token di servizio `LICENSE_OWNER_TOKEN` (header `x-license-token`) tenuto
nei segreti di Supabase; se la variabile è vuota il canale è chiuso.

```bash
FN=https://<project-ref>.supabase.co/functions/v1/license-owner
curl -s $FN -H "x-license-token: $LICENSE_OWNER_TOKEN" \
  -H 'content-type: application/json' -d '{"action":"state"}'
curl -s $FN -H "x-license-token: $LICENSE_OWNER_TOKEN" \
  -H 'content-type: application/json' -d '{"action":"renew","expiresOn":"2027-11-11","graceDays":15}'
curl -s $FN -H "x-license-token: $LICENSE_OWNER_TOKEN" \
  -H 'content-type: application/json' -d '{"action":"suspend","note":"mancato pagamento"}'
curl -s $FN -H "x-license-token: $LICENSE_OWNER_TOKEN" \
  -H 'content-type: application/json' -d '{"action":"reactivate"}'
```

Rinnovo e riattivazione restano atti distinti: `renew` sposta la scadenza, `reactivate`
toglie la sospensione.

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
