-- M2–M4 — Tesseramenti, scadenze certificati (soli metadati), quote e pagamenti manuali.

-- Dati amministrativi personali: visibili a se stessi e al proprio tutore.
-- Gli allenatori non vi accedono (minimizzazione), tranne che per le scadenze certificati.
create function app_is_self_or_ward(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p = app_person_id()
      or exists (select 1 from guardian_links g
                  where g.guardian_person_id = app_person_id()
                    and g.minor_person_id = p)
$$;

create table registrations (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete cascade,
  season_id uuid not null references seasons(id) on delete cascade,
  status text not null default 'da_completare'
    check (status in ('da_completare','in_corso','attivo','scaduto')),
  submitted_on date,
  valid_until date,
  notes text,
  updated_at timestamptz not null default now(),
  unique (person_id, season_id)
);

-- Solo stato di validità. Nessun file, nessuna diagnosi, nessun dato clinico.
create table medical_expiries (
  person_id uuid primary key references people(id) on delete cascade,
  kind text check (kind in ('agonistico','non_agonistico')),
  expires_on date not null,
  updated_at timestamptz not null default now()
);

create table dues (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete cascade,
  season_id uuid not null references seasons(id) on delete cascade,
  description text not null check (length(trim(description)) > 0),
  amount_cents integer not null check (amount_cents > 0),
  due_date date,
  created_at timestamptz not null default now()
);

create table payment_records (
  id uuid primary key default gen_random_uuid(),
  due_id uuid not null references dues(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  paid_on date not null default current_date,
  method text not null default 'contanti' check (method in ('contanti','bonifico','assegno','altro')),
  note text,
  created_at timestamptz not null default now()
);
create index payment_records_due_idx on payment_records (due_id);

-- Residuo e stato della quota sono DERIVATI dai pagamenti, mai scritti a mano.
-- security_invoker: la vista rispetta la RLS di chi interroga.
create view dues_status with (security_invoker = true) as
  select d.*,
         coalesce(p.paid_cents, 0) as paid_cents,
         d.amount_cents - coalesce(p.paid_cents, 0) as remaining_cents,
         case when coalesce(p.paid_cents, 0) >= d.amount_cents then 'saldata'
              when coalesce(p.paid_cents, 0) > 0 then 'parziale'
              else 'aperta' end as status
    from dues d
    left join (select due_id, sum(amount_cents)::int as paid_cents
                 from payment_records group by due_id) p on p.due_id = d.id;

alter table registrations    enable row level security;
alter table medical_expiries enable row level security;
alter table dues             enable row level security;
alter table payment_records  enable row level security;

grant select, insert, update, delete on registrations, medical_expiries, dues, payment_records to app_user;
grant select on dues_status to app_user;

create policy registrations_read on registrations for select to app_user
  using (app_is_admin() or app_is_self_or_ward(person_id));
create policy registrations_write on registrations for all to app_user
  using (app_is_admin()) with check (app_is_admin());

-- L'allenatore vede la scadenza del certificato dei propri atleti: gli serve per
-- sapere chi può scendere in acqua. Resta un solo dato: la data e il suo stato.
create policy medical_read on medical_expiries for select to app_user
  using (app_is_admin() or app_can_see_person(person_id));
create policy medical_write on medical_expiries for all to app_user
  using (app_is_admin()) with check (app_is_admin());

create policy dues_read on dues for select to app_user
  using (app_is_admin() or app_is_self_or_ward(person_id));
create policy dues_write on dues for all to app_user
  using (app_is_admin()) with check (app_is_admin());

create policy payments_read on payment_records for select to app_user
  using (app_is_admin() or exists (select 1 from dues d
                                    where d.id = due_id and app_is_self_or_ward(d.person_id)));
create policy payments_write on payment_records for all to app_user
  using (app_is_admin()) with check (app_is_admin());
