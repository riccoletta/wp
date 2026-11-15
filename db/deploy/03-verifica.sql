-- =====================================================================
-- M10 · PASSO 3 — VERIFICA DOPO LA MIGRAZIONE (SOLA LETTURA)
--
-- Da incollare nel SQL Editor DOPO il PASSO 2. Non scrive niente.
-- Ogni riga è un controllo con esito OK o **NO**. L'ultima riga dice se
-- qualcosa è andato storto.
--
-- PRIMA DI LANCIARLO: riporta qui sotto i numeri letti nel PASSO 1.
-- Lasciandoli a NULL i controlli di conservazione dicono "non confrontato":
-- lo script funziona lo stesso, ma non dimostra che non si è perso niente.
-- =====================================================================

with attesi as (
  select
    null::bigint as persone,            -- conteggi.people        del PASSO 1
    null::bigint as account,            -- conteggi.app_users     del PASSO 1
    null::bigint as ruoli,              -- conteggi.user_roles    del PASSO 1
    null::bigint as squadre,            -- conteggi.teams         del PASSO 1
    null::bigint as rose,               -- conteggi.team_memberships
    null::bigint as allenatori,         -- conteggi.coach_assignments
    null::bigint as tesseramenti,       -- conteggi.registrations
    null::bigint as certificati,        -- conteggi.medical_expiries
    null::bigint as quote,              -- conteggi.dues
    null::bigint as versamenti,         -- conteggi.payment_records
    null::bigint as tutori,             -- conteggi.guardian_links
    null::bigint as dovuto_cent,        -- importi."dovuto (quote)"
    null::bigint as incassato_cent      -- importi."incassato (versamenti)"
),
club as (select id, name, slug from public.clubs where slug = 'pallanuoto-milano'),
esiti as (

-- 1) LA SOCIETÀ ESISTE ---------------------------------------------------
select 1 as n, 'Pallanuoto Milano esiste' as controllo,
       case when exists (select 1 from club) then 'OK' else 'NO' end as esito,
       coalesce((select name || ' (' || slug || ')' from club), 'società non trovata') as dettaglio
union all
select 2, 'società presenti nel database',
       case when (select count(*) from public.clubs) >= 1 then 'OK' else 'NO' end,
       (select string_agg(name, ', ' order by name) from public.clubs)

-- 2) I DATI DI PRIMA CI SONO ANCORA -------------------------------------
union all select 3, 'persone conservate',
  case when (select persone from attesi) is null then 'n/d'
       when (select count(*) from public.people) = (select persone from attesi) then 'OK' else 'NO' end,
  (select count(*)::text from public.people) || ' righe (attese: '
    || coalesce((select persone::text from attesi), 'non confrontato') || ')'
union all select 4, 'account conservati',
  case when (select account from attesi) is null then 'n/d'
       when (select count(*) from public.app_users) = (select account from attesi) then 'OK' else 'NO' end,
  (select count(*)::text from public.app_users) || ' righe (attese: '
    || coalesce((select account::text from attesi), 'non confrontato') || ')'
union all select 5, 'ruoli conservati',
  case when (select ruoli from attesi) is null then 'n/d'
       when (select count(*) from public.user_roles) = (select ruoli from attesi) then 'OK' else 'NO' end,
  (select count(*)::text from public.user_roles) || ' righe'
union all select 6, 'squadre conservate',
  case when (select squadre from attesi) is null then 'n/d'
       when (select count(*) from public.teams) = (select squadre from attesi) then 'OK' else 'NO' end,
  (select count(*)::text from public.teams) || ' righe'
union all select 7, 'rose conservate',
  case when (select rose from attesi) is null then 'n/d'
       when (select count(*) from public.team_memberships) = (select rose from attesi) then 'OK' else 'NO' end,
  (select count(*)::text from public.team_memberships) || ' righe'
union all select 8, 'assegnazioni allenatori conservate',
  case when (select allenatori from attesi) is null then 'n/d'
       when (select count(*) from public.coach_assignments) = (select allenatori from attesi) then 'OK' else 'NO' end,
  (select count(*)::text from public.coach_assignments) || ' righe'
union all select 9, 'tesseramenti conservati',
  case when (select tesseramenti from attesi) is null then 'n/d'
       when (select count(*) from public.registrations) = (select tesseramenti from attesi) then 'OK' else 'NO' end,
  (select count(*)::text from public.registrations) || ' righe'
union all select 10, 'certificati conservati',
  case when (select certificati from attesi) is null then 'n/d'
       when (select count(*) from public.medical_expiries) = (select certificati from attesi) then 'OK' else 'NO' end,
  (select count(*)::text from public.medical_expiries) || ' righe'
union all select 11, 'quote conservate (numero e importo)',
  case when (select quote from attesi) is null then 'n/d'
       when (select count(*) from public.dues) = (select quote from attesi)
        and (select coalesce(sum(amount_cents), 0) from public.dues) = (select dovuto_cent from attesi)
       then 'OK' else 'NO' end,
  (select count(*)::text from public.dues) || ' quote per '
    || (select coalesce(sum(amount_cents), 0)::text from public.dues) || ' centesimi'
