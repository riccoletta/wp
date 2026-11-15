-- =====================================================================
-- M10 — PIATTAFORMA MULTI-SOCIETÀ · script di migrazione per Supabase
--
-- GENERATO DA `npm run deploy:sql`. Non modificarlo a mano: è la copia esatta
-- delle migrazioni `0012_clubs.sql` e `0013_platform_api.sql` del repository,
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
-- `begin` né `commit`: aggiungerli spezzerebbe proprio questa garanzia.
--
-- RIESEGUIBILE: ogni passo è guardato (`if not exists`, `on conflict do nothing`,
-- `drop policy if exists` prima di ogni `create policy`). Lanciarlo due volte non
-- crea doppioni e non tocca i dati. È provato da `server/test/idempotenza.test.ts`.
--
-- NON CANCELLA NIENTE: nessun `drop table`, nessun `drop column`, nessun
-- `delete`, nessun `truncate`. Gli unici `drop` sono su un vincolo e tre indici,
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
    from unnest(array['0001_init.sql',
                      '0002_teams.sql',
                      '0003_admin.sql',
                      '0004_license.sql',
                      '0005_managed_postgres.sql',
                      '0006_app_user_set_role.sql',
                      '0007_app_runtime_role.sql',
                      '0008_login_attempts.sql',
                      '0009_supabase_auth.sql',
                      '0010_api_rpc.sql',
                      '0011_invite_without_password.sql']) as v
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

  if exists (select 1 from public.schema_migrations where version = any(array['0012_clubs.sql', '0013_platform_api.sql'])) then
    raise notice 'M10 risulta già applicata: la riesecuzione è innocua, si prosegue.';
  end if;

  select count(*) into n_persone from public.people;
  select count(*) into n_squadre from public.teams;
  select count(*) into n_quote from public.dues;
  select count(*) into n_account from public.app_users;
  raise notice 'Preflight ok — % persone, % squadre, % quote, % account. Nessuna di queste righe verrà cancellata.',
    n_persone, n_squadre, n_quote, n_account;
end $preflight$;


-- =====================================================================
-- CONTENUTO DI db/migrations/0012_clubs.sql
-- =====================================================================

-- 0012 — Da una società a una piattaforma di società (M10a/M10b/M10d).
--
-- ADDITIVA. Nessuna migrazione precedente viene riscritta, nessuna tabella ricreata,
-- nessun dato cancellato: i dati già presenti diventano quelli della prima società,
-- "Pallanuoto Milano". Su un database vuoto la società nasce lo stesso, vuota.
--
-- Tre idee, e nient'altro:
--   1) ogni dato di società porta `club_id`, con DEFAULT `app_current_club()`:
--      le funzioni `api_*` che inseriscono non cambiano di una riga;
--   2) le chiavi esterne diventano COMPOSITE `(figlio, club_id) → (padre, club_id)`:
--      legare fra loro righe di società diverse non è "vietato dall'applicazione",
--      è impossibile nel database;
--   3) la società su cui si lavora è una scelta esplicita e registrata
--      (`club_sessions`), validata a ogni chiamata: l'URL non decide nulla.

/* ============================== 1) Le tabelle ============================= */

create table if not exists clubs (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);

-- Proprietario della piattaforma. NON è un ruolo applicativo e non sta in `user_roles`:
-- nessun amministratore di società può arrivarci, perché nessun ruolo della Data API ha
-- GRANT di scrittura su questa tabella. Si popola solo con `npm run platform:owner`,
-- che gira con la connessione diretta del ruolo proprietario del database.
create table if not exists platform_owners (
  auth_user_id uuid primary key,
  email text not null,
  note text,
  created_at timestamptz not null default now()
);

-- Un abbonamento per società. Sostituisce la licenza unica di 0004: stesse soglie,
-- stesso stato DERIVATO (mai un campo "sola lettura" scrivibile), ma per cliente.
create table if not exists subscriptions (
  club_id uuid primary key references clubs(id) on delete cascade,
  status text not null default 'attiva' check (status in ('attiva','sospesa')),
  expires_on date not null,
  grace_days integer not null default 15 check (grace_days >= 0 and grace_days <= 365),
  note text,
  updated_at timestamptz not null default now()
);

