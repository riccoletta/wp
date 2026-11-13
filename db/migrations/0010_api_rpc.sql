-- 0010 — Superficie dati della Data API: funzioni `api_*` chiamate con supabase.rpc().
--
-- Tutte SECURITY INVOKER: girano con i privilegi e sotto le policy RLS di chi chiama.
-- Nessuna di queste funzioni decide i permessi, come da D9: se un dato non deve essere
-- visibile, è la policy a non restituirlo. Servono a tre cose, e a nient'altro:
--   1) letture composte (dettaglio persona, dettaglio squadra, dashboard) in un giro solo;
--   2) operazioni in più passi che devono essere atomiche (attivazione stagione, upsert);
--   3) forma della risposta identica a quella della vecchia API, perché l'interfaccia
--      della FASE 1 non cambia di un campo.

-- Diniego uniforme: una UPDATE/DELETE filtrata dalla RLS non solleva errori, tocca
-- zero righe. Qui diventa lo stesso 403 che restituiva l'API Express.
create or replace function api_deny() returns void
language plpgsql as $$
begin
  raise exception 'Operazione non consentita' using errcode = '42501';
end $$;

/* =========================== Identità e licenza =========================== */

create or replace function api_me() returns json
language sql stable security invoker set search_path = public as $$
  select json_build_object(
    'userId', u.id, 'personId', p.id, 'email', u.email,
    'firstName', p.first_name, 'lastName', p.last_name,
    'roles', coalesce((select json_agg(r.role order by r.role) from user_roles r where r.user_id = u.id), '[]'::json))
  from app_users u join people p on p.id = u.person_id
  where u.id = app_uid()
$$;

-- Stato operativo DERIVATO: stesse soglie e stessi messaggi italiani di prima,
-- calcolati con `current_date` nel database (niente aritmetica di date nel browser).
create or replace function api_license() returns json
language sql stable security invoker set search_path = public as $$
  with s as (
    select l.status, l.expires_on, l.grace_days, l.note, l.updated_at,
           (l.expires_on + l.grace_days) as grace_until,
           (l.expires_on - current_date) as days_left,
           (l.expires_on + l.grace_days - current_date) as grace_days_left
      from license l),
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
    'note', f.note, 'updatedAt', f.updated_at,
    'message', case f.phase
      when 'attiva' then null
      when 'in_scadenza' then 'Licenza in scadenza '
        || case f.days_left when 0 then 'oggi' when 1 then 'domani'
                            else 'tra ' || f.days_left || ' giorni' end
        || ', il ' || to_char(f.expires_on, 'DD/MM/YYYY') || '. Contatta il fornitore per il rinnovo.'
      when 'tolleranza' then 'Licenza scaduta il ' || to_char(f.expires_on, 'DD/MM/YYYY')
        || '. Periodo di tolleranza fino al ' || to_char(f.grace_until, 'DD/MM/YYYY') || ' ('
        || case f.grace_days_left when 0 then 'oggi' when 1 then 'domani'
                                  else 'tra ' || f.grace_days_left || ' giorni' end
        || '): dopo quella data l''applicazione passa in sola lettura.'
      else app_license_message() end)
  from f
$$;

/* ================================ Persone ================================= */

create or replace function api_people_list(p_q text default '', p_kind text default '',
                                           p_archived boolean default false) returns json
language sql stable security invoker set search_path = public as $$
  select coalesce((select json_agg(json_build_object(
      'id', p.id, 'firstName', p.first_name, 'lastName', p.last_name, 'birthDate', p.birth_date,
      'email', p.email, 'phone', p.phone, 'kind', p.kind, 'archived', p.archived,
      'createdAt', p.created_at) order by lower(p.last_name), lower(p.first_name))
    from people p
   where p.archived = coalesce(p_archived, false)
     and (coalesce(p_q, '') = ''
          or lower(p.first_name || ' ' || p.last_name) like '%' || lower(p_q) || '%')
     and (coalesce(p_kind, '') = '' or p.kind = p_kind)), '[]'::json)
$$;

