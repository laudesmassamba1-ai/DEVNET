-- ============================================================
--  DEVNET — migration v11 : signalements
--  Supabase → SQL Editor → Run
--  (après 010_notifications.sql)
--
--  Un réseau où l'on peut publier, commenter, suivre et écrire en
--  privé, **sans aucun moyen de signaler un contenu**, n'est pas
--  démontrable devant un jury. C'est le trou que cette migration
--  bouche.
--
--  Deux décisions, et ce qu'elles coûtent.
--
--  1. **Aucune cible polymorphe.** `target_type` + `target_id` eut été
--     plus court, mais une colonne `uuid` sans clé étrangère ne peut
--     pas dire si la cible existe encore. Un signalement sur un post
--     effacé resterait à jamais, et l'écran de modération afficherait un
--     vide sans explication. On suit donc le motif de `notifications`
--     (migration 010) : quatre colonnes de clé étrangère, nulles ou
--     non, et une contrainte qui impose **exactement une** cible. Le
--     `on delete cascade` vient alors gratuitement.
--
--     `target_type` n'est pas une colonne saisie : c'est une colonne
--     **générée**, déduite des quatre autres. Elle ne peut donc pas
--     mentir — impossible d'avoir une ligne qui se dit `post` alors que
--     sa cible est un commentaire. Dupliquer l'information pour la
--     confort de la requête, c'est créer une seconde vérité à garder
--     synchronisée à la main.
--
--  2. **La modération ne donne aucun pouvoir nouveau.** Il n'existe
--     aucune notion d'administrateur dans ce schéma, et en créer une
--     serait une décision de produit que cette migration n'a pas à
--     prendre. Les rapports sont donc visibles par **deux personnes
--     qui ont déjà les pouvoirs** :
--
--       · l'auteur du contenu signalé — c'est la clé. Il apprend qu'un
--         contenu a été signalé et peut le supprimer lui-même. C'est de
--         l'auto-modération, elle n'a besoin d'aucun juge.
--       · le créateur du groupe, si la cible est un message de groupe.
--
--     Personne d'autre ne lit la table. Le signalant voit les siens,
--     pour savoir ce qu'il a signalé — et c'est tout.
--
--     Conséquence assumée : **ce n'est pas une file de modération
--     globale.** Un fil public comme un commentaire n'a pas de
--     autorité désignée au-dessus de son auteur. Ajouter un rôle
--     `site_moderator` est une décision à part entière, et elle
--     touche `users` — pas quelque chose à glisser dans une migration
--     de signalement.
-- ============================================================


-- ------------------------------------------------------------
-- 1. La table
-- ------------------------------------------------------------

create table if not exists public.reports (
  id            uuid primary key default gen_random_uuid(),

  -- Qui signale. `cascade` : le compte effacé emporte ses signalements,
  -- puisque personne ne peut plus y répondre.
  reporter_id   uuid not null references public.users(id) on delete cascade,

  -- La cible : exactement une, garantie plus bas.
  post_id       uuid references public.posts(id)         on delete cascade,
  comment_id    uuid references public.comments(id)      on delete cascade,
  message_id    uuid references public.group_messages(id) on delete cascade,
  reported_user uuid references public.users(id)         on delete cascade,

  -- Le type, **déduit**. Jamais écrit par le client.
  target_type   text generated always as (
                  case
                    when post_id       is not null then 'post'
                    when comment_id    is not null then 'comment'
                    when message_id    is not null then 'group_message'
                    else 'user'
                  end
                ) stored,

  -- Un motif fermé : un champ libre serait un champ que le client
  -- contrôle, donc une catégorie qu'on ne peut pas compter. `other`
  -- porte le récit, `details` le contexte — et `details` est borné par
  -- la base, pas par l'écran.
  reason        text not null
                  check (reason in ('harassment','spam','hate','scam','other')),
  details       text not null default ''
                  check (char_length(details) <= 1000),

  -- `open` → traité ou non. Un signalement **ne se supprime jamais** :
  -- c'est une trace, et l'effacer rendrait impossible de savoir qu'un
  -- contenu a été signalé. On le classe, donc.
  status        text not null default 'open'
                  check (status in ('open','resolved','dismissed')),
  resolved_at   timestamptz,
  created_at    timestamptz not null default now(),

  -- Exactement une cible. Sans cette contrainte, une ligne sans cible
  -- n'aurait rien à afficher et une ligne à deux cibles en aurait deux.
  constraint reports_one_target
    check (num_nonnulls(post_id, comment_id, message_id, reported_user) = 1),

  -- Un signalement « résolu » porte sa date, un « ouvert » non. Sinon
  -- l'écran doit deviner si la date est vide ou oubliée.
  constraint reports_resolution_dated
    check (
      (status = 'open'     and resolved_at is null) or
      (status <> 'open' and resolved_at is not null)
    )
);

-- Un signalement par personne et par cible. Quatre index partiels,
-- parce qu'en Postgres un `unique` sur des colonnes nulles ne
-- déduplique rien : `null` ne égale jamais `null`. Sans ça, dix
-- signalements identiques d'un même compte anglaiseraient un
-- compteur de dix.
create unique index if not exists reports_unique_post
  on public.reports (reporter_id, post_id)       where post_id       is not null;
create unique index if not exists reports_unique_comment
  on public.reports (reporter_id, comment_id)    where comment_id    is not null;