-- Registro degli atti del proprietario: chi, quando, su quale società, con che effetto.
create table if not exists subscription_events (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  action text not null check (action in ('creata','rinnovata','sospesa','riattivata')),
  actor_auth_user_id uuid,
  expires_on date,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists subscription_events_club_idx on subscription_events (club_id, created_at desc);

-- La società corrente: una scelta dichiarata, non un pezzo di URL e non un header.
-- Si scrive solo da `api_club_enter`, che verifica l'accesso prima di registrarla.
create table if not exists club_sessions (
  auth_user_id uuid primary key,
  club_id uuid not null references clubs(id) on delete cascade,
  updated_at timestamptz not null default now()
);

alter table clubs               enable row level security;
alter table platform_owners     enable row level security;
alter table subscriptions       enable row level security;
alter table subscription_events enable row level security;
alter table club_sessions       enable row level security;

/* ================== 2) La prima società e i dati esistenti ================ */

do $$
declare club uuid;
begin
  select id into club from clubs where slug = 'pallanuoto-milano';
  if club is null then
    insert into clubs (slug, name) values ('pallanuoto-milano', 'Pallanuoto Milano')
    returning id into club;
  end if;

  -- La licenza globale diventa l'abbonamento della prima società: stato, scadenza,
  -- tolleranza e nota restano quelli che erano. Se la tabella `license` è vuota
  -- (database nuovo) si parte da un anno.
  insert into subscriptions (club_id, status, expires_on, grace_days, note)
  select club,
         coalesce((select l.status from license l), 'attiva'),
         coalesce((select l.expires_on from license l), current_date + 365),
         coalesce((select l.grace_days from license l), 15),
         (select l.note from license l)
  on conflict (club_id) do nothing;

  insert into subscription_events (club_id, action, expires_on, note)
  select club, 'creata', s.expires_on, 'Prima società: licenza unica trasformata in abbonamento (0012)'
    from subscriptions s where s.club_id = club
   and not exists (select 1 from subscription_events e where e.club_id = club);
end $$;

-- `club_id` su ogni tabella di società, con backfill sulla prima società.
-- Il DEFAULT vale per gli inserimenti futuri, che arrivano tutti da un utente
-- che ha dichiarato in quale società sta lavorando.
do $$
declare
  t text;
  club uuid := (select id from clubs where slug = 'pallanuoto-milano');
  club_tables text[] := array[
    'people', 'app_users', 'guardian_links', 'seasons', 'teams', 'team_memberships',
    'coach_assignments', 'registrations', 'medical_expiries', 'dues', 'payment_records'];
begin
  foreach t in array club_tables loop
    execute format('alter table public.%I add column if not exists club_id uuid references clubs(id) on delete cascade', t);
    execute format('update public.%I set club_id = %L where club_id is null', t, club);
    execute format('alter table public.%I alter column club_id set not null', t);
    execute format('create index if not exists %I on public.%I (club_id)', t || '_club_idx', t);
  end loop;
end $$;

/* ============ 3) Nessun legame fra società diverse, mai, nemmeno per errore ========== */

-- Bersagli delle chiavi composite `(id, club_id)` sui "padri", e poi le chiavi
-- composite vere e proprie: un tesseramento, una rosa, un versamento o un legame
-- tutore↔minore fra società diverse non è vietato dall'applicazione, è impossibile
-- nel database. Ogni vincolo si aggiunge solo se non c'è già: questo file deve
-- poter essere rieseguito senza fare danni.
do $$
declare
  v record;
  vincoli constant text[][] := array[
    ['people',            'people_id_club_key',               'unique (id, club_id)'],
    ['seasons',           'seasons_id_club_key',              'unique (id, club_id)'],
    ['teams',             'teams_id_club_key',                'unique (id, club_id)'],
    ['dues',              'dues_id_club_key',                 'unique (id, club_id)'],
    ['app_users',         'app_users_person_club_fk',         'foreign key (person_id, club_id) references people (id, club_id) on delete cascade'],
    ['teams',             'teams_season_club_fk',             'foreign key (season_id, club_id) references seasons (id, club_id) on delete cascade'],
    ['team_memberships',  'team_memberships_team_club_fk',    'foreign key (team_id, club_id) references teams (id, club_id) on delete cascade'],
    ['team_memberships',  'team_memberships_person_club_fk',  'foreign key (person_id, club_id) references people (id, club_id) on delete cascade'],
    ['coach_assignments', 'coach_assignments_team_club_fk',   'foreign key (team_id, club_id) references teams (id, club_id) on delete cascade'],
    ['coach_assignments', 'coach_assignments_person_club_fk', 'foreign key (person_id, club_id) references people (id, club_id) on delete cascade'],
    ['guardian_links',    'guardian_links_guardian_club_fk',  'foreign key (guardian_person_id, club_id) references people (id, club_id) on delete cascade'],
    ['guardian_links',    'guardian_links_minor_club_fk',     'foreign key (minor_person_id, club_id) references people (id, club_id) on delete cascade'],
    ['registrations',     'registrations_person_club_fk',     'foreign key (person_id, club_id) references people (id, club_id) on delete cascade'],
    ['registrations',     'registrations_season_club_fk',     'foreign key (season_id, club_id) references seasons (id, club_id) on delete cascade'],
    ['medical_expiries',  'medical_expiries_person_club_fk',  'foreign key (person_id, club_id) references people (id, club_id) on delete cascade'],
    ['dues',              'dues_person_club_fk',              'foreign key (person_id, club_id) references people (id, club_id) on delete cascade'],
    ['dues',              'dues_season_club_fk',              'foreign key (season_id, club_id) references seasons (id, club_id) on delete cascade'],
    ['payment_records',   'payment_records_due_club_fk',      'foreign key (due_id, club_id) references dues (id, club_id) on delete cascade']
  ];
begin
  for v in select vincoli[i][1] as tabella, vincoli[i][2] as nome, vincoli[i][3] as definizione
             from generate_subscripts(vincoli, 1) as i
  loop
    if not exists (select 1 from pg_constraint where conname = v.nome) then
      execute format('alter table public.%I add constraint %I %s', v.tabella, v.nome, v.definizione);
    end if;
  end loop;
end $$;

/* ===================== 4) Unicità: per società, non globali =============== */

-- Due società possono avere la stagione "2025/2026", l'una l'attiva senza spegnere
-- quella dell'altra, e la stessa email può essere un accesso in società diverse.
alter table seasons drop constraint if exists seasons_name_key;
create unique index if not exists seasons_club_name_idx on seasons (club_id, lower(name));

drop index if exists seasons_single_active_idx;
create unique index seasons_single_active_idx on seasons (club_id) where is_active;

drop index if exists app_users_email_idx;
create unique index app_users_email_idx on app_users (club_id, lower(email));

drop index if exists app_users_auth_user_idx;
create unique index app_users_auth_user_idx on app_users (club_id, auth_user_id)
  where auth_user_id is not null;

/* ======================= 5) Chi sei, dove stai lavorando ================== */

-- Proprietario della piattaforma: solo da `platform_owners`, solo per identità
-- Supabase. Mai dai metadati dell'account (li modifica l'utente), mai da un
-- confronto di email.
create or replace function app_is_platform_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and exists (select 1 from platform_owners o where o.auth_user_id = auth.uid())
$$;

