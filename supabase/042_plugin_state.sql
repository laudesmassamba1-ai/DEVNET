-- 042 — L'état d'exécution des plugins.
--
-- Un plugin intégré au dépôt est **installé** dès que la construction passe ;
-- son activation est une décision d'administration, stockée ici. Couper un
-- plugin ne demande donc aucun redéploiement.
--
-- Ce que cette table ne contient pas : les secrets (table dédiée chiffrée plus
-- tard), le code du plugin (il est au dépôt), ni les données métier qu'il
-- produit (`plugin_kv` et tables préfixées, Phase 6).
--
-- Écriture fermée : la RLS autorise la lecture aux utilisateurs authentifiés
-- (l'état n'est pas un secret) mais **aucune** écriture cliente. Les
-- activations passeront par un chemin serveur vérifié (Phase 8) ; en
-- attendant, une bascule se fait par SQL administrateur, sans redéploiement.

create table if not exists public.plugin_state (
  plugin_id            text primary key
                         check (plugin_id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'),
  enabled              boolean not null default false,
  version              text not null,
  granted_capabilities text[] not null default '{}',
  settings             jsonb not null default '{}'::jsonb,
  health               text not null default 'ok'
                         check (health in ('ok', 'degraded', 'quarantined')),
  error_count          integer not null default 0 check (error_count >= 0),
  installed_at         timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.plugin_state is
  'État d''activation des plugins de confiance ; écriture réservée au serveur.';

alter table public.plugin_state enable row level security;

-- Lisible par tout utilisateur connecté : savoir quels plugins tournent n'est
-- pas une donnée personnelle. Aucune politique d'écriture n'est créée : le
-- refus est le défaut.
drop policy if exists plugin_state_read on public.plugin_state;
create policy plugin_state_read on public.plugin_state
  for select to authenticated using (true);

create or replace function public.plugin_state_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

drop trigger if exists plugin_state_touch on public.plugin_state;
create trigger plugin_state_touch
  before update on public.plugin_state
  for each row execute function public.plugin_state_touch();

-- Le plugin de référence existe dès la migration, mais désactivé : personne
-- ne s'attend à ce qu'un plugin s'active tout seul. Aucune capacité accordée.
insert into public.plugin_state (plugin_id, enabled, version, granted_capabilities)
values ('hello-devnet', false, '1.0.0', '{}')
on conflict (plugin_id) do nothing;
