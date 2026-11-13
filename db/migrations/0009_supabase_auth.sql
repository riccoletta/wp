-- 0009 — Identità Supabase Auth e apertura controllata della Data API.
--
-- Fino a qui l'identità arrivava al database come `app.user_id`, impostata dall'API Express
-- dentro la transazione. Da qui arriva da Supabase Auth come `auth.uid()`, e il client parla
-- con PostgREST come ruolo `authenticated`.
--
-- Migrazione ADDITIVA: nessuna tabella creata da zero, nessun dato toccato, nessun reset.
-- Le policy esistenti non vengono riscritte nella sostanza: cambia *chi* le attiva
-- (`authenticated` oltre ad `app_user`) e da dove arriva l'identità (`app_uid()`).

/* ---------------------------------------------------------------------------
   1) `auth.uid()` anche fuori da Supabase.
   Su Supabase lo schema `auth` esiste già: qui non si tocca nulla. Su PGlite
   (sviluppo e test) non esiste, quindi lo creiamo leggendo la stessa variabile
   di sessione che PostgREST popola dal JWT. Stesso SQL ovunque, come da D7.
--------------------------------------------------------------------------- */
-- I ruoli della Data API esistono già su Supabase; fuori da Supabase vanno creati,
-- altrimenti le GRANT e le policy qui sotto non si potrebbero nemmeno scrivere.
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin noinherit', r);
    end if;
  end loop;
end $$;

do $$
begin
  if to_regnamespace('auth') is null then
    execute 'create schema auth';
    -- Stessa semantica di Supabase: il `sub` esce dai claim del JWT che PostgREST
    -- deposita in `request.jwt.claims`.
    execute 'create function auth.uid() returns uuid language sql stable as '
         || '$b$ select nullif(coalesce('
         || 'nullif(current_setting(''request.jwt.claims'', true), '''')::jsonb ->> ''sub'', '
         || 'nullif(current_setting(''request.jwt.claim.sub'', true), '''')), '''')::uuid $b$';
    execute 'create function auth.jwt() returns jsonb language sql stable as '
         || '$b$ select coalesce(nullif(current_setting(''request.jwt.claims'', true), '''')::jsonb, ''{}''::jsonb) $b$';
  end if;
end $$;

/* ---------------------------------------------------------------------------
   2) Mappa fra l'identità Supabase e l'utente applicativo già esistente.
   Gli id applicativi, le persone, i ruoli e i legami tutore↔minore restano quelli:
   si aggiunge solo il riferimento. Le password `scrypt` NON vengono copiate in
   Supabase Auth: ogni utente esistente passa da invito o recupero password.
--------------------------------------------------------------------------- */
alter table app_users add column if not exists auth_user_id uuid;
create unique index if not exists app_users_auth_user_idx on app_users (auth_user_id)
  where auth_user_id is not null;

-- La chiave esterna verso `auth.users` è un di più: su Supabase quella tabella
-- appartiene a `supabase_auth_admin` e il ruolo delle migrazioni può non avere
-- REFERENCES. Se non si può, l'indice unico sopra resta comunque a garantire che
-- una identità Supabase non venga collegata a due utenti applicativi.
do $$
begin
  if to_regclass('auth.users') is not null
     and not exists (select 1 from pg_constraint where conname = 'app_users_auth_user_fk') then
    begin
      alter table app_users
        add constraint app_users_auth_user_fk
        foreign key (auth_user_id) references auth.users(id) on delete set null;
    exception when insufficient_privilege then
      raise notice 'app_users_auth_user_fk non creata: manca REFERENCES su auth.users (non bloccante)';
    end;
  end if;
end $$;

/* ---------------------------------------------------------------------------
   3) `app_uid()` risolve l'identità da Supabase Auth.
   Tutto il resto delle policy (app_is_admin, app_person_id, app_can_see_*) resta
   invariato: dipendono da app_uid(), non da come ci si è autenticati.

   Il ripiego su `app.user_id` serve soltanto durante la transizione, per i ruoli
   che NON passano dalla Data API (l'API Express, le migrazioni, gli script). È
   irraggiungibile da un client PostgREST: se la richiesta porta un JWT (claims
   presenti) e non ha un `sub` valido, l'identità è nulla e basta.
--------------------------------------------------------------------------- */
create or replace function app_uid() returns uuid
language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is not null then
      (select u.id from public.app_users u where u.auth_user_id = auth.uid() and u.active)
    when coalesce(current_setting('request.jwt.claims', true), '') <> '' then null
    else nullif(current_setting('app.user_id', true), '')::uuid
  end
$$;

/* ---------------------------------------------------------------------------
   4) La licenza diventa un vincolo del database, non solo un middleware.
   Stato DERIVATO da scadenza + tolleranza + sospensione (D10, D13): nessun campo
   "sola lettura" scrivibile. Un utente autenticato che chiama la REST API a mano
   incontra lo stesso muro dell'interfaccia.
--------------------------------------------------------------------------- */
create or replace function app_license_readonly() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select l.status = 'sospesa' or (l.expires_on + l.grace_days) < current_date from license l),
    false)
$$;

