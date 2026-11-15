-- ============================================================
--  DEVNET — migration 074 : chaîne d'audit indépendante du fuseau
--
--  La migration 073 calculait le hachage avec
--  `to_char(timestamptz, …)`, qui dépend du `TimeZone` de la session.
--  Une vérification lancée depuis un client réglé sur Europe/Paris
--  recalculait donc une autre chaîne et signalait une rupture qui
--  n'existait pas. On fixe explicitement UTC des deux côtés.
--
--  On ignore aussi les lignes antérieures à 073 (`hash is null`) au
--  moment de choisir le maillon précédent : elles ne font pas partie
--  de la chaîne et ne doivent pas la démarrer sur un `prev_hash` vide
--  si l'horloge d'une ligne historique est en avance.
--
--  Les hachages déjà écrits restent valides : Neon et le serveur
--  applicatif travaillent en UTC, donc la chaîne produite est
--  identique. Seule la vérification devient stable partout.
-- ============================================================

create or replace function public.admin_audit_chain()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  previous text;
begin
  select hash into previous
    from public.admin_audit_log
   where hash is not null
   order by created_at desc, id desc
   limit 1;

  new.prev_hash := coalesce(previous, '');
  new.hash := encode(
    sha256(convert_to(
      coalesce(new.prev_hash, '') || '|'
      || new.id::text || '|'
      || coalesce(new.actor_id::text, '') || '|'
      || new.action || '|'
      || new.target_type || '|'
      || new.target_id || '|'
      || new.details::text || '|'
      || to_char(new.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
      'UTF8'
    )),
    'hex'
  );

  return new;
end;
$$;

create or replace function public.verify_admin_audit_chain()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row_record record;
  previous text := null;
  checked int := 0;
  expected text;
begin
  if not public.is_admin() then
    raise exception 'réservé à l''administration' using errcode = '42501';
  end if;

  for row_record in
    select id, actor_id, action, target_type, target_id, details, created_at, prev_hash, hash
      from public.admin_audit_log
     where hash is not null
     order by created_at asc, id asc
  loop
    checked := checked + 1;

    if previous is not null and row_record.prev_hash is distinct from previous then
      return jsonb_build_object(
        'ok', false,
        'checked', checked,
        'brokenAt', row_record.id,
        'detail', 'prev_hash ne correspond pas au hachage de la ligne précédente'
      );
    end if;

    expected := encode(
      sha256(convert_to(
        coalesce(row_record.prev_hash, '') || '|'
        || row_record.id::text || '|'
        || coalesce(row_record.actor_id::text, '') || '|'
        || row_record.action || '|'
        || row_record.target_type || '|'
        || row_record.target_id || '|'
        || row_record.details::text || '|'
        || to_char(row_record.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
        'UTF8'
      )),
      'hex'
    );

    if expected <> row_record.hash then
      return jsonb_build_object(
        'ok', false,
        'checked', checked,
        'brokenAt', row_record.id,
        'detail', 'le contenu de la ligne ne correspond plus à son hachage'
      );
    end if;

    previous := row_record.hash;
  end loop;

  return jsonb_build_object('ok', true, 'checked', checked, 'brokenAt', null, 'detail', null);
end;
$$;

revoke all on function public.verify_admin_audit_chain() from public, anon;
grant execute on function public.verify_admin_audit_chain() to authenticated;
