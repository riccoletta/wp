# AGENTS.md — CAVEMAN MODE

## Missione
**MAX DELIVERY / MIN TOKEN.** Costruisci un gestionale pallanuoto per **una sola società**: prima amministrazione e squadre; solo in **FASE 2** piscine/spazi e calendario allenamenti ricorrenti. Prodotto NON social. Sicurezza e correttezza non si sacrificano.

## Ordine obbligatorio al primo avvio
1. **STEP 1:** creare/aggiornare `ROADMAP.md` prima di codice applicativo.
2. **STEP 2:** creare/aggiornare `AGENTS.md` prima di codice applicativo.
3. **STEP 3:** implementare subito la prima checkbox P0 con flusso end-to-end.
4. Alle sessioni successive: leggere `AGENTS.md`, la sola milestone attiva e `git status`; riprendere il prossimo task non verificato.

## Protocollo CAVEMAN
- **DO > DISCUSS:** implementa, non riscrivere lunghi piani.
- **ONE SLICE:** una funzionalità completa UI → auth → DB → UI per volta.
- **SMALL CONTEXT:** usa `rg`, `git diff`, file mirati; non stampare repo e log interi.
- **SMALL DIFF:** tocca solo i file necessari; riusa componenti e convenzioni.
- **SIMPLE STACK:** mantieni lo stack; niente microservizi, multi-tenant, astrazioni premature.
- **REAL FLOWS:** persistenza verificata; niente bottoni finti, mock mascherati da backend o successi inventati.
- **FAST CHECKS:** build/typecheck, test mirati, almeno un test di accesso negato.
- **NO DOC SPRAWL:** soltanto ROADMAP, AGENTS, README essenziale, migrazioni e test utili.
- **NO RE-READ:** non rileggere file immutati senza motivo; sfrutta diff e contesto.
- **ASSUME & LOG:** scegli default ragionevoli e annotali; chiedi solo su veri blocchi.
- **MARK VERIFIED:** `[x]` solo dopo prove effettive; annota la prossima checkbox.
- **SMALL REPORT:** risposta finale max quattro righe (`DONE`, `TEST`, `NEXT`, `BLOCKER` se serve).

## Scope rigido
- **FASE 1:** persone/anagrafiche, ruoli, squadre/stagioni, tutori, tesseramenti, scadenze certificati **senza file**, quote e pagamenti manuali, dashboard di stato.
- **FASE 2 e non prima:** gestione piscine/vasche/corsie/spazi e calendario allenamenti **ricorrenti**, con conflitti ed eccezioni. Disponibilità `Sì/No/Forse` solo se successivamente approvate.
- **VIETATO in tutte le fasi:** registro presenze, convocazioni, report e statistiche, repository documenti/regolamenti, upload di certificati, feed/post/commenti/like/chat/DM e altre funzioni social.
- Dashboard con contatori di scadenze e insoluti ≠ modulo di reportistica.
- Non costruire tabelle, schermate o API di FASE 2 durante FASE 1.

## Sicurezza obbligatoria
- Auth, controllo server-side, RLS sui dati personali e amministrativi.
- Coach vede solo squadre assegnate; atleta i propri dati; tutore solo minori collegati.
- Permettere anagrafica atleti senza account; gli inviti sono separati dalla registrazione amministrativa.
- Certificati: solo metadati di validità/scadenza, niente diagnosi né file.
- Nessun segreto/dato reale in codice, test o seed. Date e orari `Europe/Rome`.
- Non copiare interfaccia, codice, asset, logo o marchio Clubster.

## Done contract
`DONE: <slice davvero completata>`
`TEST: <comandi/esiti effettivi>`
`NEXT: <prossima checkbox>`
`BLOCKER: <solo se presente>`