create or replace function app_license_message() returns text
language sql stable security definer set search_path = public as $$
  select case
    when l.status = 'sospesa' then
      'Licenza sospesa. L''applicazione è in sola lettura: i dati restano consultabili, '
      || 'ma non modificabili. Contatta il fornitore per la riattivazione.'
    else
      'Licenza scaduta il ' || to_char(l.expires_on, 'DD/MM/YYYY')
      || ' e tolleranza conclusa il ' || to_char(l.expires_on + l.grace_days, 'DD/MM/YYYY')
      || '. L''applicazione è in sola lettura: i dati restano consultabili, ma non modificabili. '
      || 'Contatta il fornitore per il rinnovo.'
  end from license l
$$;

-- Unico predicato di scrittura per tutti i dati del club: in FASE 1 scrive solo la
-- segreteria. L'ordine di valutazione è esplicito, così chi non è admin riceve un
-- semplice diniego e non il messaggio della licenza.
create or replace function app_can_write() returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if not app_is_admin() then
    return false;
  end if;
  if app_license_readonly() then
    raise exception '%', app_license_message() using errcode = 'P0001';
  end if;
  return true;
end
$$;

/* ---------------------------------------------------------------------------
   5) Policy: lettura estesa ad `authenticated`, scrittura divisa per comando.
   Le vecchie policy `for all` applicavano la clausola USING anche alla SELECT:
   mettendoci dentro il controllo della licenza avremmo nascosto i dati invece di
   bloccarne la modifica. Qui insert/update/delete sono separate dalla lettura.
--------------------------------------------------------------------------- */
do $$
declare
  club_tables text[] := array[
    'people', 'guardian_links', 'seasons', 'teams', 'team_memberships',
    'coach_assignments', 'registrations', 'medical_expiries', 'dues', 'payment_records'];
  read_tables text[] := club_tables || array['app_users', 'user_roles', 'license'];
  r record;
  t text;
begin
  -- 5a) le policy di sola lettura valgono anche per il ruolo della Data API.
  for r in
    select tablename, policyname from pg_policies
     where schemaname = 'public' and cmd = 'SELECT'
       and 'app_user' = any(roles) and tablename = any(read_tables)
  loop
    execute format('alter policy %I on public.%I to app_user, authenticated', r.policyname, r.tablename);
  end loop;

  -- 5b) via le policy `for all` di scrittura sui dati del club.
  for r in
    select tablename, policyname from pg_policies
     where schemaname = 'public' and cmd = 'ALL'
       and 'app_user' = any(roles) and tablename = any(club_tables)
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;

  -- 5c) insert/update/delete esplicite, con licenza e ruolo admin nello stesso predicato.
  foreach t in array club_tables loop
    execute format(
      'create policy %I on public.%I for insert to app_user, authenticated with check (public.app_can_write())',
      t || '_ins', t);
    execute format(
      'create policy %I on public.%I for update to app_user, authenticated '
      || 'using (public.app_is_admin()) with check (public.app_can_write())',
      t || '_upd', t);
    execute format(
      'create policy %I on public.%I for delete to app_user, authenticated using (public.app_can_write())',
      t || '_del', t);
  end loop;
end $$;

/* ---------------------------------------------------------------------------
   6) Privilegi della Data API, espliciti e minimi.
   `anon` resta senza USAGE sullo schema: un utente anonimo non raggiunge nulla.
   `sessions`, `login_attempts` e `invites` non vengono mai esposti.
--------------------------------------------------------------------------- */
grant usage on schema public to authenticated;

grant select                 on seasons, teams, team_memberships, coach_assignments to authenticated;
grant select                 on people, guardian_links, registrations, medical_expiries to authenticated;
grant select                 on dues, payment_records, dues_status, license, user_roles to authenticated;

grant insert, update         on people, seasons, registrations to authenticated;
grant insert, delete         on guardian_links, teams, team_memberships, coach_assignments to authenticated;
grant insert, delete         on dues, payment_records to authenticated;
grant insert, update, delete on medical_expiries to authenticated;

-- `password_hash` non esce dalla Data API nemmeno per l'admin: GRANT per colonna.
-- (Gli hash `scrypt` restano in tabella finché il piano di pulizia non li rimuove,
--  ma non sono leggibili da nessun client.)
grant select (id, person_id, email, active, auth_user_id, created_at) on app_users to authenticated;

-- `user_roles` è in sola lettura per chiunque passi dalla Data API: nessun utente
-- può assegnarsi un ruolo né modificare la propria mappatura. Le assegnazioni
-- passano dalla Edge Function degli inviti, che gira con la chiave di servizio.
-- (nessun GRANT di scrittura, qui e in nessun'altra migrazione)

/* ---------------------------------------------------------------------------
   7) EXECUTE esplicito. PostgreSQL concede EXECUTE a PUBLIC per default: senza
   questa revoca, ogni funzione futura nello schema `public` diventerebbe un
   endpoint RPC per chiunque sia autenticato.
--------------------------------------------------------------------------- */
revoke execute on all functions in schema public from public;
grant execute on all functions in schema public to app_user;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and (p.proname like 'app\_%' or p.proname like 'api\_%')
  loop
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

-- Cintura e bretelle: `anon` non deve avere nulla, oggi né dopo questa migrazione.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon';
    execute 'revoke all on all sequences in schema public from anon';
    execute 'revoke all on all functions in schema public from anon';
    execute 'revoke all on schema public from anon';
  end if;
end $$;
