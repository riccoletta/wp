-- Licenza d'uso annuale del software. Una sola riga: un solo club, un solo contratto.
-- Lo stato operativo (piena operatività / sola lettura) è DERIVATO da scadenza, tolleranza
-- e sospensione: non esiste un campo "sola lettura" modificabile a mano.
create table license (
  id boolean primary key default true check (id),
  status text not null default 'attiva' check (status in ('attiva','sospesa')),
  expires_on date not null,
  grace_days integer not null default 15 check (grace_days >= 0 and grace_days <= 365),
  note text,
  updated_at timestamptz not null default now()
);

insert into license (id, expires_on) values (true, current_date + 365);

alter table license enable row level security;

-- Chiunque abbia una sessione legge lo stato: serve a mostrare l'avviso in italiano.
create policy license_read on license for select to app_user using (app_uid() is not null);

-- Nessun permesso di scrittura, nemmeno per l'admin del club: rinnovo, sospensione e
-- riattivazione passano solo dal canale del proprietario del software, che gira come
-- sistema. Senza GRANT, una UPDATE da dentro l'applicazione fallisce nel database.
grant select on license to app_user;
