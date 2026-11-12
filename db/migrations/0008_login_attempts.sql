-- 0008 — Freno ai tentativi di accesso. Infrastruttura di autenticazione, non un dato
-- del club: nessun ruolo applicativo la vede, solo il ruolo di sistema la aggiorna.
-- Nessun dato personale oltre all'email già usata per tentare l'accesso.
create table if not exists login_attempts (
  key text primary key,
  attempts integer not null default 0,
  first_at timestamptz not null default now(),
  blocked_until timestamptz
);

alter table login_attempts enable row level security;

-- Nessuna policy per app_user e nessun GRANT: la tabella non esiste, per l'applicazione.
grant select, insert, update, delete on login_attempts to app_runtime;
drop policy if exists sys_login_attempts on login_attempts;
create policy sys_login_attempts on login_attempts for all to app_runtime using (true) with check (true);
