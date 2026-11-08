-- ============================================================
--  DEVNET — migration 47 : interactions de stories
--
--  Une story n'était qu'un texte périssable. Ce qu'on fait **pendant**
--  qu'on la regarde manquait : aimer, répondre, poser un sticker. Trois
--  gestes, trois tables, plus un catalogue de stickers de base.
--
--  Trois décisions structurantes :
--
--  1. Les coordonnées d'un sticker sont **normalisées** (0–1). Une story
--     se regarde en 9:16 sur téléphone et en portrait centré sur
--     bureau ; des pixels absolus casseraient l'un des deux.
--  2. Le compteur de likes et le nombre de vues ne sont lisibles que
--     par **l'auteur**. Ce ne sont pas des métriques publiques : une
--     story n'est pas un concours.
--  3. Une réponse est une ligne de `story_replies`, avec son
--     destinataire. Elle n'est pas un commentaire public.
-- ============================================================

-- ------------------------------------------------------------
--  1. Catalogue de stickers (base, avant les stickers créés)
-- ------------------------------------------------------------
--  `kind` distingue déjà le texte d'une image : les stickers créés par
--  les utilisateurs arriveront avec `kind = 'image'` et une clé de
--  stockage. Le rendu d'un sticker de base est son `glyphe` ; rien
--  n'est stocké en binaire ici, et c'est volontaire : un catalogue ne
--  doit pas peser dans chaque lecture de story.

create table if not exists public.stickers (
  id         text primary key,
  pack       text not null default 'devnet',
  kind       text not null default 'texte'
             check (kind in ('texte', 'image', 'animé')),
  glyph      text not null default '',
  name       text not null,
  created_at timestamptz not null default now(),
  constraint stickers_texte_a_un_glyphe
    check (kind <> 'texte' or char_length(glyph) between 1 and 8)
);

insert into public.stickers (id, pack, kind, glyph, name) values
  ('feu',     'devnet', 'texte', '🔥', 'Feu'),
  ('shipit',  'devnet', 'texte', '🚀', 'Ship it'),
  ('merge',   'devnet', 'texte', '✅', 'Fusionné'),
  ('bug',     'devnet', 'texte', '🐛', 'Bug'),
  ('idee',    'devnet', 'texte', '💡', 'Idée'),
  ('respect', 'devnet', 'texte', '🫡', 'Respect'),
  ('pause',   'devnet', 'texte', '☕', 'Pause'),
  ('cerveau', 'devnet', 'texte', '🧠', 'Cerveau')
on conflict (id) do nothing;

-- ------------------------------------------------------------
--  2. Likes de story
-- ------------------------------------------------------------
--  Même forme que les likes de publication : une ligne, clé primaire
--  composite, donc l'insertion d'un doublon est le signal du retrait.
--  Aucune colonne compteur sur `stories` : un compteur à maintenir par
--  déclencheur ne sert qu'à une information visible par l'auteur, et se
--  recalcule très bien.

create table if not exists public.story_likes (
  story_id   uuid not null references public.stories(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (story_id, user_id)
);

create index if not exists story_likes_user_idx
  on public.story_likes (user_id, story_id);

-- ------------------------------------------------------------
--  3. Vues de story
-- ------------------------------------------------------------
--  `on conflict do nothing` côté application : revoir une story ne
--  fabrique pas une seconde vue. La lecture n'est ouverte qu'à
--  l'auteur — « qui a vu » est une information de l'auteur, pas un
--  classement public.

create table if not exists public.story_views (
  story_id  uuid not null references public.stories(id) on delete cascade,
  viewer_id uuid not null references public.users(id) on delete cascade,
  seen_at   timestamptz not null default now(),
  primary key (story_id, viewer_id)
);

create index if not exists story_views_story_idx
  on public.story_views (story_id);

-- ------------------------------------------------------------
--  4. Réponses privées
-- ------------------------------------------------------------
--  `to_id` est figé à la réponse : si la story change d'auteur (elle ne
--  le peut pas), la réponse garde son destinataire. La contrainte de
--  longueur reprend celle de l'écran, pour que la base refuse ce que
--  l'interface refuse.

