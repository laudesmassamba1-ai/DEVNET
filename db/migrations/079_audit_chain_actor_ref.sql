-- ============================================================
--  DEVNET — migration 079 : chaîne d'audit résistante à l'effacement
--
--  Défaut mesuré : `admin_audit_log.actor_id` est une clé étrangère
--  `on delete set null`. Quand un compte est supprimé, PostgreSQL met
--  `actor_id` à `null` **dans les lignes déjà hachées**. Le contenu de
--  la ligne change donc après coup et `verify_admin_audit_chain()`
--  déclare une rupture, alors que personne n'a falsifié le journal.
--
--  La correction sépare l'identité **actuelle** de l'identité
--  **historique** :
--
--   · `actor_ref` est une copie texte écrite au moment de l'insertion ;
--   · elle n'a aucune clé étrangère, donc aucune suppression de compte
--     ne la modifie ;
--   · le hachage couvre `actor_ref`, plus `actor_id`.
--
--  Les lignes existantes sont recalculées une seule fois. C'est une
--  réparation assumée : la chaîne était déjà rompue par des suppressions
--  de comptes légitimes, et conserver les anciens hachages aurait laissé
--  un vérificateur définitivement rouge. La migration conserve l'ordre,
--  les identifiants et les contenus ; elle ne fait que recalculer les
--  deux colonnes de chaîne avec la nouvelle règle.
--
--  Rollback : recréer les fonctions de la 074 et supprimer `actor_ref`.
--  Les hachages recalculés resteraient ceux de la nouvelle règle.
-- ============================================================

alter table public.admin_audit_log
  add column if not exists actor_ref text not null default '';

update public.admin_audit_log
   set actor_ref = coalesce(actor_id::text, '')
 where actor_ref = '';

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

  -- L'identité historique est figée ici. `actor_id` peut devenir null
  -- plus tard ; `actor_ref` ne le peut pas.
  new.actor_ref := coalesce(new.actor_id::text, '');

  new.prev_hash := coalesce(previous, '');
  new.hash := encode(
    sha256(convert_to(
      coalesce(new.prev_hash, '') || '|'
      || new.id::text || '|'
      || new.actor_ref || '|'
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
    select id, actor_ref, action, target_type, target_id, details, created_at, prev_hash, hash
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
        || row_record.actor_ref || '|'
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

-- Recalcul unique, dans l'ordre chronologique. Aucun trigger d'update
-- n'existe sur cette table : les deux colonnes sont les seules réécrites.
do $$
declare
  row_record record;
  previous text := '';
  next_hash text;
begin
  update public.admin_audit_log set prev_hash = null, hash = null;

  for row_record in
    select id, actor_ref, action, target_type, target_id, details, created_at
      from public.admin_audit_log
     order by created_at asc, id asc
  loop
    next_hash := encode(
      sha256(convert_to(
        previous || '|'
        || row_record.id::text || '|'
        || row_record.actor_ref || '|'
        || row_record.action || '|'
        || row_record.target_type || '|'
        || row_record.target_id || '|'
        || row_record.details::text || '|'
        || to_char(row_record.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
        'UTF8'
      )),
      'hex'
    );
    update public.admin_audit_log
       set prev_hash = previous, hash = next_hash
     where id = row_record.id;
    previous := next_hash;
  end loop;
end;
$$;
