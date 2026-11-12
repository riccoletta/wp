-- 0007 — Ruolo di esecuzione dell'API a privilegio minimo.
--
-- Finora l'API si collegava con il ruolo delle migrazioni (su Supabase `postgres`:
-- proprietario dello schema, quindi esente dalla RLS e capace di DDL). In produzione
-- il processo che serve le richieste non deve avere quei poteri: `app_runtime` può
-- soltanto (a) assumere `app_user`, da cui passa tutto il traffico applicativo sotto
-- RLS, e (b) eseguire le poche query di sistema che una sessione non può fare da sé
-- (login, sessioni, inviti, stato licenza).
--
-- LOGIN e password NON stanno qui: si impostano a mano sul database (vedi README),
-- così nel repository non finisce nessun segreto.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_runtime') then
    -- noinherit: i privilegi applicativi li ottiene solo dichiarando `set role`.
    create role app_runtime nologin noinherit;
  end if;
end $$;

do $$ begin
  execute format('grant connect on database %I to app_runtime', current_database());
end $$;
grant usage on schema public to app_runtime;

-- Può assumere il ruolo applicativo (da PG16 serve l'opzione SET esplicita, cfr. 0006).
grant app_user to app_runtime with inherit false, set true;

-- Privilegi di sistema: esattamente le tabelle toccate da `asSystem`, nient'altro.
-- Nessun privilegio su squadre, tesseramenti, certificati, quote: quei dati passano
-- solo da `app_user` e dalle sue policy.
grant select, insert on app_users    to app_runtime;
grant select, insert on user_roles   to app_runtime;
grant select, update on invites      to app_runtime;
grant select, insert, delete on sessions to app_runtime;
grant select on people               to app_runtime;
grant select, update on license      to app_runtime;

-- `app_runtime` non è proprietario delle tabelle, quindi la RLS si applica anche a lui:
-- senza una policy esplicita non vedrebbe nemmeno la propria sessione. Le policy di
-- `app_user` restano intatte: queste valgono solo per il ruolo di sistema.
drop policy if exists sys_sessions on sessions;
create policy sys_sessions on sessions for all to app_runtime using (true) with check (true);

drop policy if exists sys_app_users on app_users;
create policy sys_app_users on app_users for all to app_runtime using (true) with check (true);

drop policy if exists sys_user_roles on user_roles;
create policy sys_user_roles on user_roles for all to app_runtime using (true) with check (true);

drop policy if exists sys_invites on invites;
create policy sys_invites on invites for all to app_runtime using (true) with check (true);

-- Sulle persone il ruolo di sistema legge soltanto: serve a dire chi è l'utente collegato.
drop policy if exists sys_people_read on people;
create policy sys_people_read on people for select to app_runtime using (true);

-- La licenza è scrivibile solo dal canale del proprietario, che gira come sistema.
drop policy if exists sys_license on license;
create policy sys_license on license for all to app_runtime using (true) with check (true);
