import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/**
 * Genera lo script da incollare nel SQL Editor di Supabase.
 *
 * Il contenuto NON si scrive a mano: è la concatenazione delle migrazioni vere
 * del repository (`0012`, `0013`), con davanti i controlli preliminari e dietro
 * la registrazione nel registro delle migrazioni. Così il database remoto e il
 * repository non possono divergere, e un test se ne accorge se qualcuno tocca
 * una migrazione senza rigenerare lo script.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const DEPLOY_FILE = path.join(root, 'db/deploy/02-migrazione-m10.sql')
export const M10 = ['0012_clubs.sql', '0013_platform_api.sql']
const PRECEDENTI = [
  '0001_init.sql', '0002_teams.sql', '0003_admin.sql', '0004_license.sql',
  '0005_managed_postgres.sql', '0006_app_user_set_role.sql', '0007_app_runtime_role.sql',
  '0008_login_attempts.sql', '0009_supabase_auth.sql', '0010_api_rpc.sql',
  '0011_invite_without_password.sql',
]

const TESTATA = `-- =====================================================================
-- M10 — PIATTAFORMA MULTI-SOCIETÀ · script di migrazione per Supabase
--
-- GENERATO DA \`npm run deploy:sql\`. Non modificarlo a mano: è la copia esatta
-- delle migrazioni \`${M10.join('\` e \`')}\` del repository,
-- con davanti i controlli preliminari e dietro la registrazione nel registro.
--
-- COME SI USA
--   1. Pannello Supabase → SQL Editor → New query.
--   2. Incolla TUTTO questo file e premi Run.
--   3. L'ultima tabella dei risultati è il riepilogo: leggila prima di chiudere.
--
-- ATOMICITÀ: il SQL Editor manda il file come un'unica richiesta, quindi
-- PostgreSQL lo esegue in **una sola transazione implicita**. Se una riga
-- fallisce, non resta applicato niente. Per questo qui dentro non ci sono
-- \`begin\` né \`commit\`: aggiungerli spezzerebbe proprio questa garanzia.
--
-- RIESEGUIBILE: ogni passo è guardato (\`if not exists\`, \`on conflict do nothing\`,
-- \`drop policy if exists\` prima di ogni \`create policy\`). Lanciarlo due volte non
-- crea doppioni e non tocca i dati. È provato da \`server/test/idempotenza.test.ts\`.
--
-- NON CANCELLA NIENTE: nessun \`drop table\`, nessun \`drop column\`, nessun
-- \`delete\`, nessun \`truncate\`. Gli unici \`drop\` sono su un vincolo e tre indici,
-- subito ricreati per società.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) CONTROLLI PRELIMINARI — se qualcosa non torna, qui si ferma tutto
-- ---------------------------------------------------------------------
do $preflight$
declare
  mancanti text[];
  assenti text[];
  t text;
  n_persone int; n_squadre int; n_quote int; n_account int;
begin
  if to_regclass('public.schema_migrations') is null then
    raise exception 'Qui non c''è schema_migrations: questo non è il database del gestionale.';
  end if;

  select array_agg(v order by v) into mancanti
    from unnest(array[${PRECEDENTI.map((v) => `'${v}'`).join(',\n                      ')}]) as v
   where not exists (select 1 from public.schema_migrations m where m.version = v);
  if mancanti is not null then
    raise exception 'Mancano migrazioni precedenti: %. Applicale prima di questa.',
      array_to_string(mancanti, ', ');
  end if;

  assenti := array[]::text[];
  foreach t in array array['people','app_users','user_roles','guardian_links','seasons','teams',
                           'team_memberships','coach_assignments','registrations',
                           'medical_expiries','dues','payment_records','license'] loop
    if to_regclass('public.' || t) is null then assenti := assenti || t; end if;
  end loop;
  if array_length(assenti, 1) > 0 then
    raise exception 'Tabelle attese e non trovate: %.', array_to_string(assenti, ', ');
  end if;

  if exists (select 1 from public.schema_migrations where version = any(array[${M10.map((v) => `'${v}'`).join(', ')}])) then
    raise notice 'M10 risulta già applicata: la riesecuzione è innocua, si prosegue.';
  end if;

  select count(*) into n_persone from public.people;
  select count(*) into n_squadre from public.teams;
  select count(*) into n_quote from public.dues;
  select count(*) into n_account from public.app_users;
  raise notice 'Preflight ok — % persone, % squadre, % quote, % account. Nessuna di queste righe verrà cancellata.',
    n_persone, n_squadre, n_quote, n_account;
end $preflight$;
`

const PIEDE = `
-- ---------------------------------------------------------------------
-- 9) REGISTRO DELLE MIGRAZIONI
-- Il repository e il database devono raccontare la stessa storia: senza questa
-- riga, un domani \`npm run migrate\` proverebbe a riapplicare M10.
-- ---------------------------------------------------------------------
insert into public.schema_migrations (version)
values ${M10.map((v) => `('${v}')`).join(', ')}
on conflict (version) do nothing;

-- ---------------------------------------------------------------------
-- 10) RIEPILOGO — è l'ultima tabella che vedrai nel pannello
-- ---------------------------------------------------------------------
select 'migrazioni applicate' as voce,
       string_agg(version, ', ' order by version) as valore
  from public.schema_migrations where version = any(array[${M10.map((v) => `'${v}'`).join(', ')}])
union all
select 'società', (select string_agg(name, ', ' order by name) from public.clubs)
union all
select 'abbonamenti', (select string_agg(club_id::text || ' → ' || status || ' fino al ' || expires_on, ', ')
                         from public.subscriptions)
union all
select 'persone', (select count(*)::text from public.people)
union all
select 'persone senza società', (select count(*)::text from public.people where club_id is null)
union all
select 'account collegati a Supabase Auth',
       (select count(*)::text from public.app_users where auth_user_id is not null)
union all
select 'proprietari della piattaforma', (select count(*)::text from public.platform_owners);
`

/** Lo script, costruito dalle migrazioni vere. */
export async function buildDeploySql(): Promise<string> {
  const parti: string[] = [TESTATA]
  for (const nome of M10) {
    const sql = await readFile(path.join(root, 'db/migrations', nome), 'utf8')
    parti.push(`\n-- =====================================================================\n`
      + `-- CONTENUTO DI db/migrations/${nome}\n`
      + `-- =====================================================================\n\n${sql.trim()}\n`)
  }
  parti.push(PIEDE)
  return parti.join('\n')
}

export async function writeDeploySql(): Promise<string> {
  const sql = await buildDeploySql()
  await mkdir(path.dirname(DEPLOY_FILE), { recursive: true })
  await writeFile(DEPLOY_FILE, sql, 'utf8')
  return sql
}

/** Lo script sul disco è ancora quello che nasce dalle migrazioni di adesso? */
export async function deploySqlIsCurrent(): Promise<boolean> {
  const atteso = await buildDeploySql()
  const presente = await readFile(DEPLOY_FILE, 'utf8').catch(() => '')
  return atteso === presente
}
