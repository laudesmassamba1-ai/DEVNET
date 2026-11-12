-- ============================================================
--  021 — L'appartenance à un groupe est une ligne, pas un tableau
--
--  Depuis la 005, une adhésion est une **ligne** dans
--  `group_members`, et c'est cette table que le client écrit : on
--  rejoint un groupe en insérant `(group_id, user_id)`. Le tableau
--  `groups.members` n'est plus qu'un vestige — sa mise à jour est
--  réservée au créateur du groupe, donc un rejoignant ne peut plus
--  l'écrire.
--
--  Or `is_group_member` (004) lisait encore `groups.members`. La
--  fonction répondait donc « non » à une personne réellement membre :
--  elle voyait la liste des groupes, cliquait, et l'écran lui
--  refusait les canaux et les messages — sans un mot d'explication,
--  puisqu'une RLS qui cache une ligne réussit en silence.
--
--  On lit désormais la table de jonction. Le tableau reste en secours
--  pour les groupes créés avant la 005 (le backfill de cette migration
--  les a normalement couverts, mais une ligne oubliée ne doit pas
--  verrouiller un membre).
--
--  `security definer` est conservé : la fonction lit `group_members`
--  **sans** passer par ses politiques, ce qui évite la récursion
--  « infinite recursion detected in policy » — le même choix que
--  `group_role` (020).
-- ============================================================

create or replace function public.is_group_member(g uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.group_members m
    where m.group_id = g and m.user_id = auth.uid()
  )
  or exists (
    select 1 from public.groups gr
    where gr.id = g and auth.uid() = any (gr.members)
  );
$$;

comment on function public.is_group_member(uuid) is
  'Appartenance à un groupe : une ligne dans group_members, ou le tableau historique groups.members.';