union all select 12, 'versamenti conservati (numero e importo)',
  case when (select versamenti from attesi) is null then 'n/d'
       when (select count(*) from public.payment_records) = (select versamenti from attesi)
        and (select coalesce(sum(amount_cents), 0) from public.payment_records) = (select incassato_cent from attesi)
       then 'OK' else 'NO' end,
  (select count(*)::text from public.payment_records) || ' versamenti per '
    || (select coalesce(sum(amount_cents), 0)::text from public.payment_records) || ' centesimi'
union all select 13, 'legami tutore-minore conservati',
  case when (select tutori from attesi) is null then 'n/d'
       when (select count(*) from public.guardian_links) = (select tutori from attesi) then 'OK' else 'NO' end,
  (select count(*)::text from public.guardian_links) || ' righe'

-- 3) L'AMMINISTRATORE È ANCORA AL SUO POSTO -----------------------------
union all select 14, 'amministratore presente e collegato a Supabase Auth',
  case when exists (select 1 from public.app_users u join public.user_roles r on r.user_id = u.id
                     where r.role = 'admin' and u.active and u.auth_user_id is not null)
       then 'OK' else 'NO' end,
  coalesce((select string_agg(u.email, ', ') from public.app_users u
             join public.user_roles r on r.user_id = u.id
            where r.role = 'admin'), 'nessun amministratore')
union all select 15, 'ogni account collegato punta a una identità che esiste',
  case when to_regclass('auth.users') is null then 'n/d'
       when not exists (select 1 from public.app_users u
                         where u.auth_user_id is not null
                           and not exists (select 1 from auth.users a where a.id = u.auth_user_id))
       then 'OK' else 'NO' end,
  (select count(*)::text from public.app_users where auth_user_id is not null) || ' account collegati'
union all select 16, 'amministratore dentro Pallanuoto Milano',
  case when exists (select 1 from public.app_users u join public.user_roles r on r.user_id = u.id
                     where r.role = 'admin' and u.club_id = (select id from club))
       then 'OK' else 'NO' end,
  coalesce((select string_agg(u.email, ', ') from public.app_users u
             join public.user_roles r on r.user_id = u.id
            where r.role = 'admin' and u.club_id = (select id from club)), 'nessuno')

-- 4) OGNI RIGA È ASSEGNATA ALLA SOCIETÀ GIUSTA --------------------------
union all select 17, 'nessuna riga senza società',
  case when (select count(*) from (
         select 1 from public.people where club_id is null
         union all select 1 from public.app_users where club_id is null
         union all select 1 from public.seasons where club_id is null
         union all select 1 from public.teams where club_id is null
         union all select 1 from public.team_memberships where club_id is null
         union all select 1 from public.coach_assignments where club_id is null
         union all select 1 from public.guardian_links where club_id is null
         union all select 1 from public.registrations where club_id is null
         union all select 1 from public.medical_expiries where club_id is null
         union all select 1 from public.dues where club_id is null
         union all select 1 from public.payment_records where club_id is null) x) = 0
       then 'OK' else 'NO' end,
  'club_id obbligatorio su tutte le tabelle di società'
union all select 18, 'tutto assegnato a Pallanuoto Milano',
  case when (select count(*) from (
         select club_id from public.people
         union all select club_id from public.teams
         union all select club_id from public.dues
         union all select club_id from public.payment_records
         union all select club_id from public.registrations
         union all select club_id from public.app_users) x
        where x.club_id <> (select id from club)) = 0
       then 'OK' else 'NO' end,
  'nessuna riga fuori dalla prima società'
union all select 19, 'colonne club_id tutte obbligatorie',
  case when not exists (select 1 from information_schema.columns
                         where table_schema = 'public' and column_name = 'club_id'
                           and is_nullable = 'YES') then 'OK' else 'NO' end,
  (select count(*)::text from information_schema.columns
    where table_schema = 'public' and column_name = 'club_id') || ' tabelle con club_id'

-- 5) ISOLAMENTO FRA SOCIETÀ ---------------------------------------------
union all select 20, 'chiavi esterne composite (società per società)',
  case when (select count(*) from pg_constraint
              where conname like '%\_club\_fk' and contype = 'f') = 14 then 'OK' else 'NO' end,
  (select count(*)::text from pg_constraint where conname like '%\_club\_fk' and contype = 'f')
    || ' chiavi su 14 attese'
union all select 21, 'bersagli unici (id, club_id) sui padri',
  case when (select count(*) from pg_constraint where conname like '%\_id\_club\_key') = 4
       then 'OK' else 'NO' end,
  (select string_agg(conname, ', ' order by conname) from pg_constraint where conname like '%\_id\_club\_key')
