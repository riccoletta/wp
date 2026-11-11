# ROADMAP — GESTIONALE SOCIETÀ DI PALLANUOTO

> Documento operativo iniziale. Al primo avvio, il coding agent deve **creare/aggiornare `ROADMAP.md` come STEP 1**, adattandolo al repository prima di qualunque codice applicativo. `[x]` significa completato **e verificato**.

## Obiettivo
Un gestionale web privato, mobile-first e in italiano, per **una sola società di pallanuoto**. La **FASE 1** serve alla segreteria per gestire anagrafiche, squadre, stagioni, tesseramenti, certificati in scadenza e quote. La **FASE 2** aggiunge **piscine/spazi e calendario degli allenamenti ricorrenti**, con eventuali risposte di disponibilità legate agli allenamenti.

## Esclusioni definitive (non pianificare)
- Social: feed, post, like, commenti, community, chat e messaggistica privata.
- **Registro delle presenze effettive** e statistiche sulle presenze.
- **Convocazioni** (allenamenti o partite), risposte a convocazioni e relative liste.
- **Report e statistiche**, analytics sportive, classifiche, export di report.
- **Gestione documenti e regolamenti**: repository documentale, upload di file, moduli e liberatorie da archiviare.
- SaaS multi-società, app native, gateway di pagamento nel primo rilascio.

Le **scadenze dei certificati** restano in scope come soli dati amministrativi (tipo se utile, data, stato); **nessun upload del certificato**. Le disponibilità `Sì/No/Forse` NON sono presenze né convocazioni; sono un'opzione da valutare esclusivamente in FASE 2 quando esistono allenamenti in calendario.

## Utenti e permessi
- **Admin/segreteria:** può creare e gestire atleti/soci, staff, squadre, stagioni, tesseramenti, scadenze e quote.
- **Allenatore:** accede all'elenco delle sole squadre assegnate e ai dati strettamente necessari; nella FASE 2 può operare sugli allenamenti assegnati.
- **Atleta adulto:** visualizza solo le proprie informazioni amministrative; in FASE 2 eventuale calendario personale.
- **Genitore/tutore:** vede solo i minori esplicitamente associati; supporta più figli.
- Una persona può avere più ruoli. Un atleta può cambiare squadra da una stagione all'altra senza perdere lo storico.
- La segreteria può inserire un atleta anche **senza creare immediatamente un account**. Gli accessi applicativi sono su invito.

## Decisioni tecniche iniziali
- Se il repository è vuoto: React, TypeScript, Vite, Tailwind e UI accessibile; Supabase Auth + PostgreSQL con RLS. Se esiste uno stack funzionante, riutilizzarlo.
- Un solo club; web app responsive (mobile 360 px e desktop); UI italiana; date `Europe/Rome`.
- Migrazioni versionate, `.env.example`, dati sintetici. Non creare tabelle di moduli successivi in anticipo.
- Navigation FASE 1: `Dashboard`, `Persone`, `Squadre`, `Tesseramenti`, `Scadenze`, `Quote`, `Profilo`. Mostrare solo sezioni autorizzate.
- FASE 2: aggiungere `Piscine e spazi` e `Calendario` solo quando la FASE 1 è stabilizzata.

## FASE 1 — Gestionale essenziale

### M0 — Fondamenta [P0]
- [ ] Ispezionare repository e preservare codice esistente.
- [ ] **STEP 1:** creare/aggiornare `ROADMAP.md`.
- [ ] **STEP 2:** creare/aggiornare `AGENTS.md` in modalità CAVEMAN.
- [ ] Configurare app, routing, layout, `.env.example` e README breve.
- [ ] Configurare Supabase Auth, migrazioni e policy RLS testabili.
- [ ] Verificare build/typecheck, login, route protette e almeno un accesso negato.
- **Done:** UI avviabile, database persistente, accesso e separazione dei ruoli verificati.