-- Le società in cui questa identità ha un accesso. Una identità può averne più d'una:
-- sono righe `app_users` diverse, ognuna con la sua persona e i suoi ruoli.
create or replace function app_auth_clubs() returns setof uuid
language sql stable security definer set search_path = public as $$
  select u.club_id from app_users u
   where u.active
     and case
       when auth.uid() is not null then u.auth_user_id = auth.uid()
       when coalesce(current_setting('request.jwt.claims', true), '') <> '' then false
       -- Ripiego per i ruoli che non passano dalla Data API (migrazioni, script).
       else u.id = nullif(current_setting('app.user_id', true), '')::uuid
     end
$$;

create or replace function app_can_access_club(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select c is not null and (app_is_platform_owner() or c in (select app_auth_clubs()))
$$;

-- La società corrente. È la scelta registrata da `api_club_enter`, **rivalidata ogni
-- volta**: se l'accesso è stato tolto nel frattempo, la scelta non vale più. Chi ha
-- un solo accesso non deve scegliere niente.
create or replace function app_current_club() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare chosen uuid; n integer;
begin
  if auth.uid() is not null then
    select s.club_id into chosen from club_sessions s where s.auth_user_id = auth.uid();
    if chosen is not null and app_can_access_club(chosen) then return chosen; end if;
  end if;
  select count(*) into n from (select distinct app_auth_clubs() as club_id) c;
  if n <> 1 then return null; end if;
  select c.club_id into chosen from (select distinct app_auth_clubs() as club_id) c;
  return chosen;
end $$;

-- L'utente applicativo è quello della società corrente: la stessa identità Supabase
-- in un'altra società è un'altra riga, con altri ruoli.
create or replace function app_uid() returns uuid
language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is not null then
      (select u.id from app_users u
        where u.auth_user_id = auth.uid() and u.active and u.club_id = app_current_club())
    when coalesce(current_setting('request.jwt.claims', true), '') <> '' then null
    else nullif(current_setting('app.user_id', true), '')::uuid
  end
$$;

-- Società di un utente applicativo, senza passare dalla RLS di `app_users`
-- (serve nelle policy di `user_roles`, che altrimenti ricorrerebbero).
create or replace function app_user_club(u uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select club_id from app_users where id = u
$$;

-- Amministra la società corrente: la segreteria della società, oppure il
-- proprietario della piattaforma che è entrato dichiaratamente in quella società.
create or replace function app_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select (app_is_platform_owner() and app_current_club() is not null)
      or exists (select 1 from user_roles r where r.user_id = app_uid() and r.role = 'admin')
$$;

/* ===================== 6) Abbonamento: stato derivato ===================== */

create or replace function app_subscription_blocked(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select s.status = 'sospesa' or (s.expires_on + s.grace_days) < current_date
       from subscriptions s where s.club_id = c),
    true)  -- società senza abbonamento: chiusa, non aperta.
$$;

create or replace function app_subscription_message(c uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when s.status = 'sospesa' then
      'Abbonamento sospeso. I dati della società restano al loro posto, ma non sono '
      || 'consultabili finché il fornitore non riattiva il servizio.'
    else
      'Abbonamento scaduto il ' || to_char(s.expires_on, 'DD/MM/YYYY')
      || ' e tolleranza conclusa il ' || to_char(s.expires_on + s.grace_days, 'DD/MM/YYYY')
      || '. I dati della società restano al loro posto, ma non sono consultabili '
      || 'finché il fornitore non rinnova il servizio.'
  end from subscriptions s where s.club_id = c
$$;

-- Il cancello di ogni dato operativo: la società corrente, e solo se l'abbonamento
-- è in piedi. Il proprietario della piattaforma entra anche in una società sospesa,
-- altrimenti non potrebbe rimetterla in piedi.
create or replace function app_club_open(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select c is not null and c = app_current_club()
     and (app_is_platform_owner() or not app_subscription_blocked(c))
$$;

-- Scrivere: amministrare la società corrente, con l'abbonamento in piedi.
-- Il messaggio italiano dell'abbonamento arriva al client come errore P0001.
create or replace function app_can_write() returns boolean
language plpgsql stable security definer set search_path = public as $$
declare c uuid := app_current_club();
begin
  if c is null or not app_is_admin() then return false; end if;
  if app_subscription_blocked(c) then
    if app_is_platform_owner() then return true; end if;
    raise exception '%', app_subscription_message(c) using errcode = 'P0001';
  end if;
  return true;
end $$;

-- Ora che `app_current_club()` esiste, `club_id` si compila da sé: nessuna delle
-- funzioni `api_*` che inseriscono deve nominarlo, e chi lo nomina sbagliato viene
-- fermato dal WITH CHECK delle policy qui sotto.
do $$
declare t text;
begin
  foreach t in array array[
    'people', 'app_users', 'guardian_links', 'seasons', 'teams', 'team_memberships',
    'coach_assignments', 'registrations', 'medical_expiries', 'dues', 'payment_records'] loop
    execute format('alter table public.%I alter column club_id set default app_current_club()', t);
  end loop;
end $$;

/* ========================= 7) Policy: tutto per società =================== */

-- Le policy di 0001–0009 restano nella sostanza (chi vede che cosa): ci si aggiunge
-- davanti il cancello della società. Riscritte qui una per una, esplicite, perché
-- un `alter policy` automatico nasconderebbe proprio la riga che conta.
drop policy if exists people_read on people;
create policy people_read on people for select to app_user, authenticated
  using (app_club_open(club_id) and (app_is_admin() or app_can_see_person(id)));

drop policy if exists app_users_read on app_users;
create policy app_users_read on app_users for select to app_user, authenticated
  using (app_club_open(club_id) and (app_is_admin() or id = app_uid()));

drop policy if exists user_roles_read on user_roles;
create policy user_roles_read on user_roles for select to app_user, authenticated
  using (app_club_open(app_user_club(user_id)) and (app_is_admin() or user_id = app_uid()));

drop policy if exists guardian_links_read on guardian_links;
create policy guardian_links_read on guardian_links for select to app_user, authenticated
  using (app_club_open(club_id) and (app_is_admin() or guardian_person_id = app_person_id()));

drop policy if exists seasons_read on seasons;
create policy seasons_read on seasons for select to app_user, authenticated
  using (app_club_open(club_id));

drop policy if exists teams_read on teams;
create policy teams_read on teams for select to app_user, authenticated
  using (app_club_open(club_id) and (app_is_admin() or app_can_see_team(id)));

drop policy if exists memberships_read on team_memberships;
create policy memberships_read on team_memberships for select to app_user, authenticated
  using (app_club_open(club_id) and (app_is_admin() or app_can_see_team(team_id)));

drop policy if exists coach_assignments_read on coach_assignments;
create policy coach_assignments_read on coach_assignments for select to app_user, authenticated
  using (app_club_open(club_id) and (app_is_admin() or app_can_see_team(team_id)));

drop policy if exists registrations_read on registrations;
create policy registrations_read on registrations for select to app_user, authenticated
  using (app_club_open(club_id) and (app_is_admin() or app_is_self_or_ward(person_id)));

drop policy if exists medical_read on medical_expiries;
create policy medical_read on medical_expiries for select to app_user, authenticated
  using (app_club_open(club_id) and (app_is_admin() or app_can_see_person(person_id)));

drop policy if exists dues_read on dues;
create policy dues_read on dues for select to app_user, authenticated
  using (app_club_open(club_id) and (app_is_admin() or app_is_self_or_ward(person_id)));

drop policy if exists payments_read on payment_records;
create policy payments_read on payment_records for select to app_user, authenticated
  using (app_club_open(club_id)
         and (app_is_admin()
              or exists (select 1 from dues d where d.id = due_id and app_is_self_or_ward(d.person_id))));

-- Scrittura: le policy per comando create da 0009, più il cancello della società.
-- `club_id` arriva dal DEFAULT, quindi una INSERT che non lo nomina è già giusta;
-- una che lo nomina sbagliato viene rifiutata dal WITH CHECK. `app_can_write()` sta
-- *prima* del cancello della società perché è la sola che sa spiegarsi: con
-- l'abbonamento fermo solleva il messaggio italiano invece di un diniego muto.
do $$
declare
  t text;
  club_tables text[] := array[
    'people', 'guardian_links', 'seasons', 'teams', 'team_memberships',
    'coach_assignments', 'registrations', 'medical_expiries', 'dues', 'payment_records'];
begin
  foreach t in array club_tables loop
    execute format('drop policy if exists %I on public.%I', t || '_ins', t);
    execute format('drop policy if exists %I on public.%I', t || '_upd', t);
    execute format('drop policy if exists %I on public.%I', t || '_del', t);
    execute format(
      'create policy %I on public.%I for insert to app_user, authenticated '
      || 'with check (public.app_can_write() and public.app_club_open(club_id))', t || '_ins', t);
    execute format(
      'create policy %I on public.%I for update to app_user, authenticated '
      || 'using (public.app_club_open(club_id) and public.app_is_admin()) '
      || 'with check (public.app_can_write() and public.app_club_open(club_id))', t || '_upd', t);
    execute format(
      'create policy %I on public.%I for delete to app_user, authenticated '
      || 'using (public.app_can_write() and public.app_club_open(club_id))', t || '_del', t);
  end loop;
end $$;

/* ============== 8) Policy e privilegi delle tabelle di piattaforma ======== */

-- `clubs`: il proprietario le vede tutte, l'utente di società vede la propria (gli
-- serve il nome da mostrare). Scrive solo il proprietario. Nessuna cancellazione:
-- una società non si elimina dall'interfaccia.
drop policy if exists clubs_read on clubs;
create policy clubs_read on clubs for select to app_user, authenticated
  using (app_is_platform_owner() or id in (select app_auth_clubs()));
drop policy if exists clubs_ins on clubs;
create policy clubs_ins on clubs for insert to authenticated
  with check (app_is_platform_owner());
drop policy if exists clubs_upd on clubs;
create policy clubs_upd on clubs for update to authenticated
  using (app_is_platform_owner()) with check (app_is_platform_owner());

-- L'abbonamento si legge anche quando è scaduto o sospeso: è l'unica cosa che
-- l'utente di una società chiusa deve poter vedere, insieme all'uscita.
drop policy if exists subscriptions_read on subscriptions;
create policy subscriptions_read on subscriptions for select to app_user, authenticated
  using (app_can_access_club(club_id));
drop policy if exists subscriptions_ins on subscriptions;
create policy subscriptions_ins on subscriptions for insert to authenticated
  with check (app_is_platform_owner());
drop policy if exists subscriptions_upd on subscriptions;
create policy subscriptions_upd on subscriptions for update to authenticated
  using (app_is_platform_owner()) with check (app_is_platform_owner());

drop policy if exists subscription_events_read on subscription_events;
create policy subscription_events_read on subscription_events for select to authenticated
  using (app_is_platform_owner());
drop policy if exists subscription_events_ins on subscription_events;
create policy subscription_events_ins on subscription_events for insert to authenticated
  with check (app_is_platform_owner());

-- `platform_owners` e `club_sessions`: nessun GRANT a nessun ruolo applicativo.
-- La prima si scrive solo con la connessione diretta del proprietario del database,
-- la seconda solo da `api_club_enter` (SECURITY DEFINER, con verifica esplicita).
-- `app_users` esce dalla Data API colonna per colonna (0009): `club_id` è una
-- colonna nuova, e senza questo GRANT nemmeno `api_me()` potrebbe leggerla.
grant select (club_id) on app_users to authenticated;

grant select, insert, update on clubs to authenticated;
grant select, insert, update on subscriptions to authenticated;
grant select, insert         on subscription_events to authenticated;
grant select                 on clubs, subscriptions to app_user;

notify pgrst, 'reload schema';


-- =====================================================================
-- CONTENUTO DI db/migrations/0013_platform_api.sql
-- =====================================================================

-- 0013 — Superficie dati della piattaforma (M10b/M10c).
--
-- Due sole funzioni SECURITY DEFINER in tutto il file, e tutte e due si controllano
-- da sole prima di fare qualunque cosa:
--   * `api_club_enter` / `api_club_leave`, perché `club_sessions` non ha GRANT per
--     nessun ruolo applicativo: la società corrente non si scrive da fuori;
--   * `api_platform_clubs`, perché contare atleti e squadre di TUTTE le società è
--     per definizione fuori dalla RLS di una società sola.
-- Tutto il resto resta SECURITY INVOKER: decide la policy, come da D9.

/* ========================= Due aiutanti minuscoli ======================== */

-- `auth.uid()` e `platform_owners` non sono raggiungibili dal ruolo `authenticated`
-- (lo schema `auth` appartiene a Supabase, la tabella dei proprietari non ha GRANT
-- per nessuno). Le funzioni `api_*` SECURITY INVOKER passano di qui invece di
-- toccarli: restituiscono solo l'identità di chi sta chiamando e la sua email.
create or replace function app_auth_uid() returns uuid
language sql stable security definer set search_path = public as $$
  select auth.uid()
$$;

-- L'email dell'identità, anche quando non si è ancora scelta una società: senza
-- società corrente `app_users` non è leggibile, e `api_me()` non avrebbe nemmeno
-- un nome da mostrare nella pagina di scelta.
create or replace function app_identity_email() returns text
language sql stable security definer set search_path = public as $$
  select u.email from app_users u
   where u.auth_user_id = auth.uid() and u.active
   order by u.created_at limit 1
$$;

create or replace function app_platform_owner_email() returns text
language sql stable security definer set search_path = public as $$
  select o.email from platform_owners o where o.auth_user_id = auth.uid()
$$;

/* ===================== Stato derivato dell'abbonamento =================== */

-- Stesse soglie e stessi messaggi italiani della licenza di 0009/0010, per società.
-- DEFINER perché serve anche al proprietario sulle società in cui non è dentro, ma
-- la prima riga è un controllo d'accesso: nessuno legge l'abbonamento di una società
-- che non lo riguarda.
create or replace function app_subscription_json(c uuid) returns json
language sql stable security definer set search_path = public as $$
  with s as (
    select sub.status, sub.expires_on, sub.grace_days, sub.note, sub.updated_at,
           (sub.expires_on + sub.grace_days) as grace_until,
           (sub.expires_on - current_date) as days_left,
           (sub.expires_on + sub.grace_days - current_date) as grace_days_left
      from subscriptions sub
     where sub.club_id = c and app_can_access_club(c)),
  f as (
    select s.*, case
        when s.status = 'sospesa' then 'sospesa'
        when s.grace_days_left < 0 then 'scaduta'
        when s.days_left < 0 then 'tolleranza'
        when s.days_left <= 30 then 'in_scadenza'
        else 'attiva' end as phase
      from s)
  select json_build_object(
    'status', f.status, 'expiresOn', f.expires_on, 'graceDays', f.grace_days,
    'graceUntil', f.grace_until, 'daysLeft', f.days_left, 'graceDaysLeft', f.grace_days_left,
    'phase', f.phase, 'readOnly', f.phase in ('sospesa', 'scaduta'),
    'blocked', f.phase in ('sospesa', 'scaduta'),
    'note', f.note, 'updatedAt', f.updated_at,
    'message', case f.phase
      when 'attiva' then null
      when 'in_scadenza' then 'Abbonamento in scadenza '
        || case f.days_left when 0 then 'oggi' when 1 then 'domani'
                            else 'tra ' || f.days_left || ' giorni' end
        || ', il ' || to_char(f.expires_on, 'DD/MM/YYYY') || '. Contatta il fornitore per il rinnovo.'
      when 'tolleranza' then 'Abbonamento scaduto il ' || to_char(f.expires_on, 'DD/MM/YYYY')
        || '. Periodo di tolleranza fino al ' || to_char(f.grace_until, 'DD/MM/YYYY') || ' ('
        || case f.grace_days_left when 0 then 'oggi' when 1 then 'domani'
                                  else 'tra ' || f.grace_days_left || ' giorni' end
        || '): dopo quella data la società non è più consultabile.'
      else app_subscription_message(c) end)
  from f
$$;

create or replace function api_subscription() returns json
language sql stable security invoker set search_path = public as $$
  select app_subscription_json(app_current_club())
$$;

-- Il vecchio nome resta: la fascia d'avviso in testata non cambia di una riga.
create or replace function api_license() returns json
language sql stable security invoker set search_path = public as $$
  select app_subscription_json(app_current_club())
$$;

/* ============================ Identità e società ========================= */

-- Chi sono, dove sto lavorando e che cosa posso. Il proprietario della piattaforma
-- non ha una riga in `app_users`: dentro una società amministra, ma resta un'altra
-- cosa, e il client lo sa (`platformOwner`).
create or replace function api_me() returns json
language sql stable security invoker set search_path = public as $$
  select case
    when app_uid() is not null then (
      select json_build_object(
        'userId', u.id, 'personId', p.id, 'email', u.email,
        'firstName', p.first_name, 'lastName', p.last_name,
        'roles', coalesce((select json_agg(r.role order by r.role) from user_roles r
                            where r.user_id = u.id), '[]'::json),
        'platformOwner', false,
        'club', (select json_build_object('id', c.id, 'name', c.name, 'slug', c.slug)
                   from clubs c where c.id = u.club_id))
      from app_users u join people p on p.id = u.person_id
      where u.id = app_uid())
    when app_is_platform_owner() then
      json_build_object(
        'userId', null, 'personId', null, 'email', app_platform_owner_email(),
        'firstName', 'Proprietario', 'lastName', 'piattaforma',
        -- Dentro una società il proprietario la amministra: il menù e i permessi
        -- del client seguono questo, ma a decidere restano le policy.
        'roles', case when app_current_club() is null then '[]'::json else json_build_array('admin') end,
        'platformOwner', true,
        'club', (select json_build_object('id', c.id, 'name', c.name, 'slug', c.slug)
                   from clubs c where c.id = app_current_club()))
    -- Identità collegata a più società e nessuna ancora scelta: esiste, ma non è
    -- ancora "dentro" nessuna. Il client la manda a scegliere.
    when app_identity_email() is not null then
      json_build_object(
        'userId', null, 'personId', null, 'email', app_identity_email(),
        'firstName', '', 'lastName', '', 'roles', '[]'::json,
        'platformOwner', false, 'club', null)
    else null end
$$;

-- Le società in cui posso entrare. Per l'utente di società è la sua (o le sue),
-- per il proprietario sono tutte: lo dice la policy di `clubs`, non questa funzione.
create or replace function api_my_clubs() returns json
language sql stable security invoker set search_path = public as $$
  select coalesce((select json_agg(json_build_object('id', c.id, 'name', c.name, 'slug', c.slug)
                                   order by lower(c.name))
                     from clubs c), '[]'::json)
$$;

-- Entrare in una società è un atto dichiarato e registrato. Da qui in poi ogni
-- policy filtra su questa scelta: cambiare l'indirizzo nel browser non sposta nulla.
create or replace function api_club_enter(p_slug text) returns json
language plpgsql security definer set search_path = public as $$
declare target_id uuid; target_name text;
begin
  if auth.uid() is null then perform api_deny(); end if;
  select c.id, c.name into target_id, target_name from clubs c where c.slug = p_slug;
  if target_id is null or not app_can_access_club(target_id) then perform api_deny(); end if;

  insert into club_sessions (auth_user_id, club_id) values (auth.uid(), target_id)
  on conflict (auth_user_id) do update set club_id = excluded.club_id, updated_at = now();

  return json_build_object('id', target_id, 'name', target_name, 'slug', p_slug);
end $$;

create or replace function api_club_leave() returns json
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then perform api_deny(); end if;
  delete from club_sessions where auth_user_id = auth.uid();
  return json_build_object('ok', true);
end $$;

/* ======================= Portale del proprietario ======================== */

-- L'elenco delle società con i contatori. DEFINER: contare gli atleti di tutte le
-- società è, per costruzione, fuori dalla RLS di una società sola. Il controllo è
-- la prima riga del corpo, e non dipende da niente che arrivi dal client.
create or replace function api_platform_clubs() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not app_is_platform_owner() then perform api_deny(); end if;
  return coalesce((
    select json_agg(json_build_object(
        'id', c.id, 'name', c.name, 'slug', c.slug, 'createdAt', c.created_at,
        'athletes', (select count(*) from people p
                      where p.club_id = c.id and p.kind = 'atleta' and not p.archived),
        'teams', (select count(*) from teams t where t.club_id = c.id),
        'admins', (select count(*) from user_roles r join app_users u on u.id = r.user_id
                    where u.club_id = c.id and r.role = 'admin' and u.active),
        'subscription', app_subscription_json(c.id))
      order by lower(c.name))
    from clubs c), '[]'::json);
end $$;

-- Creare una società: la riga, l'abbonamento e la registrazione dell'atto, insieme.
-- INVOKER: a dire di sì sono le policy di `clubs`, `subscriptions` e
-- `subscription_events`, tutte e tre riservate al proprietario della piattaforma.
create or replace function api_platform_club_create(p_name text, p_slug text,
                                                    p_expires date default null) returns json
language plpgsql security invoker set search_path = public as $$
declare new_id uuid; ends_on date := coalesce(p_expires, current_date + 365);
begin
  if not app_is_platform_owner() then perform api_deny(); end if;
  insert into clubs (name, slug) values (trim(p_name), lower(trim(p_slug))) returning id into new_id;
  insert into subscriptions (club_id, expires_on) values (new_id, ends_on);
  insert into subscription_events (club_id, action, actor_auth_user_id, expires_on)
  values (new_id, 'creata', app_auth_uid(), ends_on);
  return json_build_object('id', new_id, 'slug', lower(trim(p_slug)));
end $$;

-- Rinnovo, sospensione e riattivazione restano atti distinti (D14): rinnovare una
-- società sospesa sposta la scadenza ma non la riapre.
create or replace function api_platform_subscription(p_club uuid, p_action text,
                                                     p_expires date default null,
                                                     p_note text default null) returns json
language plpgsql security invoker set search_path = public as $$
declare hit uuid;
begin
  if not app_is_platform_owner() then perform api_deny(); end if;
  if p_action not in ('rinnovata', 'sospesa', 'riattivata') then
    raise exception 'Operazione non prevista' using errcode = '22023';
  end if;
  if p_action = 'rinnovata' and p_expires is null then
    raise exception 'Serve la nuova data di scadenza' using errcode = '22023';
  end if;

  update subscriptions s set
    expires_on = case when p_action = 'rinnovata' then p_expires else s.expires_on end,
    status     = case p_action when 'sospesa' then 'sospesa'
                               when 'riattivata' then 'attiva' else s.status end,
    note       = coalesce(p_note, s.note),
    updated_at = now()
  where s.club_id = p_club
  returning s.club_id into hit;
  if hit is null then perform api_deny(); end if;

  insert into subscription_events (club_id, action, actor_auth_user_id, expires_on, note)
  values (p_club, p_action, app_auth_uid(),
          (select expires_on from subscriptions where club_id = p_club), p_note);

  return app_subscription_json(p_club);
end $$;

/* ============================ Privilegi espliciti ======================== */

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and (p.proname like 'app\_%' or p.proname like 'api\_%')
  loop
    execute format('grant execute on function %s to app_user, authenticated', r.sig);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------
-- 9) REGISTRO DELLE MIGRAZIONI
-- Il repository e il database devono raccontare la stessa storia: senza questa
-- riga, un domani `npm run migrate` proverebbe a riapplicare M10.
-- ---------------------------------------------------------------------
insert into public.schema_migrations (version)
values ('0012_clubs.sql'), ('0013_platform_api.sql')
on conflict (version) do nothing;

-- ---------------------------------------------------------------------
-- 10) RIEPILOGO — è l'ultima tabella che vedrai nel pannello
-- ---------------------------------------------------------------------
select 'migrazioni applicate' as voce,
       string_agg(version, ', ' order by version) as valore
  from public.schema_migrations where version = any(array['0012_clubs.sql', '0013_platform_api.sql'])
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
