-- =============================================================
-- 017 — Accusés de lecture
--
-- Une colonne `last_read_at` sur **l'adhésion**, pas sur le message.
--
-- Lire une conversation de 200 messages n'est pas 200 événements : c'est
-- un état. `last_read_at` le dit en une ligne, se recalcule au lieu de
-- se pousser, et survit au changement d'appareil — ce qu'un drapeau
-- « lu » posé au clic ne garantit pas.
--
-- Pourquoi deux tables (`conversation_members` et `channel_members`) :
-- parce qu'elles répondent à deux questions différentes. Une
-- conversation privée a deux participants : « l'autre a-t-il lu ? »
-- admet une réponse par `✓✓`. Un canal a dix membres : la même question
-- n'admet qu'une fraction (« lu par 4 sur 10 »). Un `✓✓` dans un canal
-- de dix personnes signifierait « lu par quelqu'un », ce que personne ne
-- croit en voyant un double tick.
--
-- `notifications.read_at` (migration 010) reste la source de vérité
-- pour la pastille de non-lus du centre de notifications. Les deux ne se
-- contredisent pas : l'une mesure « a-t-on ouvert la conversation », l'autre
-- « a-t-on ouvert le centre ». On ne les fusionne pas.
-- =============================================================

alter table public.conversation_members
  add column if not exists last_read_at timestamptz;

alter table public.channel_members
  add column if not exists last_read_at timestamptz;

-- ── Le droit d'écriture ───────────────────────────────────────
-- `conversation_members` n'a **aucune** politique d'insertion (migration
-- 006) : l'adhésion se déduit de `conversations.participants`. On ne
-- touche pas à ça — mais on ouvre maintenant la mise à jour d'une
-- seule colonne, et seulement sur sa propre ligne.
--
-- C'est la restriction par colonne qui compte : la RLS dit quelles
-- lignes on peut toucher, jamais quelles colonnes. Sans le `revoke`
-- ci-dessous, un utilisateur pourrait écrire `conversation_id` ou
-- `user_id` sur sa propre ligne et s'y faire inviter — donc lire une
-- conversation dont il n'est pas membre, puisque `dm_read` passe par
-- cette table.
revoke update on public.conversation_members from authenticated;
grant update (last_read_at) on public.conversation_members to authenticated;

drop policy if exists "cm_update_own" on public.conversation_members;
create policy "cm_update_own" on public.conversation_members
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Même mécanisme sur les canaux. `channel_members` avait déjà une
-- politique d'insertion (on peut rejoindre un canal), donc on se contente
-- de borner la mise à jour.
revoke update on public.channel_members from authenticated;
grant update (last_read_at) on public.channel_members to authenticated;

drop policy if exists "channel_members_update_own" on public.channel_members;
create policy "channel_members_update_own" on public.channel_members
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Pas de realtime ici, et c'est volontaire : `last_read_at` n'est pas un
-- événement à voir arriver, c'est un **état** que l'écran relit quand il
-- veut. Le pousser au fil des messages ferait scintiller les doubles
-- ticks sur toute la conversation à chaque ouverture d'un autre appareil.

-- ── Amorçage ──────────────────────────────────────────────────
-- Les membres qui n'ont jamais ouvert leur conversation ont un `null`,
-- ce qui veut dire « pas encore lu » — et non « lu à la création ».
-- On ne remplit donc rien : un `last_read_at` posé au déploiement
-- ferait dire « lu » sur des messages que personne n'a vus.