create or replace function api_person_get(p_id uuid) returns json
language sql stable security invoker set search_path = public as $$
  select json_build_object(
    'id', p.id, 'firstName', p.first_name, 'lastName', p.last_name, 'birthDate', p.birth_date,
    'email', p.email, 'phone', p.phone, 'kind', p.kind, 'archived', p.archived,
    'createdAt', p.created_at,
    'teams', coalesce((
      select json_agg(json_build_object('id', t.id, 'name', t.name, 'category', t.category,
                                        'season', s.name, 'seasonActive', s.is_active)
                      order by s.start_date desc, t.name)
        from team_memberships m join teams t on t.id = m.team_id join seasons s on s.id = t.season_id
       where m.person_id = p.id), '[]'::json),
    'guardians', coalesce((
      select json_agg(json_build_object('id', g2.id, 'firstName', g2.first_name, 'lastName', g2.last_name))
        from guardian_links g join people g2 on g2.id = g.guardian_person_id
       where g.minor_person_id = p.id), '[]'::json),
    'wards', coalesce((
      select json_agg(json_build_object('id', w.id, 'firstName', w.first_name, 'lastName', w.last_name))
        from guardian_links g join people w on w.id = g.minor_person_id
       where g.guardian_person_id = p.id), '[]'::json),
    'account', (select json_build_object('email', u.email, 'active', u.active)
                  from app_users u where u.person_id = p.id),
    'registrations', coalesce((
      select json_agg(json_build_object('id', r.id, 'status', r.status, 'submittedOn', r.submitted_on,
                                        'validUntil', r.valid_until, 'notes', r.notes,
                                        'seasonId', s.id, 'season', s.name)
                      order by s.start_date desc)
        from registrations r join seasons s on s.id = r.season_id
       where r.person_id = p.id), '[]'::json),
    'medical', (select json_build_object('kind', m.kind, 'expiresOn', m.expires_on, 'updatedAt', m.updated_at)
                  from medical_expiries m where m.person_id = p.id),
    'dues', coalesce((
      select json_agg(json_build_object('id', d.id, 'description', d.description,
                                        'amountCents', d.amount_cents, 'paidCents', d.paid_cents,
                                        'remainingCents', d.remaining_cents, 'status', d.status,
                                        'dueDate', d.due_date, 'season', s.name)
                      order by d.created_at desc)
        from dues_status d join seasons s on s.id = d.season_id
       where d.person_id = p.id), '[]'::json))
  from people p where p.id = p_id
$$;

create or replace function api_person_create(p jsonb) returns json
language plpgsql security invoker set search_path = public as $$
declare new_id uuid;
begin
  insert into people (first_name, last_name, birth_date, email, phone, kind)
  values (p->>'firstName', p->>'lastName', nullif(p->>'birthDate', '')::date,
          nullif(p->>'email', ''), nullif(p->>'phone', ''), coalesce(p->>'kind', 'atleta'))
  returning id into new_id;
  return json_build_object('id', new_id);
end $$;

-- Aggiornamento parziale: i campi assenti dal JSON restano com'erano.
create or replace function api_person_update(p_id uuid, p jsonb) returns json
language plpgsql security invoker set search_path = public as $$
declare hit uuid;
begin
  update people set
    first_name = coalesce(p->>'firstName', first_name),
    last_name  = coalesce(p->>'lastName', last_name),
    birth_date = coalesce(nullif(p->>'birthDate', '')::date, birth_date),
    email      = case when p ? 'email' then nullif(p->>'email', '') else email end,
    phone      = case when p ? 'phone' then nullif(p->>'phone', '') else phone end,
    kind       = coalesce(p->>'kind', kind),
    archived   = coalesce((p->>'archived')::boolean, archived)
  where id = p_id returning id into hit;
  if hit is null then perform api_deny(); end if;
  return json_build_object('id', hit);
end $$;

create or replace function api_guardian_add(p_minor uuid, p_guardian uuid) returns json
language plpgsql security invoker set search_path = public as $$
begin
  -- `do update` invece di `do nothing`: anche su riga già presente la policy di
  -- scrittura viene valutata, quindi un non-admin riceve comunque il diniego.
  insert into guardian_links (guardian_person_id, minor_person_id)
  values (p_guardian, p_minor)
  on conflict (guardian_person_id, minor_person_id)
  do update set guardian_person_id = excluded.guardian_person_id;
  return json_build_object('ok', true);
end $$;

create or replace function api_guardian_remove(p_minor uuid, p_guardian uuid) returns json
language plpgsql security invoker set search_path = public as $$
declare hit uuid;
begin
  delete from guardian_links
   where minor_person_id = p_minor and guardian_person_id = p_guardian
  returning minor_person_id into hit;
  if hit is null then perform api_deny(); end if;
  return json_build_object('ok', true);
end $$;

/* =========================== Stagioni e squadre =========================== */