create table if not exists public.story_replies (
  id         uuid primary key default gen_random_uuid(),
  story_id   uuid not null references public.stories(id) on delete cascade,
  from_id    uuid not null references public.users(id) on delete cascade,
  to_id      uuid not null references public.users(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now(),
  constraint story_replies_pas_soi_meme check (from_id <> to_id),
  constraint story_replies_longueur check (char_length(body) between 1 and 500)
);

create index if not exists story_replies_story_idx
  on public.story_replies (story_id, created_at desc);
create index if not exists story_replies_to_idx
  on public.story_replies (to_id, created_at desc);

-- ------------------------------------------------------------
--  5. Stickers posés sur une story
-- ------------------------------------------------------------
--  `x` et `y` sont le **centre** du sticker, en fraction de la surface
--  (0–1). `scale` borne le pincement, `rotation` la rotation, `z`
--  l'empilement. Un sticker hors de ces bornes est un bug d'écran, pas
--  une expression : la base le refuse.

create table if not exists public.story_stickers (
  id         uuid primary key default gen_random_uuid(),
  story_id   uuid not null references public.stories(id) on delete cascade,
  sticker_id text not null references public.stickers(id) on delete restrict,
  placed_by  uuid not null references public.users(id) on delete cascade,
  x          double precision not null check (x between 0 and 1),
  y          double precision not null check (y between 0 and 1),
  scale      double precision not null default 1 check (scale between 0.5 and 3),
  rotation   double precision not null default 0 check (rotation between -180 and 180),
  z          integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists story_stickers_story_idx
  on public.story_stickers (story_id, z);

-- ------------------------------------------------------------
--  6. RLS
-- ------------------------------------------------------------
--  Rappel de la règle du projet : une story vivante est lisible par
--  tout membre ; une story expirée n'existe plus. Les interactions
--  suivent la même horloge.

-- Deux fonctions d'appui, `security definer` : une politique ne doit pas
-- dépendre de la lisibilité d'une autre table, sinon elle hérite de sa RLS
-- et refuse ce qu'elle voulait autoriser (une story vivante d'un inconnu,
-- par exemple). Elles ne disent rien d'autre que « cette story est-elle
-- vivante » et « qui l'a écrite ».

create or replace function public.story_is_live(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.stories s
     where s.id = target and s.expires_at > now()
  );
$$;

create or replace function public.story_author(target uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.author_id from public.stories s where s.id = target;
$$;

revoke all on function public.story_is_live(uuid) from public;
revoke all on function public.story_author(uuid) from public;
grant execute on function public.story_is_live(uuid) to authenticated, anon;
grant execute on function public.story_author(uuid) to authenticated, anon;

alter table public.stickers enable row level security;
alter table public.story_likes enable row level security;
alter table public.story_views enable row level security;
alter table public.story_replies enable row level security;
alter table public.story_stickers enable row level security;

-- Catalogue : lecture par tous, écriture réservée aux migrations
-- (aucune politique d'écriture, donc le propriétaire seulement).
drop policy if exists "stickers_read" on public.stickers;
create policy "stickers_read" on public.stickers
  for select using (true);

-- Likes : on aime une story vivante, on lit les siens et ceux de sa
-- propre story, on retire le sien.
drop policy if exists "story_likes_read" on public.story_likes;
create policy "story_likes_read" on public.story_likes
  for select using (
    user_id = auth.uid()
    or public.story_author(story_likes.story_id) = auth.uid()
  );

drop policy if exists "story_likes_insert" on public.story_likes;
create policy "story_likes_insert" on public.story_likes
  for insert with check (
    user_id = auth.uid()
    and public.story_is_live(story_likes.story_id)
    and public.story_author(story_likes.story_id) <> auth.uid()
  );

drop policy if exists "story_likes_delete" on public.story_likes;
create policy "story_likes_delete" on public.story_likes
  for delete using (user_id = auth.uid());

-- Vues : chacun marque la sienne, seul l'auteur lit qui a vu.
drop policy if exists "story_views_insert" on public.story_views;
create policy "story_views_insert" on public.story_views
  for insert with check (
    viewer_id = auth.uid()
    and public.story_is_live(story_views.story_id)
  );

drop policy if exists "story_views_read" on public.story_views;
create policy "story_views_read" on public.story_views
  for select using (public.story_author(story_views.story_id) = auth.uid());

-- Réponses : on écrit au nom de soi, vers l'auteur ; les deux parties
-- lisent l'échange.
drop policy if exists "story_replies_insert" on public.story_replies;
create policy "story_replies_insert" on public.story_replies
  for insert with check (
    from_id = auth.uid()
    and public.story_is_live(story_replies.story_id)
    and public.story_author(story_replies.story_id) = story_replies.to_id
    and story_replies.to_id <> auth.uid()
  );

drop policy if exists "story_replies_read" on public.story_replies;
create policy "story_replies_read" on public.story_replies
  for select using (from_id = auth.uid() or to_id = auth.uid());

-- Stickers posés : lecture avec la story vivante, pose par son auteur
-- uniquement — on décore sa propre story, on ne colle pas chez les
-- autres.
drop policy if exists "story_stickers_read" on public.story_stickers;
create policy "story_stickers_read" on public.story_stickers
  for select using (
    public.story_is_live(story_stickers.story_id)
    or public.story_author(story_stickers.story_id) = auth.uid()
  );

drop policy if exists "story_stickers_insert" on public.story_stickers;
create policy "story_stickers_insert" on public.story_stickers
  for insert with check (
    placed_by = auth.uid()
    and public.story_is_live(story_stickers.story_id)
    and public.story_author(story_stickers.story_id) = auth.uid()
  );

drop policy if exists "story_stickers_delete" on public.story_stickers;
create policy "story_stickers_delete" on public.story_stickers
  for delete using (placed_by = auth.uid());
