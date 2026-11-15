-- 0013 — Superficie dati della piattaforma (M10b/M10c).
--
-- Due sole funzioni SECURITY DEFINER in tutto il file, e tutte e due si controllano
-- da sole prima di fare qualunque cosa:
--   * `api_club_enter` / `api_club_leave`, perché `club_sessions` non ha GRANT per
--     nessun ruolo applicativo: la società corrente non si scrive da fuori;
--   * `api_platform_clubs`, perché contare atleti e squadre di TUTTE le società è
--     per definizione fuori dalla RLS di una società sola.
-- Tutto il resto resta SECURITY INVOKER: decide la policy, come da D9.

/* ========================= Due aiutanti minuscoli ======================== */

-- `auth.uid()` e `platform_owners` non sono raggiungibili dal ruolo `authenticated`
-- (lo schema `auth` appartiene a Supabase, la tabella dei proprietari non ha GRANT
-- per nessuno). Le funzioni `api_*` SECURITY INVOKER passano di qui invece di
-- toccarli: restituiscono solo l'identità di chi sta chiamando e la sua email.
create or replace function app_auth_uid() returns uuid
language sql stable security definer set search_path = public as $$
  select auth.uid()
$$;

create or replace function app_platform_owner_email() returns text
language sql stable security definer set search_path = public as $$
  select o.email from platform_owners o where o.auth_user_id = auth.uid()
$$;

/* ===================== Stato derivato dell'abbonamento =================== */

-- Stesse soglie e stessi messaggi italiani della licenza di 0009/0010, per società.
-- DEFINER perché serve anche al proprietario sulle società in cui non è dentro, ma
-- la prima riga è un controllo d'accesso: nessuno legge l'abbonamento di una società
-- che non lo riguarda.
create or replace function app_subscription_json(c uuid) returns json
language sql stable security definer set search_path = public as $$
  with s as (
    select sub.status, sub.expires_on, sub.grace_days, sub.note, sub.updated_at,
           (sub.expires_on + sub.grace_days) as grace_until,
           (sub.expires_on - current_date) as days_left,
           (sub.expires_on + sub.grace_days - current_date) as grace_days_left
      from subscriptions sub
     where sub.club_id = c and app_can_access_club(c)),
  f as (
    select s.*, case
        when s.status = 'sospesa' then 'sospesa'
        when s.grace_days_left < 0 then 'scaduta'
        when s.days_left < 0 then 'tolleranza'
        when s.days_left <= 30 then 'in_scadenza'
        else 'attiva' end as phase
      from s)
  select json_build_object(
    'status', f.status, 'expiresOn', f.expires_on, 'graceDays', f.grace_days,
    'graceUntil', f.grace_until, 'daysLeft', f.days_left, 'graceDaysLeft', f.grace_days_left,
    'phase', f.phase, 'readOnly', f.phase in ('sospesa', 'scaduta'),
    'blocked', f.phase in ('sospesa', 'scaduta'),
    'note', f.note, 'updatedAt', f.updated_at,
    'message', case f.phase
      when 'attiva' then null
      when 'in_scadenza' then 'Abbonamento in scadenza '
        || case f.days_left when 0 then 'oggi' when 1 then 'domani'
                            else 'tra ' || f.days_left || ' giorni' end
        || ', il ' || to_char(f.expires_on, 'DD/MM/YYYY') || '. Contatta il fornitore per il rinnovo.'
      when 'tolleranza' then 'Abbonamento scaduto il ' || to_char(f.expires_on, 'DD/MM/YYYY')
        || '. Periodo di tolleranza fino al ' || to_char(f.grace_until, 'DD/MM/YYYY') || ' ('
        || case f.grace_days_left when 0 then 'oggi' when 1 then 'domani'
                                  else 'tra ' || f.grace_days_left || ' giorni' end
        || '): dopo quella data la società non è più consultabile.'
      else app_subscription_message(c) end)
  from f
$$;

create or replace function api_subscription() returns json
language sql stable security invoker set search_path = public as $$
  select app_subscription_json(app_current_club())
$$;

-- Il vecchio nome resta: la fascia d'avviso in testata non cambia di una riga.
create or replace function api_license() returns json
language sql stable security invoker set search_path = public as $$
  select app_subscription_json(app_current_club())
$$;

/* ============================ Identità e società ========================= */

-- Chi sono, dove sto lavorando e che cosa posso. Il proprietario della piattaforma
-- non ha una riga in `app_users`: dentro una società amministra, ma resta un'altra
-- cosa, e il client lo sa (`platformOwner`).
create or replace function api_me() returns json
language sql stable security invoker set search_path = public as $$
  select case
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
    else null end
$$;