create or replace function api_seasons_list() returns json
language sql stable security invoker set search_path = public as $$
  select coalesce((select json_agg(json_build_object(
      'id', s.id, 'name', s.name, 'startDate', s.start_date,
      'endDate', s.end_date, 'isActive', s.is_active) order by s.start_date desc)
    from seasons s), '[]'::json)
$$;

create or replace function api_season_create(p_name text, p_start date, p_end date) returns json
language plpgsql security invoker set search_path = public as $$
declare new_id uuid;
begin
  insert into seasons (name, start_date, end_date) values (p_name, p_start, p_end) returning id into new_id;
  return json_build_object('id', new_id);
end $$;

-- Una sola stagione attiva: spegnere le altre e accendere questa è un atto unico.
create or replace function api_season_activate(p_id uuid) returns json
language plpgsql security invoker set search_path = public as $$
declare hit uuid;
begin
  update seasons set is_active = false where is_active;
  update seasons set is_active = true where id = p_id returning id into hit;
  if hit is null then perform api_deny(); end if;
  return json_build_object('id', hit);
end $$;

create or replace function api_teams_list(p_season_id uuid default null) returns json
language sql stable security invoker set search_path = public as $$
  select coalesce((select json_agg(json_build_object(
      'id', t.id, 'name', t.name, 'category', t.category, 'seasonId', t.season_id,
      'season', s.name, 'seasonActive', s.is_active)
      order by s.start_date desc, lower(t.name))
    from teams t join seasons s on s.id = t.season_id
   where p_season_id is null or t.season_id = p_season_id), '[]'::json)
$$;

create or replace function api_team_get(p_id uuid) returns json
language sql stable security invoker set search_path = public as $$
  select json_build_object(
    'id', t.id, 'name', t.name, 'category', t.category, 'seasonId', t.season_id,
    'season', s.name, 'seasonActive', s.is_active,
    'roster', coalesce((
      select json_agg(json_build_object('id', p.id, 'firstName', p.first_name, 'lastName', p.last_name,
                                        'birthDate', p.birth_date, 'addedAt', m.added_at,
                                        'medicalExpiresOn', med.expires_on)
                      order by lower(p.last_name), lower(p.first_name))
        from team_memberships m join people p on p.id = m.person_id
        left join medical_expiries med on med.person_id = p.id
       where m.team_id = t.id), '[]'::json),
    'coaches', coalesce((
      select json_agg(json_build_object('id', p.id, 'firstName', p.first_name, 'lastName', p.last_name)
                      order by lower(p.last_name))
        from coach_assignments c join people p on p.id = c.person_id
       where c.team_id = t.id), '[]'::json))
  from teams t join seasons s on s.id = t.season_id where t.id = p_id
$$;

create or replace function api_team_create(p_name text, p_category text, p_season_id uuid) returns json
language plpgsql security invoker set search_path = public as $$
declare new_id uuid;
begin
  insert into teams (name, category, season_id)
  values (p_name, nullif(p_category, ''), p_season_id) returning id into new_id;
  return json_build_object('id', new_id);
end $$;

create or replace function api_team_delete(p_id uuid) returns json
language plpgsql security invoker set search_path = public as $$
declare hit uuid;
begin
  delete from teams where id = p_id returning id into hit;
  if hit is null then perform api_deny(); end if;
  return json_build_object('ok', true);
end $$;

create or replace function api_team_member_add(p_team uuid, p_person uuid) returns json
language plpgsql security invoker set search_path = public as $$
begin
  insert into team_memberships (team_id, person_id) values (p_team, p_person)
  on conflict (team_id, person_id) do update set team_id = excluded.team_id;
  return json_build_object('ok', true);
end $$;

create or replace function api_team_member_remove(p_team uuid, p_person uuid) returns json
language plpgsql security invoker set search_path = public as $$
declare hit uuid;
begin
  delete from team_memberships where team_id = p_team and person_id = p_person returning id into hit;
  if hit is null then perform api_deny(); end if;
  return json_build_object('ok', true);
end $$;

create or replace function api_team_coach_add(p_team uuid, p_person uuid) returns json
language plpgsql security invoker set search_path = public as $$
begin
  insert into coach_assignments (team_id, person_id) values (p_team, p_person)
  on conflict (team_id, person_id) do update set team_id = excluded.team_id;
  return json_build_object('ok', true);
end $$;

create or replace function api_team_coach_remove(p_team uuid, p_person uuid) returns json
language plpgsql security invoker set search_path = public as $$
declare hit uuid;
begin
  delete from coach_assignments where team_id = p_team and person_id = p_person returning team_id into hit;
  if hit is null then perform api_deny(); end if;
  return json_build_object('ok', true);
