-- ============================================================
--  db/bootstrap/roles.sql — prérequis des 161 politiques RLS
--
--  À exécuter UNE FOIS, par un rôle **superutilisateur** :
--    - console Systalink → onglet « Explorer » / SQL, ou
--    - `systalink psql <id-de-l-instance>`, ou
--    - par le support, avec le ticket de docs/ops/runbook.md §4.1.
--
--  Pourquoi ce n'est pas dans les migrations : `devnet_u` n'a pas
--  CREATEROLE (mesuré : 42501), et `service_role` porte BYPASSRLS,
--  attribut que seul un superutilisateur peut donner. C'est le seul
--  blocage du schéma distant.
--
--  Idempotent : rejouable sans erreur. Ne touche aucune donnée.
-- ============================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

-- L'application atteint `anon` et `authenticated` par `SET LOCAL ROLE`
-- dans withUser() : sans cette appartenance, aucune politique RLS ne
-- s'applique pour elle. En revanche, `service_role` porte BYPASSRLS :
-- l'accorder au rôle runtime lui permettrait de contourner toutes les
-- politiques depuis une simple requête applicative. Le rôle de service
-- reste réservé aux opérations d'exploitation, jamais au runtime.
--
-- `revoke` est idempotent et corrige aussi une base où l'ancien accord a
-- déjà été appliqué. Conditionnel pour que ce fichier reste rejouable sur
-- une base où le rôle applicatif porte un autre nom (miroir local :
-- `devnet`).
do $$
begin
  if to_regrole('devnet_u') is null then
    raise notice 'Rôle devnet_u absent : accord non effectué (normal hors cible Systalink).';
  else
    -- Ne pas regranter un rôle déjà accordé : un membre sans ADMIN OPTION
    -- ne peut pas exécuter `grant` sur ce rôle, même si l'accord existe.
    if not pg_has_role('devnet_u', 'anon', 'member') then
      execute 'grant anon to devnet_u';
    end if;
    if not pg_has_role('devnet_u', 'authenticated', 'member') then
      execute 'grant authenticated to devnet_u';
    end if;
    -- Le retrait de service_role exige l'ADMIN OPTION sur ce rôle. Sur
    -- Systalink, seul l'administrateur de la base la possède.
    execute 'revoke service_role from devnet_u';
  end if;
end
$$;

-- Vérification : 3 lignes attendues ; anon et authenticated accordés à
-- devnet_u, service_role jamais accordé (f).
select r.rolname,
       case when to_regrole('devnet_u') is null then null
            else pg_has_role('devnet_u', r.rolname, 'member') end as accordé_à_devnet_u
  from pg_roles r
 where r.rolname in ('anon', 'authenticated', 'service_role')
 order by r.rolname;
