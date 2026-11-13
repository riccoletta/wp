-- 0011 — L'account applicativo non custodisce più una password.
--
-- Le credenziali vivono in Supabase Auth: `app_users` conserva solo il legame fra
-- la persona in anagrafica e l'identità Supabase. Gli hash `scrypt` già presenti NON
-- vengono cancellati qui (lo farà il piano di pulizia, rivisto a parte): restano in
-- tabella ma non sono leggibili da nessun client, perché 0009 concede la SELECT per
-- colonna e `password_hash` non è fra quelle.
alter table app_users alter column password_hash drop not null;

comment on column app_users.password_hash is
  'Legacy: hash scrypt dell''autenticazione precedente a Supabase Auth. Non più scritto, '
  'non esposto dalla Data API, da rimuovere con il piano di pulizia.';

comment on column app_users.auth_user_id is
  'Identità Supabase Auth collegata a questo utente applicativo. Unica, può essere nulla '
  'per gli account creati prima della migrazione e non ancora reinvitati.';

-- Le Edge Function privilegiate girano come `service_role`. 0009 ha revocato EXECUTE
-- a PUBLIC su tutto lo schema: senza questo GRANT esplicito il ruolo di servizio non
-- potrebbe nemmeno leggere lo stato derivato della licenza. Resta il minimo che serve:
-- lo stato della licenza e le letture composte, non un potere nuovo (service_role ha
-- già accesso alle tabelle).
do $$
declare r record;
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    for r in
      select p.oid::regprocedure as sig from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and (p.proname like 'app\_%' or p.proname like 'api\_%')
    loop
      execute format('grant execute on function %s to service_role', r.sig);
    end loop;
  end if;
end $$;

-- PostgREST tiene in cache lo schema: senza questo segnale le funzioni appena create
-- non sarebbero raggiungibili finché non si riavvia. Fuori da Supabase è un no-op.
notify pgrst, 'reload schema';