end $$;

/* ============================== Tesseramenti ============================== */

create or replace function api_registrations_list(p_season_id uuid default null,
                                                  p_status text default '') returns json
language sql stable security invoker set search_path = public as $$
  select coalesce((select json_agg(json_build_object(
      'id', r.id, 'status', r.status, 'submittedOn', r.submitted_on, 'validUntil', r.valid_until,
      'notes', r.notes, 'updatedAt', r.updated_at, 'personId', p.id,
      'firstName', p.first_name, 'lastName', p.last_name, 'seasonId', s.id, 'season', s.name)
      order by lower(p.last_name), lower(p.first_name))
    from registrations r join people p on p.id = r.person_id join seasons s on s.id = r.season_id
   where (p_season_id is null or r.season_id = p_season_id)
     and (coalesce(p_status, '') = '' or r.status = p_status)), '[]'::json)
$$;

-- Un tesseramento per atleta e stagione: la seconda scrittura aggiorna la prima.
create or replace function api_registration_save(p jsonb) returns json
language plpgsql security invoker set search_path = public as $$
declare new_id uuid;
begin
  insert into registrations (person_id, season_id, status, submitted_on, valid_until, notes)
  values ((p->>'personId')::uuid, (p->>'seasonId')::uuid, p->>'status',
          nullif(p->>'submittedOn', '')::date, nullif(p->>'validUntil', '')::date, nullif(p->>'notes', ''))
  on conflict (person_id, season_id) do update
    set status = excluded.status, submitted_on = excluded.submitted_on,
        valid_until = excluded.valid_until, notes = excluded.notes, updated_at = now()
  returning id into new_id;
  return json_build_object('id', new_id);
end $$;

/* ========= Certificati: solo tipo, scadenza e stato. Mai file o referti ========= */

create or replace function api_medical_list(p_filter text default '') returns json
language sql stable security invoker set search_path = public as $$
  select coalesce((select json_agg(json_build_object(
      'personId', m.person_id, 'kind', m.kind, 'expiresOn', m.expires_on, 'updatedAt', m.updated_at,
      'firstName', p.first_name, 'lastName', p.last_name,
      'daysLeft', (m.expires_on - current_date)) order by m.expires_on)
    from medical_expiries m join people p on p.id = m.person_id
   where not p.archived
     and case coalesce(p_filter, '')
           when 'scaduti' then m.expires_on < current_date
           when 'in_scadenza' then m.expires_on >= current_date and m.expires_on <= current_date + 30
           else true end), '[]'::json)
$$;

create or replace function api_medical_save(p_person uuid, p_kind text, p_expires date) returns json
language plpgsql security invoker set search_path = public as $$
declare hit uuid;
begin
  insert into medical_expiries (person_id, kind, expires_on)
  values (p_person, nullif(p_kind, ''), p_expires)
  on conflict (person_id) do update
    set kind = excluded.kind, expires_on = excluded.expires_on, updated_at = now()
  returning person_id into hit;
  return json_build_object('personId', hit);
end $$;

create or replace function api_medical_delete(p_person uuid) returns json
language plpgsql security invoker set search_path = public as $$
declare hit uuid;
begin
  delete from medical_expiries where person_id = p_person returning person_id into hit;
  if hit is null then perform api_deny(); end if;
  return json_build_object('ok', true);
end $$;

/* ======================== Quote e pagamenti manuali ======================= */

create or replace function api_dues_list(p_season_id uuid default null,
                                         p_status text default '') returns json
language sql stable security invoker set search_path = public as $$
  select coalesce((select json_agg(json_build_object(
      'id', d.id, 'description', d.description, 'amountCents', d.amount_cents,
      'paidCents', d.paid_cents, 'remainingCents', d.remaining_cents, 'status', d.status,
      'dueDate', d.due_date, 'personId', p.id, 'firstName', p.first_name, 'lastName', p.last_name,
      'seasonId', s.id, 'season', s.name)
      order by lower(p.last_name), d.due_date nulls last)
    from dues_status d join people p on p.id = d.person_id join seasons s on s.id = d.season_id
   where (p_season_id is null or d.season_id = p_season_id)
     and (coalesce(p_status, '') = '' or d.status = p_status)), '[]'::json)
$$;

