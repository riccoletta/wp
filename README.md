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
| `npm run check` | Typecheck di server e frontend |
| `npm test` | Test dell'API, compresi i casi di accesso negato |
| `npm run migrate` | Applica le migrazioni mancanti |
| `npm run seed` | Inserisce i dati sintetici |
| `npm run build` | Build di produzione del frontend in `web/dist` |

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
Non serve Docker e i dati restano fra un riavvio e l'altro.

Per un Postgres vero (Supabase o altro) basta valorizzare `DATABASE_URL`: le migrazioni sono
SQL standard e girano identiche. Il ruolo `app_user` viene creato dalla prima migrazione.

```bash
DATABASE_URL=postgres://utente:password@host:5432/db npm run migrate
DATABASE_URL=... PORT=3000 npm run start --workspace=server
```

In produzione servire `web/dist` da un web server e inoltrare `/api` al processo Node,
con `COOKIE_SECURE=true` perché il cookie di sessione viaggi solo su HTTPS.

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