union all select 22, 'una stagione attiva PER SOCIETÀ',
  case when exists (select 1 from pg_indexes where indexname = 'seasons_single_active_idx'
                      and indexdef like '%(club_id)%') then 'OK' else 'NO' end,
  coalesce((select indexdef from pg_indexes where indexname = 'seasons_single_active_idx'), 'indice assente')
union all select 23, 'email di accesso unica dentro la società',
  case when exists (select 1 from pg_indexes where indexname = 'app_users_email_idx'
                      and indexdef like '%club_id%') then 'OK' else 'NO' end,
  coalesce((select indexdef from pg_indexes where indexname = 'app_users_email_idx'), 'indice assente')
union all select 24, 'ogni policy di lettura filtra sulla società',
  case when (select count(*) from pg_policies
              where schemaname = 'public' and cmd = 'SELECT'
                and tablename in ('people','guardian_links','seasons','teams','team_memberships',
                                  'coach_assignments','registrations','medical_expiries','dues',
                                  'payment_records','app_users','user_roles')
                and qual like '%app_club_open%') = 12 then 'OK' else 'NO' end,
  (select count(*)::text from pg_policies where schemaname = 'public' and cmd = 'SELECT'
     and qual like '%app_club_open%') || ' policy di lettura filtrate per società'
union all select 25, 'tabelle di piattaforma invisibili alla Data API',
  case when not exists (select 1 from information_schema.role_table_grants
                         where table_schema = 'public'
                           and table_name in ('platform_owners', 'club_sessions')
                           and grantee in ('anon', 'authenticated')) then 'OK' else 'NO' end,
  'platform_owners e club_sessions senza GRANT per anon/authenticated'
union all select 26, 'anon resta senza privilegi',
  case when not exists (select 1 from information_schema.role_table_grants
                         where table_schema = 'public' and grantee = 'anon') then 'OK' else 'NO' end,
  'nessun GRANT di tabella per anon'

-- 6) ABBONAMENTO ---------------------------------------------------------
union all select 27, 'ogni società ha il suo abbonamento',
  case when not exists (select 1 from public.clubs c
                         where not exists (select 1 from public.subscriptions s where s.club_id = c.id))
       then 'OK' else 'NO' end,
  (select count(*)::text from public.subscriptions) || ' abbonamenti per '
    || (select count(*)::text from public.clubs) || ' società'
union all select 28, 'abbonamento ereditato dalla licenza, identico',
  case when to_regclass('public.license') is null then 'n/d'
       when exists (select 1 from public.subscriptions s, public.license l
                     where s.club_id = (select id from club)
                       and s.status = l.status and s.expires_on = l.expires_on
                       and s.grace_days = l.grace_days) then 'OK' else 'NO' end,
  (select 'abbonamento ' || s.status || ' fino al ' || s.expires_on
            || ' (+' || s.grace_days || ' gg) · licenza ' || l.status || ' fino al ' || l.expires_on
     from public.subscriptions s, public.license l where s.club_id = (select id from club))
union all select 29, 'società operativa adesso',
  case when (select not public.app_subscription_blocked((select id from club))) then 'OK' else 'NO' end,
  case when (select public.app_subscription_blocked((select id from club)))
       then coalesce(public.app_subscription_message((select id from club)), 'bloccata')
       else 'nessun blocco: lettura e scrittura regolari' end
union all select 30, 'creazione registrata',
  case when exists (select 1 from public.subscription_events where club_id = (select id from club))
       then 'OK' else 'NO' end,
  coalesce((select string_agg(action, ', ' order by created_at) from public.subscription_events
             where club_id = (select id from club)), 'nessun evento')

-- 7) SUPERFICIE RPC ------------------------------------------------------
union all select 31, 'funzioni della piattaforma presenti',
  case when (select count(*) from pg_proc
              where pronamespace = 'public'::regnamespace
                and proname in ('api_platform_clubs','api_platform_club_create',
                                'api_platform_subscription','api_club_enter','api_club_leave',
                                'api_my_clubs','api_subscription','app_current_club',
                                'app_club_open','app_is_platform_owner')) = 10 then 'OK' else 'NO' end,
  (select string_agg(proname, ', ' order by proname) from pg_proc
    where pronamespace = 'public'::regnamespace and proname like 'api\_platform%')
union all select 32, 'nessun proprietario della piattaforma (lo si promuove al PASSO 4)',
  case when (select count(*) from public.platform_owners) = 0 then 'OK' else 'attenzione' end,
  (select count(*)::text from public.platform_owners) || ' proprietari registrati'
)
select n as "#", controllo, esito, dettaglio from esiti
union all
select 99, 'ESITO COMPLESSIVO',
       case when exists (select 1 from esiti where esito = 'NO') then 'CONTROLLI FALLITI' else 'TUTTO OK' end,
       (select count(*)::text from esiti where esito = 'NO') || ' controlli falliti, '
         || (select count(*)::text from esiti where esito = 'n/d') || ' non confrontati'
order by 1;
