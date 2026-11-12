-- 0005 — Compatibilità con PostgreSQL gestito (Supabase). Nessun dato toccato,
-- nessuna tabella nuova: solo i privilegi che su un Postgres non-superutente mancano.

-- 1) Chi esegue le migrazioni deve poter assumere app_user.
--    In locale (PGlite) il proprietario è superutente e lo può già fare; su Supabase
--    `postgres` NON è superutente, quindi senza questo GRANT ogni richiesta applicativa
--    fallirebbe su `set local role app_user` con 42501.
do $$ begin
  if not pg_has_role(current_user, 'app_user', 'MEMBER') then
    execute format('grant app_user to %I', current_user);
  end if;
end $$;

-- 2) Le policy RLS chiamano le funzioni app_*: senza EXECUTE non si valutano.
--    Su PGlite l'EXECUTE arriva da PUBLIC, su un Postgres gestito non è detto.
grant execute on all functions in schema public to app_user;

-- 3) Supabase pubblica lo schema public via PostgREST ai ruoli `anon` e `authenticated`.
--    Qui NON usiamo Supabase Auth né supabase-js: l'unica via ai dati è l'API Express
--    con RLS e `app.user_id`. Quei ruoli non devono leggere nulla, oggi né domani.
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema public from %I', r);
      execute format('revoke all on all sequences in schema public from %I', r);
      execute format('revoke all on all functions in schema public from %I', r);
      execute format('revoke all on schema public from %I', r);
      execute format('alter default privileges in schema public revoke all on tables from %I', r);
      execute format('alter default privileges in schema public revoke all on sequences from %I', r);
      execute format('alter default privileges in schema public revoke all on functions from %I', r);
    end if;
  end loop;
end $$;
