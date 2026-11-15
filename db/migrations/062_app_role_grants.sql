-- ============================================================
-- 062 — Privilèges de table pour les rôles applicatifs
--
-- Les 182 politiques RLS disent *quelles lignes* un rôle peut voir ou
-- écrire, mais une politique ne remplace pas un privilège : sans `grant`,
-- PostgreSQL refuse la requête avant même d'évaluer la politique
-- (`permission denied for table users`, code 42501).
--
-- Ces privilèges existaient implicitement sur les installations où le
-- rôle applicatif est superutilisateur (le `devnet` du conteneur local
-- l'est), et sur l'hébergeur précédent où la base les accordait d'office.
-- Sur une base standard — Neon, PostgreSQL nu — `SET LOCAL ROLE
-- authenticated` échoue donc sur chaque lecture.
--
-- Le partage des droits reprend le modèle PostgREST/Supabase : `anon`
-- lit, `authenticated` lit et écrit (la RLS restreint les lignes),
-- `service_role` fait tout. Les séquences et les fonctions suivent,
-- sinon un insert avec `default nextval()` ou un `rpc()` échoue encore.
--
-- `alter default privileges` couvre les tables des migrations futures :
-- sans lui, il faudrait répéter ce fichier à chaque nouvelle table.
-- ============================================================

grant usage on schema public to anon, authenticated, service_role;

grant select on all tables in schema public to anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all privileges on all tables in schema public to service_role;

grant usage, select on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;

-- Les objets créés ensuite (par le rôle qui rejoue les migrations) héritent.
alter default privileges in schema public
  grant select on tables to anon;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant all privileges on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;

-- Les tables créées dans `auth` (session, comptes) sont lues par les
-- fonctions `security definer` uniquement : aucun privilège client ici.
