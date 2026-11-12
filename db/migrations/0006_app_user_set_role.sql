-- 0006 — Il ruolo delle migrazioni deve poter *assumere* app_user, non solo esserne membro.
--
-- Diagnosi sul Postgres gestito (Supabase, PG16+): la connessione applicativa e quella
-- delle migrazioni sono lo stesso ruolo `postgres`, non superutente ma con CREATEROLE.
-- `app_user` risultava già membro:
--     pg_auth_members: member=postgres, grantor=supabase_admin,
--                      admin_option=true, inherit_option=false, set_option=false
-- Da PostgreSQL 16 la membership ha opzioni separate e la concessione implicita al
-- creatore del ruolo arriva con SET FALSE: `pg_has_role(current_user,'app_user','MEMBER')`
-- dice true (per questo 0005 saltava il GRANT) ma `set local role app_user` esce 42501.
--
-- Rimedio minimo: ri-concedere la membership con SET TRUE. INHERIT resta FALSE, così
-- il ruolo delle migrazioni non eredita passivamente i privilegi applicativi: li assume
-- solo quando lo dichiara. Nessuna policy toccata, nessun superutente, niente a PUBLIC.
do $$
begin
  if current_setting('server_version_num')::int >= 160000 then
    execute format('grant app_user to %I with inherit false, set true', current_user);
  elsif not pg_has_role(current_user, 'app_user', 'MEMBER') then
    -- Prima della 16 la membership implica già SET ROLE.
    execute format('grant app_user to %I', current_user);
  end if;
end $$;
