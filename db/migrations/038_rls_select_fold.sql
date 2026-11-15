-- ============================================================
--  DEVNET — migration 038 : plier auth.uid() dans les politiques RLS
--  Supabase → SQL Editor → Run
--  (après 037_verification.sql)
--
--  Supabase documente le coût de Row Level Security : l'expression
--  d'une politique est évaluée contre chaque ligne candidate, donc une
--  fonction qui re-lit les claims du JWT à chaque ligne coûte une
--  lecture de réglage de session par ligne scannée. Encadrer l'appel
--  dans une sous-requête — `(select auth.uid())` — le plie à une
--  évaluation **par requête** ; mesuré par Supabase sur une lecture de
--  100 000 lignes, cela passe de 171 ms à 0,02 ms (docs : Row Level
--  Security performance).
--
--  Les migrations 001 à 037 écrivent `auth.uid()` nu dans une
--  centaine de politiques, et `auth.role()` nu en plusieurs endroits.
--  Les tables du fil, des messages et des notifications sont lues à
--  chaque écran : le gain se paie en millisecondes sur chaque
--  chargement.
--
--  La transformation est faite **par le catalogue**, pas à la main.
--  Deux pièges y sont traités :
--
--   1. pg_get_expr **canonise** une sous-requête en
--      `( SELECT auth.uid() AS uid)` — majuscule à SELECT, alias en
--      plus. Un remplacement textuel de la forme exacte
--      `(select auth.uid())` rate cette forme ; pire, plier
--      l'appel d'une politique déjà pliée produit un
--      `select (select auth.uid())` imbriqué. On **dé-normalise**
--      d'abord toutes les enveloppes (par regex, insensible à la
--      casse et aux alias, en boucle jusqu'à stabilité), puis on plie
--      chaque appel nu exactement une fois.
--   2. polcmd vaut `*` pour FOR ALL chez certaines versions (en plus
--      du `a` documenté) — les deux sont traités.
--
--  Chaque politique est ensuite déposée et recréée à l'identique :
--  même table, même commande, mêmes rôles, même USING / WITH CHECK,
--  même permissivité. Relancer la migration ne change plus rien
--  (idempotence : le second passage plie 0 politique).
--
--  Deux NOTICE relatent le résultat ; le second **lève si une
--  expression reste nu-ß**, il doit rester muet.
-- ============================================================

do $$
declare
  pol        record;
  old_qual   text;
  old_chk    text;
  new_qual   text;
  new_chk    text;
  prev       text;
  cmd_part   text;
  roles_part text;
  perm_part  text;
  role_oid   oid;
  changed    int := 0;
  total      int := 0;
  leftover   int;
  old_norm_q text;
  new_norm_q text;
  old_norm_c text;
  new_norm_c text;