-- Le società in cui posso entrare. Per l'utente di società è la sua (o le sue),
-- per il proprietario sono tutte: lo dice la policy di `clubs`, non questa funzione.
create or replace function api_my_clubs() returns json
language sql stable security invoker set search_path = public as $$
  select coalesce((select json_agg(json_build_object('id', c.id, 'name', c.name, 'slug', c.slug)
                                   order by lower(c.name))
                     from clubs c), '[]'::json)
$$;

-- Entrare in una società è un atto dichiarato e registrato. Da qui in poi ogni
-- policy filtra su questa scelta: cambiare l'indirizzo nel browser non sposta nulla.
create or replace function api_club_enter(p_slug text) returns json
language plpgsql security definer set search_path = public as $$
declare target_id uuid; target_name text;
begin
  if auth.uid() is null then perform api_deny(); end if;
  select c.id, c.name into target_id, target_name from clubs c where c.slug = p_slug;
  if target_id is null or not app_can_access_club(target_id) then perform api_deny(); end if;

  insert into club_sessions (auth_user_id, club_id) values (auth.uid(), target_id)
  on conflict (auth_user_id) do update set club_id = excluded.club_id, updated_at = now();

  return json_build_object('id', target_id, 'name', target_name, 'slug', p_slug);
end $$;

create or replace function api_club_leave() returns json
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then perform api_deny(); end if;
  delete from club_sessions where auth_user_id = auth.uid();
  return json_build_object('ok', true);
end $$;

/* ======================= Portale del proprietario ======================== */

-- L'elenco delle società con i contatori. DEFINER: contare gli atleti di tutte le
-- società è, per costruzione, fuori dalla RLS di una società sola. Il controllo è
-- la prima riga del corpo, e non dipende da niente che arrivi dal client.
create or replace function api_platform_clubs() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not app_is_platform_owner() then perform api_deny(); end if;
  return coalesce((
    select json_agg(json_build_object(
        'id', c.id, 'name', c.name, 'slug', c.slug, 'createdAt', c.created_at,
        'athletes', (select count(*) from people p
                      where p.club_id = c.id and p.kind = 'atleta' and not p.archived),
        'teams', (select count(*) from teams t where t.club_id = c.id),
        'admins', (select count(*) from user_roles r join app_users u on u.id = r.user_id
                    where u.club_id = c.id and r.role = 'admin' and u.active),
        'subscription', app_subscription_json(c.id))
      order by lower(c.name))
    from clubs c), '[]'::json);
end $$;

-- Creare una società: la riga, l'abbonamento e la registrazione dell'atto, insieme.
-- INVOKER: a dire di sì sono le policy di `clubs`, `subscriptions` e
-- `subscription_events`, tutte e tre riservate al proprietario della piattaforma.
create or replace function api_platform_club_create(p_name text, p_slug text,
                                                    p_expires date default null) returns json
language plpgsql security invoker set search_path = public as $$
declare new_id uuid; ends_on date := coalesce(p_expires, current_date + 365);
begin
  if not app_is_platform_owner() then perform api_deny(); end if;
  insert into clubs (name, slug) values (trim(p_name), lower(trim(p_slug))) returning id into new_id;
  insert into subscriptions (club_id, expires_on) values (new_id, ends_on);
  insert into subscription_events (club_id, action, actor_auth_user_id, expires_on)
  values (new_id, 'creata', app_auth_uid(), ends_on);
  return json_build_object('id', new_id, 'slug', lower(trim(p_slug)));
end $$;

-- Rinnovo, sospensione e riattivazione restano atti distinti (D14): rinnovare una
-- società sospesa sposta la scadenza ma non la riapre.
create or replace function api_platform_subscription(p_club uuid, p_action text,
                                                     p_expires date default null,
                                                     p_note text default null) returns json
language plpgsql security invoker set search_path = public as $$
declare hit uuid;
begin
  if not app_is_platform_owner() then perform api_deny(); end if;
  if p_action not in ('rinnovata', 'sospesa', 'riattivata') then
    raise exception 'Operazione non prevista' using errcode = '22023';
  end if;
  if p_action = 'rinnovata' and p_expires is null then
    raise exception 'Serve la nuova data di scadenza' using errcode = '22023';
  end if;

  update subscriptions s set
    expires_on = case when p_action = 'rinnovata' then p_expires else s.expires_on end,
    status     = case p_action when 'sospesa' then 'sospesa'
                               when 'riattivata' then 'attiva' else s.status end,
    note       = coalesce(p_note, s.note),
    updated_at = now()
  where s.club_id = p_club
  returning s.club_id into hit;
  if hit is null then perform api_deny(); end if;

  insert into subscription_events (club_id, action, actor_auth_user_id, expires_on, note)
  values (p_club, p_action, app_auth_uid(),
          (select expires_on from subscriptions where club_id = p_club), p_note);

  return app_subscription_json(p_club);
end $$;

/* ============================ Privilegi espliciti ======================== */

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and (p.proname like 'app\_%' or p.proname like 'api\_%')
  loop
    execute format('grant execute on function %s to app_user, authenticated', r.sig);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
