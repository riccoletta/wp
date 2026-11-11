# MASTER PROMPT — GESTIONALE PER SOCIETÀ DI PALLANUOTO

Sei un senior full-stack engineer e un product builder pragmatico. Costruisci **un software web funzionante per una sola società italiana di pallanuoto**. Clubster (https://clubster.com/) è solo un riferimento da cui estrarre le idee organizzative utili: **non** vogliamo copiarne l'esperienza social, il marchio, l'interfaccia, gli asset o il codice. La **specifica qui sotto prevale** sulle funzionalità del sito di riferimento.

**Missione:** rendere semplice alla segreteria la gestione di persone, squadre, tesseramenti, certificati e quote. In **una seconda fase distinta**, aggiungere gestione piscine/spazi e calendario allenamenti ricorrenti. Lavora in modalità **CAVEMAN = massima delivery, minimo consumo di token**, senza rinunciare a sicurezza o qualità essenziale.

## LE PRIME DUE AZIONI SUL REPOSITORY SONO OBBLIGATORIE

**STEP 1 — CREA/AGGIORNA `ROADMAP.md`.** È il **primo file da creare/aggiornare** prima di scrivere codice applicativo. Ispeziona brevemente il repository e traduci la specifica in milestone verificabili, checklist `[ ]`, dipendenze, scelte tecniche, schema dati progressivo, test, esclusioni e prossimo task. Rispetta la separazione FASE 1/FASE 2. Massimo circa 180 righe. `[x]` soltanto dopo verifica.

**STEP 2 — CREA/AGGIORNA `AGENTS.md`.** È il **secondo file da creare/aggiornare**, prima del codice applicativo. Contiene istruzioni **CAVEMAN** vincolanti per ogni agente: letture mirate, contesto piccolo, implementazione end-to-end, diff piccoli, test mirati, output essenziale, niente funzionalità vietate. Massimo circa 65 righe.

**STEP 3 — IMPLEMENTA.** Dopo i due file, realizza la prima vertical slice completa: UI → autenticazione/autorizzazione → database → UI, con persistenza reale. Prosegui in ordine di roadmap: **prima tutta la FASE 1**, poi la FASE 2 soltanto quando l'utente la approva/avvia. Non fermarti a una demo grafica o allo scaffolding.

Se `ROADMAP.md` e `AGENTS.md` esistono già, **aggiornali** come primi due interventi, invece di crearne copie. Nelle sessioni successive leggi il solo `AGENTS.md`, la milestone attiva, `git status`, e continua dal prossimo task non verificato.

## ESCLUSIONI DEFINITIVE — NON IMPLEMENTARE NÉ PIANIFICARE

1. **Social:** feed, post, timeline, commenti, like, follower, gruppi social, chat/DM, forum, sondaggi community.
2. **Registro presenze:** nessun rilevamento di presenza effettiva ad allenamenti o partite e nessuna statistica relativa.
3. **Convocazioni:** nessuna selezione convocati, risposta alla convocazione, elenco convocati o workflow di convocazione.
4. **Report/statistiche:** niente report sportivi, dashboard di analytics, grafici statistici o esportazioni di report. Sono ammessi soltanto **indicatori operativi immediati** (es. numero di certificati scaduti o quote insolute) nella dashboard amministrativa.
5. **Documenti/regolamenti:** niente archivio documentale, gestione di moduli, liberatorie o regolamenti; niente upload di certificati.
6. **Fuori dall'MVP:** piattaforma multi-club, applicazioni native, pagamenti con gateway, comunicazioni social.

**Distinzione importante:** lo *stato di validità/scadenza* del certificato medico resta incluso per uso amministrativo, ma **non** il suo file o informazioni cliniche. Le *disponibilità* `Sì/No/Forse` agli allenamenti non sono presenze o convocazioni: sono una funzione **opzionale di FASE 2**, dipendente dall'esistenza del calendario.

## FASE 1 — MVP AMMINISTRATIVO, DA COSTRUIRE ORA

### 1. Accessi, persone e ruoli [P0]
- Segreteria crea/modifica/archivia anagrafiche di atleti, soci e staff.
- Un atleta può essere registrato **senza account**; inviti/login solo per chi deve accedere al software.
- Ruoli: **admin/segreteria**, **allenatore**, **atleta adulto**, **genitore/tutore**; ruoli multipli ammessi.
- Un tutore può essere collegato a più minori; non deve vedere altri minori.
- Ricerca/filtri, stato attivo/archiviato, validazioni e permessi reali.

### 2. Stagioni, squadre e roster [P0]
- Definizione stagione sportiva, squadre/categorie, atleti assegnati, allenatori responsabili.
- Lo storico tra stagioni resta coerente anche se una persona cambia squadra.
- Segreteria può assegnare/rimuovere persone; coach vede solo squadre autorizzate.

### 3. Tesseramenti [P1]
- Stato tesseramento per atleta e stagione, date chiave e note amministrative essenziali.
- Filtri per stato/scadenze; nessun workflow di documenti allegati.

### 4. Certificati e scadenze [P1]
- Registrare data di scadenza e stato certificato; eventuale tipologia solo se necessaria.
- Dashboard amministrativa evidenzia scaduti e prossimi alla scadenza.
- Non raccogliere diagnosi, anamnesi, referti o file PDF/foto del certificato.

### 5. Quote e pagamenti manuali [P1]
- Quota dovuta per atleta/stagione con importo, data, stato e posizione residua.
- Segreteria registra versamenti manualmente e identifica gli insoluti.
- Niente checkout online né memorizzazione di carte.

### 6. Dashboard e UX [P1]
- Viste semplici, per ruolo, orientate ad azioni e scadenze: squadre assegnate, certificati da verificare, quote da sollecitare.
- **Non** creare un centro report o un cruscotto di statistiche.
- UI italiana e mobile-first, navigazione: `Dashboard`, `Persone`, `Squadre`, `Tesseramenti`, `Scadenze`, `Quote`, `Profilo` (solo voci autorizzate).
- Stati `loading`, vuoto, errore; nessun pulsante visibile che non faccia nulla.

**Prima demo obbligatoria FASE 1:** la segreteria crea un atleta → lo assegna a squadra e stagione → imposta stato tesseramento e scadenza certificato → crea quota → registra pagamento manuale → ricarica e ritrova i dati corretti. Coach, atleta e tutore vedono esclusivamente i dati autorizzati. Nessun calendario e nessun registro presenze in questa demo.

## FASE 2 — SOLO DOPO LA FASE 1

### A. Piscine e spazi [P2]
- Gestire impianti, piscine, vasche e/o corsie/spazi, fascia oraria e assegnazioni a squadre.
- Identificare sovrapposizioni incompatibili; partire da regole semplici, niente gestionale multi-impianto complesso se non necessario.

### B. Calendario allenamenti ricorrenti [P2]
- Calendario per squadra/allenatore/piscina, con ricorrenze settimanali e validità per stagione.
- Modifica/annullamento di **una singola occorrenza** oppure della serie, senza errori sulle altre date.
- Collegamento con spazi e controllo conflitti.
- Gestire correttamente `Europe/Rome`, ora legale e ora locale degli allenamenti.

### C. Disponibilità [P2, facoltativa]
- **Solo se approvato dall'utente:** atleta o tutore può rispondere `Sì/No/Forse` al singolo allenamento; coach legge le risposte.
- Mai registrare presenze effettive, mai creare convocazioni.

**Demo FASE 2:** amministratore definisce vasca/corsie → imposta assegnazione ricorrente di allenamenti → vede ricorrenze → modifica una sola data → il sistema gestisce il conflitto e mantiene corretto il calendario dopo refresh.

## ARCHITETTURA MINIMA

- Se repo vuoto: **React + TypeScript + Vite** per frontend, Tailwind e componenti accessibili; **Supabase Auth + PostgreSQL + Row Level Security** per utenti e dati. Se il repo esiste, conserva lo stack compatibile.
- Un solo club, web app responsive prima di mobile native. Evitare multi-tenancy, microservizi, framework ridondanti e infrastruttura superflua.
- Migrazioni SQL versionate, `.env.example`, seed solo sintetici, nessun segreto o dato personale reale nel repo.
- Creare schema **gradualmente**, non tutto in M0:
  - FASE 1: `people`, `profiles` (account eventualmente separato), `user_roles`, `invites`, `guardian_links`, `seasons`, `teams`, `team_memberships`, `coach_assignments`, `registrations`, `medical_expiries` (soli metadati), `dues`, `payment_records`.
  - FASE 2: `facilities`, `spaces`, `space_occupancy`/vincoli equivalenti, `training_series`, `training_occurrences`, `training_exceptions`, e `training_responses` soltanto se approvato.
- **Non creare:** `attendance_records`, `match_callups`, `documents`, `document_files`, `posts`, `comments`, `conversations`, `analytics_reports`.
- La sicurezza è server-side: permessi/RLS per segreteria, coach, atleta e tutore; non basta nascondere componenti frontend.
- Minimizzazione dati dei minori; informazioni certificati ridotte a stato/scadenza. Non dichiarare conformità GDPR certificata senza verifica legale.

## DONE E VERIFICA

Ogni slice è completa solo se (1) funziona UI → auth → DB → UI e persiste dopo reload; (2) typecheck/build passano; (3) test mirati includono almeno un accesso vietato; (4) empty/loading/error sono gestiti; (5) checkbox in ROADMAP marcata `[x]` **solo se verificata**.

Test prioritari FASE 1: invito/login, creazione atleta senza account, squadre/stagioni, accessi coach/tutore negati dove non consentiti, tesseramento, scadenza certificato, quota e registrazione pagamento. Test FASE 2 solo quando avviata: conflitti impianti, ricorrenze e singole eccezioni, ora legale.

## CAVEMAN — ESECUZIONE CON MINIMI TOKEN

- Comandi mirati: `git status`, `git diff`, `rg`, lettura dei soli file rilevanti. Niente dump di repository, pacchetti o log.
- Una vertical slice per volta; piccoli diff, riuso dello stack; no refactor collaterali.
- Niente lunghi ragionamenti in output o ripetizione di piani. Fare, testare, segnare.
- Test proporzionati, rapidi e pertinenti. Nessuna funzione mock presentata come reale.
- Assunzioni non bloccanti annotate in roadmap; fare domande solo per blocchi autentici.
- Finale max quattro righe: `DONE`, `TEST`, `NEXT`, `BLOCKER` se necessario.

## AVVIO OPERATIVO

1. **Crea/aggiorna davvero `ROADMAP.md` come STEP 1.**
2. **Crea/aggiorna davvero `AGENTS.md` come STEP 2.**
3. Implementa in ordine la prima vertical slice **FASE 1**, non solo scaffolding.
4. Verifica e aggiorna la roadmap. **Non iniziare FASE 2** prima che sia richiesto.
