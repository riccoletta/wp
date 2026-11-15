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
