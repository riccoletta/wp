# AGENTS.md — CAVEMAN MODE

## Missione
**MAX DELIVERY / MIN TOKEN.** Gestionale pallanuoto per **una sola società**. FASE 1 = amministrazione
(persone, ruoli, stagioni/squadre, tesseramenti, scadenze certificati, quote). FASE 2 solo su richiesta
esplicita = piscine/spazi + calendario allenamenti ricorrenti. Prodotto NON social.
Sicurezza e correttezza non si sacrificano mai per brevità.

## Avvio di ogni sessione
1. Leggi **solo** `AGENTS.md`, la milestone attiva di `ROADMAP.md`, `git status`.
2. Riprendi dalla prima checkbox `[ ]` non verificata. Non rileggere il resto del repo.
3. Le specifiche originali (`*_PALLANUOTO.md`) sono di sola lettura: non modificarle.

## Protocollo CAVEMAN
- **DO > DISCUSS:** implementa, non riscrivere piani già scritti.
- **ONE SLICE:** una funzionalità completa UI → auth → DB → UI per volta.
- **SMALL CONTEXT:** `rg`, `git diff`, file mirati. Mai dump di repo, log o `node_modules`.
- **SMALL DIFF:** tocca solo i file necessari; riusa componenti e convenzioni esistenti.
- **SIMPLE STACK:** niente microservizi, multi-tenant, astrazioni premature, dipendenze nuove senza motivo.
- **REAL FLOWS:** persistenza verificata. Niente bottoni finti, mock spacciati per backend, successi inventati.
- **FAST CHECKS:** `npm run check` + `npm test`, sempre con almeno un caso di accesso negato.
- **NO DOC SPRAWL:** solo ROADMAP, AGENTS, README, migrazioni e test utili.
- **ASSUME & LOG:** scegli default ragionevoli e annotali nel decision log; chiedi solo su blocchi veri.
- **MARK VERIFIED:** `[x]` solo dopo prove effettive, e aggiorna il registro progressi.
- **SMALL REPORT:** risposta finale max quattro righe (`DONE`, `TEST`, `NEXT`, `BLOCKER` se serve).

## Architettura (non cambiarla senza motivo)
- `web/` React+TS+Vite+Tailwind · `server/` Express+TS · `db/migrations/` SQL Postgres puro numerato.
- DB: PGlite in locale (file `db/data/`), qualsiasi Postgres via `DATABASE_URL` in produzione. Stesso SQL.
- Auth: email+password `scrypt`, sessione in cookie httpOnly, inviti a token.
- **I permessi vivono solo nelle policy RLS.** Ogni richiesta gira in una transazione con
  `SET LOCAL ROLE app_user` + `SET LOCAL app.user_id`. Non duplicare i filtri di ruolo nel codice API:
  se un dato non deve essere visibile, deve essere la policy a nasconderlo.
- Stato di quote e certificati: **derivato**, mai campo editabile a mano.

## Scope rigido
- **FASE 1 (ora):** anagrafiche, ruoli, inviti, tutori, stagioni/squadre/roster, tesseramenti,
  scadenze certificati **senza file**, quote e pagamenti manuali, dashboard di contatori operativi.
- **FASE 2 (mai prima dell'approvazione):** impianti/vasche/corsie, calendario ricorrente con conflitti
  ed eccezioni, `Europe/Rome` e ora legale. Disponibilità `Sì/No/Forse` solo se approvate a parte.
- **VIETATO in ogni fase:** registro presenze, convocazioni, report/statistiche/export, archivio
  documenti o regolamenti, upload di certificati, feed/post/commenti/like/chat/DM, multi-club,
  gateway di pagamento.
- Contatori di scadenze e insoluti in dashboard ≠ modulo di reportistica. Nessuna tabella o schermata
  di FASE 2 durante la FASE 1.

## Sicurezza obbligatoria
- Coach: solo le squadre assegnate. Atleta: solo i propri dati. Tutore: solo i minori collegati.
  Admin/segreteria: tutto. Verifica ogni nuova tabella con un test di accesso negato.
- Anagrafica atleta possibile **senza** account; l'invito è un atto separato.
- Certificati: solo tipo/scadenza/stato. Mai diagnosi, referti, file.
- Nessun segreto o dato personale reale in codice, test o seed. Orari `Europe/Rome`.
- Non copiare interfaccia, codice, asset, logo o marchio Clubster.

## Done contract
Una slice è completa solo se: (1) funziona UI → auth → DB → UI e persiste dopo reload;
(2) typecheck/build passano; (3) i test mirati includono un accesso vietato; (4) loading/vuoto/errore
sono gestiti; (5) la checkbox in `ROADMAP.md` è marcata `[x]` **solo allora**.

`DONE: <slice davvero completata>`
`TEST: <comandi ed esiti effettivi>`
`NEXT: <prossima checkbox>`
`BLOCKER: <solo se presente>`