create unique index if not exists reports_unique_message
  on public.reports (reporter_id, message_id)    where message_id    is not null;
create unique index if not exists reports_unique_user
  on public.reports (reporter_id, reported_user) where reported_user is not null;

-- La vue de modération filtre sur `status` et trie par date.
create index if not exists reports_status_idx
  on public.reports (status, created_at desc);

alter table public.reports enable row level security;


-- ------------------------------------------------------------
-- 2. Qui lit
--
-- Le signalant, et l'auteur du contenu. Le créateur du groupe
-- s'ajoute pour les messages de groupe, puisqu'il a déjà le droit
-- de supprimer ces messages.
-- ------------------------------------------------------------

-- Un seul prédicat, réutilisé par les trois politiques de lecture et
-- par celle de classement. Le dupliquer quatre fois ferait quatre
-- endroits où une modification oublie un cas.
--
-- `security definer` : la fonction est appelée depuis une politique, et
-- elle doit pouvoir lire `posts`/`comments`/`group_messages` avec les
-- droits de l'appelant. En `invoker`, elle relit ces tables sous les
-- droits de l'appelant aussi — ce qui est exactement ce qu'on veut, et
-- évite d'ouvrir un escalier de privilèges.
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
    -- mon propre compte signalé : je peux le consulter, l-examiner
    or r.reported_user = auth.uid()
    -- ou le groupe dont je suis le créateur : j'ai déjà le droit de
    -- supprimer ces messages
    or exists (
      select 1
      from public.group_messages m
      join public.groups g on g.id = m.group_id
      where m.id = r.message_id and g.created_by = auth.uid()
    );
$$;

drop policy if exists "reports_read" on public.reports;
create policy "reports_read" on public.reports
  for select using (public.can_see_report(reports.*));


-- ------------------------------------------------------------
-- 3. Qui signale
--
-- On ne signale que soi, et jamais soi-même : se signaler soi-même
-- est le seul cas où la ligne serait lisible et immédiatement
-- inoffensive, donc inutile — et il gonflerait la file.
-- ------------------------------------------------------------

drop policy if exists "reports_insert" on public.reports;
create policy "reports_insert" on public.reports
  for insert with check (
    auth.role() = 'authenticated'
    and reporter_id = auth.uid()
    and not exists (select 1 from public.posts p
                    where p.id = reports.post_id and p.author_id = auth.uid())
    and not exists (select 1 from public.comments c
                    where c.id = reports.comment_id and c.author_id = auth.uid())
    and not exists (select 1 from public.group_messages m
                    where m.id = reports.message_id and m.author_id = auth.uid())
    and (reported_user is null or reported_user <> auth.uid())
  );


-- ------------------------------------------------------------
-- 4. Qui classe
--
-- Un signalement se classe « traité » ou « écarté », et **jamais par
-- la personne qui l'a écrit**. Sans cette clause, signaler un contenu
-- et le classer dans la foulée serait un moyen de faire disparaître
-- la trace d'un signalement sans qu'elle existe jamais ailleurs.
--
-- Le classement ne supprime rien : il change `status` et renseigne
-- `resolved_at`. Le contenu, lui, se supprime par les politiques
-- habituelles, à l'auteur — c'est là qu'est la sanction.
-- ------------------------------------------------------------

drop policy if exists "reports_update" on public.reports;
create policy "reports_update" on public.reports
  for update using (
    public.can_see_report(reports.*)
    and reporter_id <> auth.uid()
  )
  with check (
    public.can_see_report(reports.*)
    and reporter_id <> auth.uid()
  );

-- `resolved_at` est **dérivé** de `status` : c'est exactement le
-- raisonnement de `posts.likes` et de `users.followers`, et la même
-- conclusion s'applique — une donnée que le client écrit est une donnée
-- que la RLS ne peut pas protéger. Ici le risque est moindre (une date
-- fausse n'accorde aucun droit), mais l'incohérence se verrait quand
-- même à l'écran : un signalement classé « résolu » sans date, ou daté
-- d'aujourd'hui alors qu'il a été classé il y a trois semaines.
--
-- Le trigger écrit donc la date, et la contrainte du dessus n'est plus
-- qu'un filet : elle ne peut jamais être violée par le trigger, donc
-- si elle se déclenche un jour, c'est que quelqu'un a désactivé le
-- trigger.
create or replace function public.sync_report_resolution()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'open' then
    new.resolved_at := null;
  else
    -- On conserve la date **initiale** : reclasser un signalement
    -- « écarté » en « traité » ne doit pas le dater d'aujourd'hui, sinon
    -- l'historique ment sur le moment où l'on a vraiment regardé.
    new.resolved_at := coalesce(old.resolved_at, now());
  end if;

  return new;
end;
$$;

drop trigger if exists on_report_resolution on public.reports;
create trigger on_report_resolution
  before update of status on public.reports
  for each row execute function public.sync_report_resolution();


-- ------------------------------------------------------------
-- 5. Suppression
--
-- Aucune politique. Un signalement ne se supprime pas, et c'est
-- volontaire : c'est la trace d'un fait. Le seul moyen de faire
-- disparaître la ligne est la suppression du contenu signalé, qui
-- l'emporte en `cascade` — donc la trace disparaît **avec la
-- raison**, ce qui est cohérent : il n'y a plus rien à signaler.
-- ------------------------------------------------------------