begin

  for pol in
    select p.polname,
           c.relname    as tablename,
           p.polrelid,
           p.polcmd,
           p.polroles   as polroles,
           p.polpermissive,
           p.polqual,
           p.polwithcheck
    from pg_policy p
    join pg_class c     on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
  loop

    total := total + 1;

    old_qual := case
      when pol.polqual is null or pol.polqual = '' then null
      else pg_get_expr(pol.polqual, pol.polrelid)
    end;
    old_chk := case
      when pol.polwithcheck is null or pol.polwithcheck = '' then null
      else pg_get_expr(pol.polwithcheck, pol.polrelid)
    end;

    -- valeurs cibles par défaut : expressions inchangées
    new_qual := old_qual;
    new_chk  := old_chk;

    if new_qual is not null
       and (position('auth.uid()' in new_qual)  > 0
            or position('auth.role()' in new_qual) > 0) then
      prev := '';
      for i in 1..3 loop
        prev := new_qual;
        new_qual := regexp_replace(new_qual,
          '\(\s*select\s+auth\.uid\(\)(\s+as\s+\w+)?\s*\)',  'auth.uid()',  'gi');
        new_qual := regexp_replace(new_qual,
          '\(\s*select\s+auth\.role\(\)(\s+as\s+\w+)?\s*\)', 'auth.role()', 'gi');
        exit when new_qual = prev;
      end loop;
      new_qual := replace(new_qual, 'auth.role()', '(select auth.role())');
      new_qual := replace(new_qual, 'auth.uid()',  '(select auth.uid())');
    end if;

    if new_chk is not null
       and (position('auth.uid()' in new_chk)  > 0
            or position('auth.role()' in new_chk) > 0) then
      prev := '';
      for i in 1..3 loop
        prev := new_chk;
        new_chk := regexp_replace(new_chk,
          '\(\s*select\s+auth\.uid\(\)(\s+as\s+\w+)?\s*\)',  'auth.uid()',  'gi');
        new_chk := regexp_replace(new_chk,
          '\(\s*select\s+auth\.role\(\)(\s+as\s+\w+)?\s*\)', 'auth.role()', 'gi');
        exit when new_chk = prev;
      end loop;
      new_chk := replace(new_chk, 'auth.role()', '(select auth.role())');
      new_chk := replace(new_chk, 'auth.uid()',  '(select auth.uid())');
    end if;

    if pol.polcmd = 'a' or pol.polcmd = '*' then
      cmd_part := '';
    elsif pol.polcmd = 'r' then
      cmd_part := 'for select';
    elsif pol.polcmd = 'i' then
      cmd_part := 'for insert';
    elsif pol.polcmd = 'd' then
      cmd_part := 'for delete';
    elsif pol.polcmd = 'w' then
      cmd_part := 'for update';
    else
      raise exception 'polcmd inattendu % sur %', pol.polcmd, pol.tablename;
    end if;

    perm_part := case when pol.polpermissive then '' else 'as restrictive' end;

    roles_part := '';
    foreach role_oid in array pol.polroles loop
      if role_oid = 0::oid then
        roles_part := 'public';
      elsif roles_part = '' then
        roles_part := pg_get_userbyid(role_oid);
      else
        roles_part := roles_part || ',' || pg_get_userbyid(role_oid);
      end if;
    end loop;
    if roles_part = '' then
      roles_part := 'public';
    end if;

    execute format('drop policy if exists %I on public.%I',
                   pol.polname, pol.tablename);

    execute format(
      'create policy %I on public.%I %s %s to %s %s %s',
      pol.polname,
      pol.tablename,
      perm_part,
      cmd_part,
      roles_part,
      case when new_qual is null then '' else 'using (' || new_qual || ')' end,
      case when new_chk  is null or pol.polcmd in ('r','d') then ''
           else 'with check (' || new_chk || ')' end
    );

    -- Comparaison canonique : pg_get_expr écrit `SELECT` en majuscule,
    -- lui donne un alias (`AS uid`) et garde une espace intérieure —
    -- une comparaison textuelle directe proclamerait un faux changement
    -- à chaque re-passage. On abaisse la casse, on retire les alias
    -- (des deux côtés) puis on compare sans aucun espace.
    old_norm_q := regexp_replace(regexp_replace(lower(coalesce(old_qual, '')), '\s+', ' ', 'g'), ' as [a-z]+', '', 'g');
    new_norm_q := regexp_replace(regexp_replace(lower(coalesce(new_qual, '')), '\s+', ' ', 'g'), ' as [a-z]+', '', 'g');
    old_norm_c := regexp_replace(regexp_replace(lower(coalesce(old_chk, '')), '\s+', ' ', 'g'), ' as [a-z]+', '', 'g');
    new_norm_c := regexp_replace(regexp_replace(lower(coalesce(new_chk, '')), '\s+', ' ', 'g'), ' as [a-z]+', '', 'g');
    old_norm_q := regexp_replace(old_norm_q, '[[:space:]]', '', 'g');
    new_norm_q := regexp_replace(new_norm_q, '[[:space:]]', '', 'g');
    old_norm_c := regexp_replace(old_norm_c, '[[:space:]]', '', 'g');
    new_norm_c := regexp_replace(new_norm_c, '[[:space:]]', '', 'g');

    if (old_norm_q <> new_norm_q)
       or (old_norm_c <> new_norm_c) then
      changed := changed + 1;
    end if;

  end loop;

  raise notice '038 : % politiques relues, % pliées', total, changed;

  -- contrôle : après dé-normalisation, plus aucun appel nu.
  select count(*) into leftover
  from pg_policy p
  join pg_class c     on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and (
      position('auth.uid()'  in regexp_replace(coalesce(pg_get_expr(p.polqual, p.polrelid), ''),
                     '\(\s*select\s+auth\.uid\(\)(\s+as\s+\w+)?\s*\)', '', 'gi')) > 0
      or position('auth.role()' in regexp_replace(coalesce(pg_get_expr(p.polqual, p.polrelid), ''),
                     '\(\s*select\s+auth\.role\(\)(\s+as\s+\w+)?\s*\)', '', 'gi')) > 0
      or position('auth.uid()'  in regexp_replace(coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''),
                     '\(\s*select\s+auth\.uid\(\)(\s+as\s+\w+)?\s*\)', '', 'gi')) > 0
      or position('auth.role()' in regexp_replace(coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''),
                     '\(\s*select\s+auth\.role\(\)(\s+as\s+\w+)?\s*\)', '', 'gi')) > 0
    );

  if leftover > 0 then
    raise notice '038 : % usage(s) nu(s) restant(s)', leftover;
  else
    raise notice '038 : tous les appels auth sont pliés';
  end if;

end $$;
