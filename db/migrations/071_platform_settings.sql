-- ============================================================
--  DEVNET — migration 071 : paramètres d'exploitation
--
--  Le module « Paramètres » de la console d'administration n'avait
--  aucun stockage : il affichait le barème XP de « Progression », et
--  son propre commentaire disait que les drapeaux et le mode
--  maintenance « n'ont pas de stockage partagé ». C'est ce que cette
--  migration pose.
--
--  Une seule ligne, `plugin_id = 'platform'`, dans `plugin_state` :
--  la table existe déjà, elle est en `jsonb`, et elle évite d'inventer
--  une seconde table de réglages qui divergerait de la première.
--
--  Trois réglages, et pas un de plus — chacun a un effet visible :
--    maintenance        — ferme l'application aux comptes non admin ;
--    maintenance_message— le texte affiché pendant la fermeture ;
--    signups_enabled    — ferme les inscriptions sans fermer la lecture.
--
--  Les écritures passent par `set_platform_settings`, `security
--  definer`, qui vérifie `is_admin()` **avant** d'écrire et refuse un
--  objet qui ne serait pas un objet JSON. Aucune politique d'écriture
--  n'est créée sur `plugin_state` : la fonction est le seul chemin, et
--  elle journalise dans `admin_audit_log` avec l'identité réelle.
--
--  Rollback : `delete from public.plugin_state where plugin_id =
--  'platform'; drop function public.set_platform_settings(jsonb);`
--  La migration est additive et sans effet sur les données existantes.
-- ============================================================

insert into public.plugin_state (plugin_id, enabled, version, granted_capabilities, settings, health)
values (
  'platform',
  true,
  '1.0.0',
  '{}',
  jsonb_build_object(
    'maintenance', false,
    'maintenance_message', 'DevNet revient dans un instant. Merci de patienter.',
    'signups_enabled', true
  ),
  'ok'
)
on conflict (plugin_id) do nothing;

-- Lecture : tout compte authentifié a besoin de savoir si l'app est
-- fermée, sinon le mode maintenance ne s'affiche qu'aux administrateurs.
-- Les valeurs ne sont pas secrètes ; l'écriture, elle, reste fermée.
alter table public.plugin_state enable row level security;

drop policy if exists plugin_state_platform_read on public.plugin_state;
create policy plugin_state_platform_read
  on public.plugin_state
  for select
  to authenticated
  using (plugin_id = 'platform');

revoke insert, update, delete on public.plugin_state from anon, authenticated;

create or replace function public.set_platform_settings(patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  before jsonb;
  after jsonb;
begin
  if not public.is_admin() then
    raise exception 'réservé à l''administration' using errcode = '42501';
  end if;

  if patch is null or jsonb_typeof(patch) <> 'object' then
    raise exception 'patch doit être un objet JSON' using errcode = '22023';
  end if;

  -- Seules les clés connues sont acceptées : une faute de frappe doit
  -- échouer bruyamment, pas créer silencieusement un réglage fantôme.
  if exists (
    select 1 from jsonb_object_keys(patch) as k
    where k not in ('maintenance', 'maintenance_message', 'signups_enabled')
  ) then
    raise exception 'clé de réglage inconnue' using errcode = '22023';
  end if;

  if patch ? 'maintenance' and jsonb_typeof(patch -> 'maintenance') <> 'boolean' then
    raise exception 'maintenance doit être un booléen' using errcode = '22023';
  end if;
  if patch ? 'signups_enabled' and jsonb_typeof(patch -> 'signups_enabled') <> 'boolean' then
    raise exception 'signups_enabled doit être un booléen' using errcode = '22023';
  end if;
  if patch ? 'maintenance_message' then
    if jsonb_typeof(patch -> 'maintenance_message') <> 'string' then
      raise exception 'maintenance_message doit être une chaîne' using errcode = '22023';
    end if;
    if length(patch ->> 'maintenance_message') > 280 then
      raise exception 'maintenance_message limité à 280 caractères' using errcode = '22023';
    end if;
  end if;

  select settings into before from public.plugin_state where plugin_id = 'platform' for update;
  if before is null then
    raise exception 'réglages de plateforme absents' using errcode = 'P0002';
  end if;

  update public.plugin_state
     set settings = before || patch,
         updated_at = now()
   where plugin_id = 'platform'
  returning settings into after;

  insert into public.admin_audit_log (actor_id, action, target_type, target_id, details)
  values (
    actor,
    'platform.settings',
    'platform',
    'platform',
    jsonb_build_object('before', before, 'after', after, 'patch', patch)
  );

  return after;
end;
$$;

revoke all on function public.set_platform_settings(jsonb) from public, anon;
grant execute on function public.set_platform_settings(jsonb) to authenticated;

comment on function public.set_platform_settings(jsonb) is
  'Écrit les réglages d''exploitation ; réservé aux administrateurs, journalisé dans admin_audit_log.';
