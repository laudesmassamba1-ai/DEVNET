-- ============================================================
--  DEVNET — 020_group_roles.sql
--
--  Les rôles deviennent des pouvoirs.
--
--  Depuis la 005, `group_members.role` existe et est contraint
--  ('owner' | 'moderator' | 'member') — mais **aucune politique RLS ne
--  le lit**. Un modérateur ne pouvait donc strictement rien : le rôle
--  était une étiquette stockée, pas une capacité. C'est exactement le
--  défaut que ce projet combat — un bouton qui affiche une action et
--  ne la fait pas.
--
--  L'ordre imposé : RLS d'abord, interface ensuite. Une UI de rôles
--  posée avant ces politiques produirait des boutons qui échouent en
--  silence (`PGRST301` / 0 lignes affectées).
--
--  Les trois pouvoirs ajoutés :
--
--   1. un modérateur (ou le propriétaire) supprime n'importe quel
--      message de son groupe ;
--   2. un modérateur (ou le propriétaire) retire un **membre simple**
--      du groupe — jamais un autre modérateur, jamais le propriétaire ;
--   3. un modérateur (ou le propriétaire) voit les signalements visant
--      les messages de son groupe, et peut les classer.
--
--  Le changement de **rôle** reste réservé au créateur : modérer un
--  contenu n'est pas nommer des modérateurs.
--
--  Exécute dans Supabase → SQL Editor → Run.
-- ============================================================

-- ── 1. Le rôle de l'appelant ─────────────────────────────────
--
--  Une fonction, pas une sous-requête répétée : trois politiques en
--  ont besoin, et trois copies divergent à la première retouche.
--
--  `security definer` : la fonction lit `group_members` **sans** la
--  RLS de cette table. En `invoker`, une politique de
--  `group_messages` qui relirait `group_members` sous les droits de
--  l'appelant déclencherait une récursion de politiques — et Postgres
--  la coupe avec « infinite recursion detected in policy », ce qui
--  casse la lecture de tous les messages. C'est le même choix que
--  `is_group_member` (004) ; la fonction ne renvoie qu'une chaîne de
--  rôle, pas de ligne, donc elle n'ouvre aucune lecture.
create or replace function public.group_role(gid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select m.role
    from public.group_members m
   where m.group_id = gid
     and m.user_id = auth.uid()
   limit 1;
$$;

-- ── 2. Supprimer un message de groupe ────────────────────────
--
--  La 005 n'ouvrait la suppression qu'à l'auteur et au créateur du
--  groupe. Un modérateur nommé par le créateur ne pouvait pas faire
--  la seule chose pour laquelle il existe.
--
--  La politique se remplace (drop + create) : les politiques d'une
--  même table s'appliquent en OU — en ajoutant une seconde politique
--  sans retirer celle-ci, on cumulerait les droits sans jamais pouvoir
--  en restreindre un.
drop policy if exists "gm_delete" on public.group_messages;
create policy "gm_delete" on public.group_messages
  for delete using (
    auth.uid() = author_id
    or exists (
      select 1 from public.groups g
       where g.id = group_messages.group_id
         and g.created_by = auth.uid()
    )
    or public.group_role(group_id) in ('owner', 'moderator')
  );

-- ── 3. Retirer un membre ─────────────────────────────────────
--
--  Trois cas, jamais un quatrième :
--
--   · partir soi-même (`auth.uid() = user_id`) — le geste existait ;
--   · le créateur retire qui il veut — le geste existait ;
--   · **nouveau** : l'équipe (owner | moderator) retire un **membre
--     simple**. La clause `role = 'member'` porte sur la ligne visée
--     (OLD) : un modérateur ne peut ni exclure un autre modérateur,
--     ni le propriétaire. Modérer, ce n'est pas purger l'équipe.
--
--  Un propriétaire exclu par erreur réintégrerait par réadhésion ;
--  un propriétaire **retiré de force** laisserait un groupe sans
--  créateur — d'où la borne, et non une simple symétrie.
drop policy if exists "group_members_delete" on public.group_members;
create policy "group_members_delete" on public.group_members
  for delete using (
    auth.uid() = user_id
    or exists (
      select 1 from public.groups g
       where g.id = group_members.group_id
         and g.created_by = auth.uid()
    )
    or (
      public.group_role(group_id) in ('owner', 'moderator')
      and role = 'member'
    )
  );

-- ── 4. Le changement de rôle reste au créateur ───────────────
--
--  Politique réécrite à l'identique de la 005, mais **avec** un
--  `with check` explicite : sans lui, la politique d'`update` hérite
--  du `using` — ce qui est équivalent, mais implicite. L'expliciter
--  documente que la ligne écrite doit rester une ligne du même
--  groupe : sans ça, un créateur pourrait déplacer une adhésion vers
--  un autre groupe en réécrivant `group_id`.
drop policy if exists "group_members_update" on public.group_members;
create policy "group_members_update" on public.group_members
  for update
  using (
    exists (
      select 1 from public.groups g
       where g.id = group_members.group_id
         and g.created_by = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.groups g
       where g.id = group_members.group_id
         and g.created_by = auth.uid()
    )
  );

-- ── 5. Les signalements suivent les pouvoirs ─────────────────
--
--  La 011 donnait la lecture des signalements de messages de groupe
--  au **créateur** du groupe, pour une raison précise : « il a déjà
--  le droit de supprimer ces messages ». Cette raison s'applique
--  désormais au modérateur aussi — la migration 020 vient de lui
--  donner ce droit. La fonction est donc étendue, et la politique
--  `reports_update` (classer) suit automatiquement puisqu'elle
--  repose sur cette même fonction.
create or replace function public.can_see_report(r public.reports)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select
    -- mon propre signalement
    r.reporter_id = auth.uid()
    or exists (select 1 from public.posts p
                where p.id = r.post_id and p.author_id = auth.uid())
    or exists (select 1 from public.comments c
                where c.id = r.comment_id and c.author_id = auth.uid())
    or exists (select 1 from public.group_messages m
                where m.id = r.message_id and m.author_id = auth.uid())
    -- mon propre compte signalé : je peux le consulter, l'examiner
    or r.reported_user = auth.uid()
    -- ou le groupe dont je suis le créateur
    or exists (
      select 1
      from public.group_messages m
      join public.groups g on g.id = m.group_id
      where m.id = r.message_id and g.created_by = auth.uid()
    )
    -- ou le groupe que je modère : même raison que le créateur, la
    -- migration 020 m'en a donné le pouvoir de suppression.
    or exists (
      select 1
      from public.group_messages m
      where m.id = r.message_id
        and public.group_role(m.group_id) in ('owner', 'moderator')
    );
$$;

-- Realtime : la modération est un geste partagé. Sans cette
-- publication, le message supprimé restait affiché chez les autres
-- jusqu'au rechargement — un écran qui ment par défaut.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'group_members'
  ) then
    alter publication supabase_realtime add table public.group_members;
  end if;
end $$;
