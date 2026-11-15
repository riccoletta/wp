-- =====================================================================
-- M10 · PASSO 1 — ISPEZIONE (SOLA LETTURA)
--
-- Da incollare nel SQL Editor di Supabase PRIMA di migrare.
-- Non scrive niente nei dati: crea solo una tabella temporanea di sessione
-- per poter mostrare tutto in un'unica tabella di risultati.
--
-- Serve a due cose: sapere da dove si parte, e avere i numeri da riportare
-- nello script di verifica (PASSO 3), che è il confronto prima/dopo.
-- =====================================================================

drop table if exists ispezione;
create temp table ispezione (ordine int, sezione text, voce text, valore text);

do $$
declare
  t text;
  n bigint;
  r record;
begin
  -- 1) Dove siamo
  insert into ispezione
  select 1, 'ambiente', 'database', current_database()
  union all select 1, 'ambiente', 'ruolo', current_user
  union all select 1, 'ambiente', 'versione', split_part(version(), ' on ', 1);

  -- 2) Storia dello schema
  if to_regclass('public.schema_migrations') is not null then
    insert into ispezione
    select 2, 'migrazioni', m.version, to_char(m.applied_at, 'DD/MM/YYYY HH24:MI')
      from public.schema_migrations m order by m.version;
  else
    insert into ispezione values (2, 'migrazioni', 'schema_migrations', 'ASSENTE');
  end if;

  -- 3) Quante righe, tabella per tabella. Questi sono i numeri da riportare
  --    nel PASSO 3: dopo la migrazione devono essere identici.
  foreach t in array array['people','app_users','user_roles','guardian_links','seasons','teams',
                           'team_memberships','coach_assignments','registrations','medical_expiries',
                           'dues','payment_records','license','invites','sessions','login_attempts',
                           'clubs','subscriptions','platform_owners','club_sessions'] loop
    if to_regclass('public.' || t) is null then
      insert into ispezione values (3, 'conteggi', t, 'tabella non presente');
    else
      execute format('select count(*) from public.%I', t) into n;
      insert into ispezione values (3, 'conteggi', t, n::text);
    end if;
  end loop;

  -- 4) Relazioni: quello che dopo la migrazione dovrà risultare uguale
  for r in select tm.name, count(m.*) as atleti
             from public.teams tm left join public.team_memberships m on m.team_id = tm.id
            group by tm.id, tm.name order by tm.name loop
    insert into ispezione values (4, 'rose', r.name, r.atleti::text || ' atleti');
  end loop;

  for r in select tm.name, count(c.*) as allenatori
             from public.teams tm left join public.coach_assignments c on c.team_id = tm.id
            group by tm.id, tm.name order by tm.name loop
    insert into ispezione values (4, 'allenatori', r.name, r.allenatori::text);
  end loop;

  for r in select status, count(*) as n from public.registrations group by status order by status loop
    insert into ispezione values (4, 'tesseramenti', r.status, r.n::text);
  end loop;

  insert into ispezione
  select 4, 'importi', 'dovuto (quote)', coalesce(sum(amount_cents), 0)::text || ' centesimi' from public.dues
  union all
  select 4, 'importi', 'incassato (versamenti)', coalesce(sum(amount_cents), 0)::text || ' centesimi'
    from public.payment_records
  union all
  select 4, 'importi', 'certificati registrati', count(*)::text from public.medical_expiries
  union all
  select 4, 'importi', 'legami tutore-minore', count(*)::text from public.guardian_links;

  -- 5) Chi può entrare: account, ruoli, identità Supabase
  for r in select u.email, u.active, (u.auth_user_id is not null) as collegato,
                  coalesce((select string_agg(x.role, '+' order by x.role)
                              from public.user_roles x where x.user_id = u.id), 'nessun ruolo') as ruoli
             from public.app_users u order by u.email loop
    insert into ispezione values (5, 'account', r.email,
      r.ruoli || (case when r.collegato then ' · identità Supabase collegata'
                       else ' · NESSUNA identità Supabase' end)
               || (case when r.active then '' else ' · DISATTIVATO' end));
  end loop;

  if to_regclass('auth.users') is not null then
    begin
      for r in select a.email, (a.last_sign_in_at is not null) as entrato from auth.users a order by a.email loop
        insert into ispezione values (5, 'identità Supabase Auth', r.email,
          case when r.entrato then 'ha già fatto accesso' else 'mai entrata' end);
      end loop;
    exception when insufficient_privilege then
      insert into ispezione values (5, 'identità Supabase Auth', 'lettura', 'NEGATA a questo ruolo');
    end;
  end if;

  -- 6) Licenza unica (pre-M10): diventerà l'abbonamento della prima società
  if to_regclass('public.license') is not null then
    insert into ispezione
    select 6, 'licenza', 'stato', l.status from public.license l
    union all select 6, 'licenza', 'scadenza', l.expires_on::text from public.license l
    union all select 6, 'licenza', 'tolleranza', l.grace_days::text || ' giorni' from public.license l;
  end if;

  -- 7) M10 è già qui?
  foreach t in array array['clubs','subscriptions','platform_owners','club_sessions','subscription_events'] loop
    insert into ispezione values (7, 'stato M10', t,
      case when to_regclass('public.' || t) is null then 'non ancora creata' else 'già presente' end);
  end loop;
  insert into ispezione values (7, 'stato M10', 'club_id su people',
    case when exists (select 1 from information_schema.columns
                       where table_schema = 'public' and table_name = 'people' and column_name = 'club_id')
         then 'già presente' else 'non ancora creata' end);
end $$;

select sezione, voce, valore from ispezione order by ordine, sezione, voce;
