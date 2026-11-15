# Messa in opera di M10 dal pannello Supabase

Quattro script, da incollare nel **SQL Editor** (New query → incolla tutto → Run),
**in quest'ordine**. Ogni script finisce con una tabella di risultati: è lì che si legge
l'esito, prima di passare al successivo.

| # | File | Che cosa fa | Scrive? |
| --- | --- | --- | --- |
| 1 | `01-ispezione.sql` | fotografia di partenza: migrazioni, conteggi, relazioni, account, licenza | no |
| 2 | `02-migrazione-m10.sql` | applica M10 (`0012` + `0013`) con i controlli preliminari | sì, solo schema |
| 3 | `03-verifica.sql` | 32 controlli: dati conservati, amministratore, isolamento, abbonamento | no |
| 4 | `04-proprietario.sql` | promuove `riccardocoletta@yahoo.it` a proprietario della piattaforma | sì, una riga |

## Come si esegue

1. **`01-ispezione.sql`** — copiati i numeri della sezione `conteggi` e `importi`:
   servono al passo 3.
2. **`02-migrazione-m10.sql`** — il SQL Editor lo manda come richiesta unica, quindi
   PostgreSQL lo esegue in **una sola transazione**: se qualcosa fallisce non resta
   applicato niente. È rieseguibile senza danni. Se i controlli preliminari trovano
   qualcosa fuori posto, si ferma prima di toccare lo schema.
3. **`03-verifica.sql`** — prima di lanciarlo, riporta i numeri del passo 1 nel blocco
   `attesi` in cima al file (altrimenti i controlli di conservazione dicono `n/d`).
   L'ultima riga è l'esito complessivo: deve dire `TUTTO OK`.
4. **`04-proprietario.sql`** — **solo dopo** che il passo 3 è a posto, e solo quando lo
   si decide. È l'unico script che aggiunge un potere nuovo.

## Regole

- `02` non è scritto a mano: lo genera `npm run deploy:sql` dalle migrazioni vere
  (`db/migrations/0012_clubs.sql`, `0013_platform_api.sql`). Se si tocca una migrazione,
  si rigenera — e un test fallisce se ci si dimentica.
- Nessuno di questi script cancella dati: niente `drop table`, `drop column`, `delete`
  o `truncate` sui dati esistenti.
- Dal terminale non si parla più con PostgreSQL: `npm run migrate`, `npm run db:verify`
  e `npm run platform:owner` restano per lo sviluppo locale su PGlite.