create or replace function api_due_get(p_id uuid) returns json
language sql stable security invoker set search_path = public as $$
  select json_build_object(
    'id', d.id, 'description', d.description, 'amountCents', d.amount_cents,
    'paidCents', d.paid_cents, 'remainingCents', d.remaining_cents, 'status', d.status,
    'dueDate', d.due_date, 'personId', p.id, 'firstName', p.first_name, 'lastName', p.last_name,
    'season', s.name,
    'payments', coalesce((
      select json_agg(json_build_object('id', r.id, 'amountCents', r.amount_cents,
                                        'paidOn', r.paid_on, 'method', r.method, 'note', r.note)
                      order by r.paid_on, r.created_at)
        from payment_records r where r.due_id = d.id), '[]'::json))
  from dues_status d join people p on p.id = d.person_id join seasons s on s.id = d.season_id
  where d.id = p_id
$$;

create or replace function api_due_create(p jsonb) returns json
language plpgsql security invoker set search_path = public as $$
declare new_id uuid;
begin
  insert into dues (person_id, season_id, description, amount_cents, due_date)
  values ((p->>'personId')::uuid, (p->>'seasonId')::uuid, p->>'description',
          (p->>'amountCents')::int, nullif(p->>'dueDate', '')::date)
  returning id into new_id;
  return json_build_object('id', new_id);
end $$;

create or replace function api_due_delete(p_id uuid) returns json
language plpgsql security invoker set search_path = public as $$
declare hit uuid;
begin
  delete from dues where id = p_id returning id into hit;
  if hit is null then perform api_deny(); end if;
  return json_build_object('ok', true);
end $$;

-- Versamento registrato a mano dalla segreteria: nessun gateway, nessun dato di carta.
create or replace function api_payment_add(p_due uuid, p jsonb) returns json
language plpgsql security invoker set search_path = public as $$
declare new_id uuid;
begin
  insert into payment_records (due_id, amount_cents, paid_on, method, note)
  values (p_due, (p->>'amountCents')::int, coalesce(nullif(p->>'paidOn', '')::date, current_date),
          coalesce(p->>'method', 'contanti'), nullif(p->>'note', ''))
  returning id into new_id;
  return json_build_object('id', new_id);
end $$;

create or replace function api_payment_delete(p_due uuid, p_payment uuid) returns json
language plpgsql security invoker set search_path = public as $$
declare hit uuid;
begin
  delete from payment_records where id = p_payment and due_id = p_due returning id into hit;
  if hit is null then perform api_deny(); end if;
  return json_build_object('ok', true);
end $$;

/* ================================ Dashboard =============================== */

-- Contatori operativi, non un modulo di report (FASE 1). Ogni numero passa dalla
-- RLS: un allenatore conta i propri atleti, non quelli del club.
create or replace function api_dashboard() returns json
language sql stable security invoker set search_path = public as $$
  select json_build_object(
    'roles', coalesce((select json_agg(r.role order by r.role) from user_roles r
                        where r.user_id = app_uid()), '[]'::json),
    'season', (select json_build_object('id', s.id, 'name', s.name,
                                        'startDate', s.start_date, 'endDate', s.end_date)
                 from seasons s where s.is_active),
    'teams', coalesce((
      select json_agg(json_build_object('id', t.id, 'name', t.name, 'category', t.category,
                                        'season', s.name,
                                        'rosterSize', (select count(*) from team_memberships m
                                                        where m.team_id = t.id))
                      order by lower(t.name))
        from teams t join seasons s on s.id = t.season_id where s.is_active), '[]'::json),
    'counts', json_build_object(
      'medicalExpired', (select count(*) from medical_expiries m join people p on p.id = m.person_id
                          where not p.archived and m.expires_on < current_date),
      'medicalSoon', (select count(*) from medical_expiries m join people p on p.id = m.person_id
                       where not p.archived and m.expires_on >= current_date
                         and m.expires_on <= current_date + 30),
      'peopleActive', (select count(*) from people where not archived),
      'duesOpen', (select count(*) from dues_status where status <> 'saldata'),
      'duesRemainingCents', (select coalesce(sum(remaining_cents), 0) from dues_status
                              where status <> 'saldata'),
      'registrationsPending', (select count(*) from registrations r join seasons s on s.id = r.season_id
                                where s.is_active and r.status in ('da_completare', 'in_corso'))))
$$;

/* ============================ Privilegi espliciti ========================= */

-- Le funzioni appena create non sono raggiungibili da nessuno finché non lo diciamo
-- (0009 ha revocato EXECUTE a PUBLIC). `anon` resta fuori: niente USAGE sullo schema.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and (p.proname like 'app\_%' or p.proname like 'api\_%')
  loop
    execute format('grant execute on function %s to app_user, authenticated', r.sig);
  end loop;
end $$;
