-- =====================================================================
-- M10 · PASSO 4 — PROPRIETARIO DELLA PIATTAFORMA
--
-- ⚠ NON eseguirlo insieme agli altri. È l'unico script che aggiunge un potere
--   nuovo, e va lanciato solo quando lo decidi tu, dopo che il PASSO 3 dice
--   TUTTO OK.
--
-- Che cosa fa: collega l'identità Supabase Auth di riccardocoletta@yahoo.it
-- alla tabella `platform_owners`. Da quel momento quell'accesso vede il portale
-- `/admin`, crea società e gestisce gli abbonamenti.
--
-- Che cosa NON fa: non crea identità (la persona deve già esistere in
-- Authentication → Users), non tocca nessun amministratore di società, non
-- cambia un solo dato del club. Promuove **quell'indirizzo e basta**.
--
-- Se un altro proprietario esiste già, si ferma: due proprietari sono una
-- decisione, non un effetto collaterale.
-- =====================================================================

do $$
declare
  indirizzo constant text := 'riccardocoletta@yahoo.it';
  identita uuid;
  altri int;
begin
  if to_regclass('public.platform_owners') is null then
    raise exception 'Manca platform_owners: applica prima il PASSO 2 (migrazione M10).';
  end if;
  if to_regclass('auth.users') is null then
    raise exception 'Questo database non ha auth.users: non è il progetto Supabase.';
  end if;

  select a.id into identita from auth.users a where lower(a.email) = lower(indirizzo);
  if identita is null then
    raise exception 'Nessuna identità Supabase Auth per %. Creala prima dal pannello '
                    '(Authentication → Users → Invite user), poi rilancia questo script.', indirizzo;
  end if;

  select count(*) into altri from public.platform_owners o where o.auth_user_id <> identita;
  if altri > 0 then
    raise exception 'Esiste già un altro proprietario della piattaforma (% registrati). '
                    'Aggiungerne un secondo è una decisione da prendere a parte.', altri;
  end if;

  insert into public.platform_owners (auth_user_id, email, note)
  values (identita, lower(indirizzo), 'promozione manuale dal pannello Supabase — M10')
  on conflict (auth_user_id) do nothing;

  raise notice 'Proprietario della piattaforma: % (identità %).', indirizzo, identita;
end $$;

-- Riepilogo: chi è proprietario, e chi resta soltanto segreteria di società.
select 'proprietario della piattaforma' as ruolo, o.email,
       to_char(o.created_at, 'DD/MM/YYYY HH24:MI') as dal, o.note as nota
  from public.platform_owners o
union all
select 'amministratore di società (invariato)', u.email, c.name, coalesce(r.role, '')
  from public.app_users u
  join public.user_roles r on r.user_id = u.id and r.role = 'admin'
  join public.clubs c on c.id = u.club_id
 order by 1, 2;

-- ---------------------------------------------------------------------
-- ANNULLAMENTO (se la promozione è stata un errore): togliere la riga non
-- tocca né l'identità Supabase né i dati di nessuna società.
--
--   delete from public.platform_owners where email = 'riccardocoletta@yahoo.it';
-- ---------------------------------------------------------------------