### M1 — Persone, ruoli e squadre [P0]
- [ ] Segreteria crea/modifica/archivia atleta/socio e staff (senza richiedere login all'atleta).
- [ ] Invito e login soltanto per utenti che necessitano accesso; ruoli multipli.
- [ ] Stagioni sportive; squadre/categorie e roster assegnati per stagione.
- [ ] Associare allenatori alle squadre e tutori ai minori.
- [ ] Ricerca e filtri utili; stati vuoto/loading/errore e validazione.
- [ ] Test RLS: coach squadra A non legge B; tutore non vede minori altrui.
- **Done:** segreteria crea atleta → lo assegna alla squadra nella stagione → ricarica → dati corretti; accessi non autorizzati respinti.

### M2 — Tesseramenti [P1]
- [ ] Stato di tesseramento per atleta e stagione (es. da completare/in corso/attivo/scaduto).
- [ ] Date e note amministrative essenziali, senza archiviazione documenti.
- [ ] Filtri per scadenza/stato; aggiornamenti permessi solo a segreteria.
- [ ] Test di persistenza, validazione e privacy.
- **Done:** segreteria aggiorna lo stato tesseramento e lo ritrova dopo refresh.

### M3 — Certificati e scadenze [P1]
- [ ] Registrare solo tipologia se utile, scadenza, stato e ultimo aggiornamento.
- [ ] Evidenziare certificati in scadenza/scaduti in dashboard, senza dati clinici.
- [ ] Accesso per segreteria, atleta e tutore limitato ai record autorizzati.
- [ ] Eventuali promemoria operativi interni soltanto se reali e utili.
- **Done:** una scadenza salvata compare correttamente nella lista e in dashboard, con permessi verificati.

### M4 — Quote e pagamenti manuali [P1]
- [ ] Quota per stagione e persona: importo, dovuto, scadenza e stato.
- [ ] Segreteria registra pagamenti manualmente (totali/parziali se necessario) e vede insoluti.
- [ ] Atleta/tutore consulta solo la propria posizione; niente carta di credito o checkout.
- [ ] Test su importi, stato, operazioni consentite/vietate e ricaricamento.
- **Done:** segreteria crea una quota → registra pagamento → stato aggiornato e persistente.

### M5 — Rifinitura MVP e rilascio [P1]
- [ ] Dashboard amministrativa con **conteggi operativi** (es. certificati prossimi a scadenza, quote insolute), non un modulo di report/statistiche.
- [ ] Navigazione e permessi coerenti, responsive, accessibilità base, messaggi d'errore.
- [ ] Test E2E dei flussi M1–M4 e test di accesso negato.
- [ ] Migrazioni e istruzioni per deploy; nessun dato demo spacciato per reale.
- **Done:** segreteria usa tutto il ciclo persone → squadre → tesseramento → certificato → quota.

## FASE 2 — Impianti e pianificazione (DOPO il rilascio della FASE 1)

### M6 — Piscine e spazi [P2]
- [ ] Gestire piscine/impianti e vasche o corsie/spazi assegnabili, con disponibilità orarie.
- [ ] Associare capienza o vincoli solo se necessari; evitare motore prenotazioni generico.
- [ ] Verificare conflitti di occupazione tra squadre/spazi/orari.
- [ ] Test dei permessi e delle sovrapposizioni reali.
- **Done:** segreteria assegna uno spazio e il sistema segnala una sovrapposizione incompatibile.

### M7 — Calendario allenamenti ricorrenti [P2]
- [ ] Impostare allenamenti per squadra, allenatore, piscina/spazio, giorni e fascia oraria.
- [ ] Definire validità delle ricorrenze per stagione, eccezioni, annullamento e modifica singola occorrenza.
- [ ] Vista calendario per ruolo e squadra; integrazione con occupazione spazi M6.
- [ ] Gestire fuso `Europe/Rome` e cambi ora legale senza spostare l'ora locale.
- [ ] Verificare creazione, modifica, refresh e conflitti sul calendario.
- **Done:** segreteria crea un allenamento settimanale → calendario mostra le occorrenze → un'eccezione modifica solo una data → nessun conflitto di spazio.

### M8 — Disponibilità agli allenamenti [P2, opzionale]
- [ ] Decidere se servono risposte `Sì / No / Forse` agli allenamenti programmati.
- [ ] Se approvato: atleta/tutore risponde; coach vede risposte e non rispondenti.
- [ ] **Non trasformare la disponibilità in registro presenze o convocazioni.**
- **Done:** solo se la funzione è approvata; risposte persistenti e visibili per ruolo.

## Schema dati progressivo, non anticipare
- M0–M1: `profiles` (eventuale account separato da `people`), `people`, `user_roles`, `invites`, `guardian_links`, `seasons`, `teams`, `team_memberships`, `coach_assignments`.
- M2–M4: `membership_statuses` / `registrations`, `medical_expiries` (solo metadati), `dues`, `payment_records`.
- M6–M7: `facilities`, `spaces`, `space_availability` o vincoli equivalenti, `training_series`, `training_occurrences`, `training_exceptions`.
- M8 solo se approvato: `training_responses`.
- **Non creare** `attendance_records`, `match_callups`, `documents`, `posts`, `comments`, `conversations`, `social_messages`, `analytics_reports`.

## Quality gates universali
- [ ] Ogni slice è una funzione reale end-to-end UI → auth → DB → UI, persistente dopo refresh.
- [ ] Typecheck/build e test mirati eseguiti, con almeno un caso accesso negato.
- [ ] Loading, vuoto, errore e feedback azione gestiti.
- [ ] Dati di minori e certificati minimizzati; RLS server-side; segreti esclusi da repo.
- [ ] Nessuna funzione vietata aggiunta surrettiziamente.
- [ ] Aggiornare `[x]` solo per risultati realmente verificati.

## Decision log
- D1 — Una sola società, niente SaaS multi-tenant nell'MVP.
- D2 — Clubster è un riferimento organizzativo, ma questa roadmap prevale sul suo catalogo funzioni.
- D3 — Social, registro presenze, convocazioni, report/statistiche, documenti e regolamenti **fuori scope**.
- D4 — FASE 1 = anagrafica, squadre, tesseramenti, scadenze certificati, quote e dashboard operativa.
- D5 — FASE 2 = piscine/spazi + calendario allenamenti ricorrenti; disponibilità opzionali solo allora.
- D6 — STEP 1 `ROADMAP.md`; STEP 2 `AGENTS.md`; quindi codice, metodo CAVEMAN.

## Registro progressi
`YYYY-MM-DD | milestone | fatto VERIFICATO | test eseguito | prossima checkbox | blocker reale`
