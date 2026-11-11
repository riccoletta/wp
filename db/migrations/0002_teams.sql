-- M1 — Stagioni, squadre, roster, assegnazioni allenatori.

create table seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) > 0),
  start_date date not null,
  end_date date not null,
  is_active boolean not null default false,
  check (end_date > start_date)
);
create unique index seasons_single_active_idx on seasons (is_active) where is_active;

create table teams (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  category text,
  unique (season_id, name)
);

create table team_memberships (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  added_at timestamptz not null default now(),
  unique (team_id, person_id)
);

create table coach_assignments (
  team_id uuid not null references teams(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  primary key (team_id, person_id)
);

-- Squadre di cui l'utente corrente è allenatore.
create function app_coached_team_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select c.team_id from coach_assignments c where c.person_id = app_person_id()
$$;

-- Un allenatore vede anche gli atleti delle proprie squadre.
create or replace function app_can_see_person(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p = app_person_id()
      or exists (select 1 from guardian_links g
                  where g.guardian_person_id = app_person_id()
                    and g.minor_person_id = p)
      or exists (select 1 from team_memberships m
                  where m.person_id = p
                    and m.team_id in (select app_coached_team_ids()))
      or exists (select 1 from coach_assignments c
                  where c.person_id = p
                    and c.team_id in (select app_coached_team_ids()))
$$;

-- Squadre visibili: admin tutte; allenatore le proprie; atleta/tutore quelle
-- in cui gioca lui o un minore collegato.
create function app_can_see_team(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select t in (select app_coached_team_ids())
      or exists (select 1 from team_memberships m
                  where m.team_id = t
                    and (m.person_id = app_person_id()
                         or m.person_id in (select g.minor_person_id from guardian_links g
                                             where g.guardian_person_id = app_person_id())))
$$;

alter table seasons           enable row level security;
alter table teams             enable row level security;
alter table team_memberships  enable row level security;
alter table coach_assignments enable row level security;

grant select, insert, update, delete on seasons, teams, team_memberships, coach_assignments to app_user;

-- Le stagioni sono anagrafica comune: lettura a tutti gli utenti, scrittura alla segreteria.
create policy seasons_read on seasons for select to app_user using (true);
create policy seasons_write on seasons for all to app_user
  using (app_is_admin()) with check (app_is_admin());

create policy teams_read on teams for select to app_user
  using (app_is_admin() or app_can_see_team(id));
create policy teams_write on teams for all to app_user
  using (app_is_admin()) with check (app_is_admin());

create policy memberships_read on team_memberships for select to app_user
  using (app_is_admin() or app_can_see_team(team_id));
create policy memberships_write on team_memberships for all to app_user
  using (app_is_admin()) with check (app_is_admin());

create policy coach_assignments_read on coach_assignments for select to app_user
  using (app_is_admin() or app_can_see_team(team_id));
create policy coach_assignments_write on coach_assignments for all to app_user
  using (app_is_admin()) with check (app_is_admin());
