-- 0014 — Un'identità può essere sia proprietario della piattaforma sia admin di società.
-- La risposta di api_me deve dare priorità a platform_owners: altrimenti /admin
-- è irraggiungibile per il proprietario già registrato nella segreteria del club.
-- Migrazione solo di funzione (nessun dato, GRANT o policy modificati).
-- Riapplicabile: sul progetto pnm la stessa correzione è già stata eseguita
-- manualmente tramite Supabase SQL Editor.

create or replace function api_me() returns json
language sql stable security invoker set search_path = public as $$
  select case
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
    -- Identità collegata a più società e nessuna ancora scelta: esiste, ma non è
    -- ancora "dentro" nessuna. Il client la manda a scegliere.
    when app_identity_email() is not null then
      json_build_object(
        'userId', null, 'personId', null, 'email', app_identity_email(),
        'firstName', '', 'lastName', '', 'roles', '[]'::json,
        'platformOwner', false, 'club', null)
    else null end
$$;

notify pgrst, 'reload schema';
