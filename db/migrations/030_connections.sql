-- 030 — Les connexions sortantes, par personne.
--
-- La table est née `github_connections` (004) parce que GitHub était la
-- seule destination. Elle accueille désormais d'autres fournisseurs : un
-- tunnel VS Code, une API maison, un webhook. On ne renomme pas : la
-- contrainte `unique (user_id, provider)` de la 004 faisait déjà de
-- `provider` la dimension de variété — une connexion **par fournisseur et
-- par personne**. Ce nom la couvrait déjà mal ; on l'assume plutôt que de
-- casser les politiques `gh_self_*` et tout le code qui la lit.
--
-- ## Ce qui ne change pas
--
-- Le secret n'est jamais dans la ligne. `token_ref` reste une référence
-- opaque vers un coffre — Supabase Vault en production, cookie chiffré
-- AES-GCM en local (`lib/github/crypto.ts`). Une fuite de RLS ne donne
-- donc qu'un nom de range, pas de jeton.
--
-- ## Ce qu'on ajoute
--
-- Ce qui **décrit la destination**, pas le secret : où elle pointe
-- (`endpoint`), dans quel état elle est (`status`), quand on s'en est
-- servi (`used_at`), et ce que le fournisseur a renvoyé d'autre
-- (`metadata`).

alter table public.github_connections
  add column if not exists endpoint text default '',
  add column if not exists status   text default 'active',
  add column if not exists used_at  timestamptz,
  add column if not exists metadata jsonb default '{}'::jsonb;

comment on column public.github_connections.provider is
  'github | vscode | api | … — une connexion par fournisseur et par personne.';
comment on column public.github_connections.endpoint is
  'Destination (URL du tunnel VS Code, base d''API). Vide pour GitHub.';
comment on column public.github_connections.status is
  'active | pending | error — l''état affiché, jamais le secret.';

-- L'état est **fermé** : un état libre rendrait tout affichage possible,
-- donc aucun fiable. On pose la contrainte une seule fois, de façon
-- idempotente, parce que les migrations rejouent en local.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'connections_status_check'
       and conrelid = 'public.github_connections'::regclass
  ) then
    alter table public.github_connections
      add constraint connections_status_check
      check (status in ('active', 'pending', 'error'));
  end if;
end $$;

-- Ni l'identité ni le pointeur de coffre ne se réécrivent : on peut faire
-- évoluer l'état d'une connexion, pas la réattribuer à quelqu'un d'autre
-- ni la faire pointer ailleurs. Changer de destination se fait en
-- déconnectant puis reconnectant — deux gestes explicites, pas une
-- réécriture silencieuse.
revoke update (user_id, provider, token_ref, connected_at, endpoint)
  on public.github_connections from authenticated, anon;
