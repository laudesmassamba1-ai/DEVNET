-- =============================================================
-- 016 — Réactions et reposts
--
-- Deux tables de jonction, sur le modèle exact de `post_likes` : la
-- vérité est une **ligne**, jamais un compteur que le client écrit.
--
-- Pourquoi ne pas étendre `post_likes` avec une colonne `emoji` :
-- parce que le like et la réaction ne sont pas le même geste. Un like
-- est binaire et unique (on aime ou on n'aime pas). Une réaction
-- choisit une **valeur** dans une liste fermée. Les meler dans une
-- seule table obligerait à distinguer "ligne vide = like" de "ligne
-- emoji = réaction", donc à Nullable une colonne dont l'absence
-- aurait deux significations. Deux tables, deux clés primaires, deux
-- déclencheurs : on ne mélange pas deux concepts dans une ligne.
--
-- Pourquoi `reposts` n'a pas de colonne `text` :
-- un repost ne réécrit rien. Il dit « ce post est aussi dans mon fil ».
-- Le post original reste à son auteur, et le fil de celui qui le
-- republie le montre avec sa source. Si on dupliquait le texte, on
-- aurait deux vérités à faire diverger — c'est le bug classique du
-- « partage avec commentaire », qu'on ne veut pas ici.
--
-- Règle du dépôt : comme `post_likes`, ces tables n'ont pas de cache
-- propre. Les compteurs vivent sur `posts` et sont écrits par les
-- déclencheurs, jamais par le client.
-- =============================================================

-- ── Réactions ──────────────────────────────────────────────────

create table if not exists public.reactions (
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default now(),

  -- Une réaction par personne et par publication : c'est la clé
  -- primaire qui garantit le « une seule réaction », pas le code
  -- client. Changer de réaction, c'est donc retirer puis poser.
  primary key (post_id, user_id),

  -- La liste fermée est dans l'interface (`lib/reactions.ts`). Elle est
  -- déclarée ici aussi pour que la base refuse une valeur que
  -- l'écran ne sait pas afficher : un nom d'icône écrit à la main ne
  -- doit pas créer une réaction que le picker ne sait pas compter.
  constraint reactions_emoji_check check (emoji in ('check','like','smile','eye','droplet','flame'))
);

create index if not exists reactions_user_idx
  on public.reactions(user_id, created_at desc);

alter table public.reactions enable row level security;

-- Lecture ouverte à qui peut lire le post : une réaction est publique
-- au même titre que le like, c'est ce qui permet d'afficher un total
-- à quelqu'un qui n'est pas connecté.
drop policy if exists "reactions_read" on public.reactions;
create policy "reactions_read" on public.reactions
  for select using (true);

drop policy if exists "reactions_insert" on public.reactions;
create policy "reactions_insert" on public.reactions
  for insert with check (auth.uid() = user_id);

drop policy if exists "reactions_delete" on public.reactions;
create policy "reactions_delete" on public.reactions
  for delete using (auth.uid() = user_id);

-- Pas de `update` : changer de réaction se fait en retirant puis en
-- posant. Une ligne de réaction est un **geste**, comme un message : on
-- ne le réécrit pas, on en refait un autre. C'est la même raison que
-- l'absence de politique `update` sur `comments`.

-- ── Reposts ────────────────────────────────────────────────────

create table if not exists public.reposts (
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),

  -- Un repost par personne et par publication : republier deux fois
  -- le même post dans son propre fil n'est pas « deux fois », c'est
  -- du bruit. La clé primaire le rend impossible.
  primary key (post_id, user_id)
);

create index if not exists reposts_user_idx
  on public.reposts(user_id, created_at desc);

alter table public.reposts enable row level security;

drop policy if exists "reposts_read" on public.reposts;
create policy "reposts_read" on public.reposts
  for select using (true);

drop policy if exists "reposts_insert" on public.reposts;
create policy "reposts_insert" on public.reposts
  for insert with check (auth.uid() = user_id);

drop policy if exists "reposts_delete" on public.reposts;
create policy "reposts_delete" on public.reposts
  for delete using (auth.uid() = user_id);

-- ── Compteurs sur `posts` ──────────────────────────────────────

-- Les deux colonnes sont des **caches**, comme `likes` et `comments` :
-- écrites par un déclencheur, jamais par le client. Elles sont retirées
-- du droit de mise à jour — c'est exactement la même opération que le
-- `revoke update (likes, liked_by, comments)` de la migration 005, et
-- pour la même raison : la RLS raisonne en lignes, pas en colonnes, donc
-- c'est le `revoke` qui empêche d'écrire `reposts = 9999`.
alter table public.posts
  add column if not exists reactions integer not null default 0,
  add column if not exists reposts   integer not null default 0;

revoke update (reactions, reposts) on public.posts from authenticated;

create or replace function public.sync_post_reactions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p uuid;
begin
  p := coalesce(new.post_id, old.post_id);

  update public.posts
     set reactions = (select count(*) from public.reactions r where r.post_id = p)
   where id = p;

  return coalesce(new, old);
end;
$$;

drop trigger if exists on_post_reactions_change on public.reactions;
create trigger on_post_reactions_change
  after insert or delete on public.reactions
  for each row execute function public.sync_post_reactions();

create or replace function public.sync_post_reposts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p uuid;
begin
  p := coalesce(new.post_id, old.post_id);

  update public.posts
     set reposts = (select count(*) from public.reposts r where r.post_id = p)
   where id = p;

  return coalesce(new, old);
end;
$$;

drop trigger if exists on_post_reposts_change on public.reposts;
create trigger on_post_reposts_change
  after insert or delete on public.reposts
  for each row execute function public.sync_post_reposts();

-- ── Mise à jour des compteurs existants ───────────────────────
-- Les colonnes sont créées à 0 ; on les recalcule une fois pour que les
-- publications déjà Aimées n'apparaissent pas sans réaction ni repost.
update public.posts p
   set reactions = (select count(*) from public.reactions r where r.post_id = p.id),
       reposts   = (select count(*) from public.reposts  r where r.post_id = p.id);

-- ── Realtime ───────────────────────────────────────────────────
-- Une réaction doit apparaître chez les autres sans rechargement : c'est
-- le même besoin que le like, qui est déjà dans la publication.
alter publication supabase_realtime add table public.reactions;
alter publication supabase_realtime add table public.reposts;

-- ── Notifications ──────────────────────────────────────────────
-- On ne notifie **pas** les réactions séparément : le like notifie
-- déjà, et notifier deux fois pour le même geste ferait deux pastilles
-- pour un seul clic. Une réaction remplace le like comme geste
-- social ; la notification reste celle du like.