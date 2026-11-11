-- M0 — Identità, persone, ruoli, inviti, sessioni. RLS attiva da subito.

-- Ruolo applicativo: ogni richiesta HTTP gira con SET LOCAL ROLE app_user,
-- quindi le policy RLS sono l'unica fonte di verità dei permessi.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_user') then
    create role app_user nologin;
  end if;
end $$;

create table people (
  id uuid primary key default gen_random_uuid(),
  first_name text not null check (length(trim(first_name)) > 0),
  last_name  text not null check (length(trim(last_name)) > 0),
  birth_date date,
  email text,
  phone text,
  kind text not null default 'atleta' check (kind in ('atleta','socio','staff')),
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index people_last_name_idx on people (lower(last_name));

create table app_users (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null unique references people(id) on delete cascade,
  email text not null,
  password_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index app_users_email_idx on app_users (lower(email));

create table user_roles (
  user_id uuid not null references app_users(id) on delete cascade,
  role text not null check (role in ('admin','coach','athlete','guardian')),
  primary key (user_id, role)
);

create table invites (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete cascade,
  email text not null,
  roles text[] not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create table sessions (
  token_hash text primary key,
  user_id uuid not null references app_users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table guardian_links (
  guardian_person_id uuid not null references people(id) on delete cascade,
  minor_person_id    uuid not null references people(id) on delete cascade,
  primary key (guardian_person_id, minor_person_id),
  check (guardian_person_id <> minor_person_id)
);

-- Helper SECURITY DEFINER: valutano i permessi scavalcando la RLS,
-- così le policy non ricorrono su se stesse.
create function app_uid() returns uuid language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create function app_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_roles r where r.user_id = app_uid() and r.role = 'admin')
$$;

create function app_person_id() returns uuid
language sql stable security definer set search_path = public as $$
  select u.person_id from app_users u where u.id = app_uid()
$$;

-- Persone visibili a chi non è admin: se stesso e i minori collegati come tutore.
-- Gli atleti delle squadre allenate si aggiungono nella migrazione 0002.
create function app_can_see_person(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p = app_person_id()
      or exists (select 1 from guardian_links g
                  where g.guardian_person_id = app_person_id()
                    and g.minor_person_id = p)
$$;

alter table people         enable row level security;
alter table app_users      enable row level security;
alter table user_roles     enable row level security;
alter table invites        enable row level security;
alter table sessions       enable row level security;
alter table guardian_links enable row level security;

grant usage on schema public to app_user;
grant select, insert, update, delete on people, guardian_links, invites to app_user;
grant select on app_users, user_roles to app_user;

create policy people_read on people for select to app_user
  using (app_is_admin() or app_can_see_person(id));
create policy people_write on people for all to app_user
  using (app_is_admin()) with check (app_is_admin());

create policy app_users_read on app_users for select to app_user
  using (app_is_admin() or id = app_uid());
create policy user_roles_read on user_roles for select to app_user
  using (app_is_admin() or user_id = app_uid());

create policy invites_admin on invites for all to app_user
  using (app_is_admin()) with check (app_is_admin());

create policy guardian_links_read on guardian_links for select to app_user
  using (app_is_admin() or guardian_person_id = app_person_id());
create policy guardian_links_write on guardian_links for all to app_user
  using (app_is_admin()) with check (app_is_admin());

-- sessions: nessuna policy per app_user. Le sessioni si leggono e scrivono
-- solo dal percorso di autenticazione, che gira come proprietario del db.
