-- ============================================================
--  DEVNET — migration v6 : messagerie privée
--  Supabase → SQL Editor → Run
--  (après 005_social.sql)
--
--  Deux trous, dont un que le mode démonstration rendait invisible.
--  Ce n'est pas une fonctionnalité : rien ne change pour l'utilisateur,
--  sauf que deux choses cessent d'être fausses.
--
--  1. `conversation_members` n'était alimenté QUE par la requête de
--     report de la migration 002. L'application, elle, crée une
--     conversation en insérant une ligne dans `conversations` et
--     n'écrivait jamais dans la table de jonction. Résultat : toute
--     conversation créée depuis l'application n'avait aucun membre, et
--     `dm_read` — qui exige une ligne dans `conversation_members` —
--     refusait d'afficher la conversation qu'on venait d'ouvrir.
--
--     Le mode démo ne l'a jamais montré : il n'y a pas de RLS là-bas,
--     donc la lecture passait toujours. Un bug invisible en démo et
--     bloquant en production, ce qui est la pire combinaison
--     possible. La règle : tout ce que le mode démo ne peut pas
--     vérifier, il faut le lire comme un doute.
--
--  2. `cm_insert` autorisait `auth.uid() = user_id`. Comme la lecture
--     des MP passe par cette table de jonction, s'y ajouter de
--     soi-même dans une conversation suffisait à en lire le contenu.
--     La règle d'appartenance était donc entièrement déléguée au
--     client — c'est-à-dire à personne.
--
--  On ne touche pas à `can_message()` : la restriction qui en découle
--  a été levée (voir `MEMO.md`, décisions fermées). Le principe qu'elle
--  exprimait — un étudiant ne peut pas inonder un professionnel — reste
--  vrai, mais il est porté par la réputation et la signalature, pas par
--  une porte d'entrée que le produit lui-même refuse d'emprunter.
-- ============================================================

-- ------------------------------------------------------------
--  1. L'adhésion vient du déclencheur, plus du client
-- ------------------------------------------------------------
--
--  On ne cherche pas à deviner qui a le droit d'être membre : la
--  liste est déjà dans `conversations.participants`, écrite au moment
--  de la création. La recopier est donc sans risque et sans
--  interprétation.
--
--  `security definer` parce que le déclencheur écrit alors que la RLS
--  l'en empêcherait : c'est volontaire, et c'est la seule écriture que
--  l'application n'a pas le droit de faire.

create or replace function public.sync_conversation_members()
returns trigger
language plpgsql
security definer
set search_path = public as $$
begin
  insert into public.conversation_members (conversation_id, user_id)
  select new.id, unnest(new.participants)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists conversations_sync_members on public.conversations;
create trigger conversations_sync_members
  after insert on public.conversations
  for each row execute function public.sync_conversation_members();

-- Rappel de report : si des conversations ont été créées depuis la
-- migration 002, leurs membres manquent toujours.
insert into public.conversation_members (conversation_id, user_id)
select c.id, unnest(c.participants)
from public.conversations c
on conflict do nothing;

-- ------------------------------------------------------------
--  2. Le client n'ajoute plus de membre lui-même
-- ------------------------------------------------------------
--
--  L'appartenance se déduit d'avoir parlé dans la conversation, et les
--  lignes de message sont rendues par `dm_read`. La chaîne est donc
--  cohérente de bout en bout — on n'ajoute pas son propre nom à une
--  liste dont on contrôle l'entrée.
--
--  On ne laisse pas `auth.uid() = user_id` « au cas où » : c'est
--  précisément l'ascenseur qui mène à la lecture des MP des autres.

drop policy if exists "cm_insert" on public.conversation_members;
create policy "cm_insert" on public.conversation_members
  for insert with check (false);