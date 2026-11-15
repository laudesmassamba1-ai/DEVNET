-- =============================================================
-- 018 — Signets, discussions, messagerie
--
-- Quatre familles d'ajouts, toutes sur le même modèle que le reste
-- du projet : la vérité est une **ligne**, le compteur est un cache
-- écrit par un déclencheur, et le client ne touche qu'à ce qui lui appartient.
--
-- 1. `bookmarks` — le signet d'une publication.
-- 2. `comments.parent_id` — une réponse dans le fil d'un commentaire.
-- 3. `message_reactions` / `message_pins` — sur les messages, qu'ils
--    soient privés ou de groupe.
-- 4. `stories` — une story, avec son expiration.
-- =============================================================

-- ── 1. Signets ─────────────────────────────────────────────────

create table if not exists public.bookmarks (
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),

  -- Un signet par personne et par publication : « enregistrer » deux
  -- fois la même publication n'est pas deux signets, c'est du bruit.
  primary key (post_id, user_id)
);

create index if not exists bookmarks_user_idx
  on public.bookmarks(user_id, created_at desc);

alter table public.bookmarks enable row level security;

-- La lecture est **privée**. C'est la différence avec `reactions` ou
-- `post_likes`, qui sont publics parce qu'ils sont des compteurs
-- affichés sur la carte. Un signet est une liste de lecture : elle
-- décrit ce que **vous** avez choisi de garder, et personne d'autre n'a
-- à le savoir. Une lecture publique des signets reviendrait à publier
-- son registre de lecture à tout le monde.
drop policy if exists "bookmarks_read" on public.bookmarks;
create policy "bookmarks_read" on public.bookmarks
  for select using (auth.uid() = user_id);

drop policy if exists "bookmarks_insert" on public.bookmarks;
create policy "bookmarks_insert" on public.bookmarks
  for insert with check (auth.uid() = user_id);

drop policy if exists "bookmarks_delete" on public.bookmarks;
create policy "bookmarks_delete" on public.bookmarks
  for delete using (auth.uid() = user_id);

alter publication supabase_realtime add table public.bookmarks;

-- ── 2. Réponses en fil ─────────────────────────────────────────

-- Un commentaire peut répondre d'un autre commentaire du **même**
-- post. Pas de trigger, pas de table à part : la colonne suffit, et
-- `on delete cascade` emporte les réponses avec leur parent — donc un
-- fil ne peut pas se retrouver avec des réponses orphelines, que le
-- panneau de commentaires afficherait alors sans contexte.
alter table public.comments
  add column if not exists parent_id uuid references public.comments(id) on delete cascade;

create index if not exists comments_parent_idx
  on public.comments(parent_id, created_at);

-- La profondeur est bornée à **un** niveau de réponse : au-delà, un
-- fil devient illisible sur un téléphone et la notification devient
-- impossible à formuler. Le client ne reçoit donc qu'un parent direct,
-- et la réponse à une réponse s'applique au commentaire racine.
alter table public.comments
  add constraint comments_parent_not_self check (parent_id is null or parent_id <> id);

-- ── 3. Réactions et épingles sur les messages ─────────────────
--
-- Une seule table pour les messages privés **et** ceux de groupe.
--
-- Le projet a déjà tranché cette question pour les signalements
-- (migration 011) : des cibles qui n'ont rien à voir dans la même
-- table se portent dans une seule table avec une colonne de type. Deux
-- tables ici doublerait les politiques, les index et les tests pour
-- une différence qui tient dans un enum.
create table if not exists public.message_reactions (
  id          uuid primary key default gen_random_uuid(),
  target_type text not null,
  target_id   uuid not null,
  user_id     uuid not null references public.users(id) on delete cascade,
  emoji       text not null,
  created_at  timestamptz not null default now(),

  -- `target_id` ne peut pas porter de clé étrangère : il désigne
  -- tantôt une ligne de `direct_messages`, tantôt une de
  -- `group_messages`. L'intégrité est donc vérifiée par un déclencheur
  -- plutôt que par le schéma — c'est le prix assumé du choix, et il
  -- est explicite.
  constraint message_reactions_target_check
    check (target_type in ('direct_message', 'group_message')),

  -- Une réaction par personne et par message, pour la même icône qu'une
  -- réaction sur une publication.
  constraint message_reactions_emoji_check
    check (emoji in ('check','like','smile','eye','droplet','flame'))
);

create index if not exists message_reactions_target_idx
  on public.message_reactions(target_type, target_id);
create index if not exists message_reactions_user_idx
  on public.message_reactions(user_id, created_at desc);

alter table public.message_reactions enable row level security;

-- Même lecture que les réactions de publication : elles s'affichent
-- sur la bulle, donc tout le monde les voit.
drop policy if exists "message_reactions_read" on public.message_reactions;
create policy "message_reactions_read" on public.message_reactions
  for select using (true);

drop policy if exists "message_reactions_insert" on public.message_reactions;
create policy "message_reactions_insert" on public.message_reactions
  for insert with check (auth.uid() = user_id);

drop policy if exists "message_reactions_delete" on public.message_reactions;
create policy "message_reactions_delete" on public.message_reactions
  for delete using (auth.uid() = user_id);

-- Un épingle est comme un signet : il décrit ce que **moi** je garde
-- sous les yeux dans une conversation. Il n'est donc pas public, et il
-- est destructif pour tout le monde quand on le retire.
create table if not exists public.message_pins (
  id          uuid primary key default gen_random_uuid(),
  target_type text not null,
  target_id   uuid not null,
  user_id     uuid not null references public.users(id) on delete cascade,
  created_at  timestamptz not null default now(),

  constraint message_pins_target_check
    check (target_type in ('direct_message', 'group_message'))
);

create index if not exists message_pins_target_idx
  on public.message_pins(target_type, target_id);
create index if not exists message_pins_user_idx
  on public.message_pins(user_id, created_at desc);

alter table public.message_pins enable row level security;

drop policy if exists "message_pins_read" on public.message_pins;
create policy "message_pins_read" on public.message_pins
  for select using (auth.uid() = user_id);

drop policy if exists "message_pins_insert" on public.message_pins;
create policy "message_pins_insert" on public.message_pins
  for insert with check (auth.uid() = user_id);

drop policy if exists "message_pins_delete" on public.message_pins;
create policy "message_pins_delete" on public.message_pins
  for delete using (auth.uid() = user_id);

-- ── Répondre à un message ──────────────────────────────────────

alter table public.direct_messages
  add column if not exists reply_to_id uuid references public.direct_messages(id) on delete set null;

alter table public.group_messages
  add column if not exists reply_to_id uuid references public.group_messages(id) on delete set null;

-- ── 4. Stories ─────────────────────────────────────────────────

create table if not exists public.stories (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid not null references public.users(id) on delete cascade,
  caption    text not null default '',
  -- Le média est une référence de stockage, pas une image en base :
  -- une story qui contient 400 Ko de données dans une colonne texte
  -- ferait exploser chaque lecture de la liste.
  media_url  text not null default '',
  created_at timestamptz not null default now(),
  -- Une story est **périmable** : c'est ce qui la distingue d'une
  -- publication. L'index porte sur cette colonne parce que la liste se
  -- lit toujours par « les stories encore vivantes », jamais par
  -- « toutes les stories ».
  expires_at timestamptz not null default (now() + interval '24 hours')
);

create index if not exists stories_live_idx
  on public.stories(expires_at desc, created_at desc);
create index if not exists stories_author_idx
  on public.stories(author_id, created_at desc);

alter table public.stories enable row level security;

drop policy if exists "stories_read" on public.stories;
create policy "stories_read" on public.stories
  for select using (expires_at > now());

drop policy if exists "stories_insert" on public.stories;
create policy "stories_insert" on public.stories
  for insert with check (auth.uid() = author_id);

-- Pas de `update` : une story publiée ne se réécrit pas. Elle se
-- remplace, et l'historique n'est pas un objet que l'on réécrit —
-- même raison que l'absence de `update` sur `comments`.

drop policy if exists "stories_delete" on public.stories;
create policy "stories_delete" on public.stories
  for delete using (auth.uid() = author_id);

-- La purge des stories périmées est un travail de fond : elle n'a pas
-- besoin d'être une politique. Le trigger de suppression différée est
-- volontairement absent — une ligne qui a expiré ne pollue plus aucune
-- requête, et la supprimer par lots au chargement est plus simple
-- qu'un trigger qui bloque l'écriture pour une ligne morte.
alter publication supabase_realtime add table public.stories;