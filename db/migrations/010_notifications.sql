-- ============================================================
--  DEVNET — migration v10 : centre de notifications
--  Supabase → SQL Editor → Run
--  (après 009_post_projects.sql)
--
--  Quatre événements, une seule table : like, abonnement,
--  mention, message privé.
--
--  La question que cette migration répond est « qu'est-ce qui s'est
--  produit pendant que je n'étais pas là ». Elle n'exige pas de table
--  par événement : ce que ces quatre-là ont en commun est d'être
--  addressed **à une personne**, avec un auteur, une cible et une
--  date. Une table, quatre valeurs de `kind`, et le produit peut
--  ajouter un cinquième événement plus tard sans migrer.
--
--  Trois décisions, et ce qu'elles coûtent.
--
--  1. **Le client n'insère jamais.** Les notifications naissent de
--     déclencheurs sur les tables d'origine. Une notification écrite
--     par le client est une notification fausse : il suffirait
--     d'insérer `recipient_id = moi, kind = 'like', actor_id =
--     moi` pour se congratulate tout seul, et l'écran afficherait un
--     fait qui n'a jamais eu lieu. La RLS ferme donc l'insertion, et
--     elle n'ouvre qu'une seule opération en écriture : `read_at`.
--
--  2. **L'acteur disparaît, la notification reste.** `actor_id` est
--     `on delete set null`. Effacer son compte ne doit pas effacer
--     le fait qu'un like a eu lieu ; l'écran affiche alors « un
--     compte supprimé », ce qui est vrai.
--
--  3. **Un événement, une ligne.** Pas de compteur, pas
--     d'agrégation en base : la liste se plie à l'affichage (voir
--     `lib/notify.ts`), mais la table reste fidèle. Un compteur
--     serait la même erreur que `posts.likes` — une donnée que le
--     client écrit et que la RLS ne peut pas protéger.
-- ============================================================


-- ------------------------------------------------------------
--  1. La table
-- ------------------------------------------------------------

create table if not exists public.notifications (
  id              uuid primary key default gen_random_uuid(),

  -- destinataire : c'est lui qui décide de ce qu'il peut lire.
  recipient_id    uuid not null references public.users(id) on delete cascade,

  -- auteur de l'événement. Volontairement effaçable : voir point 2.
  actor_id        uuid references public.users(id) on delete set null,

  kind            text not null
                    check (kind in ('like', 'follow', 'mention', 'message')),

  -- La cible, selon l'événement. Ces colonnes sont nulles ou non
  -- selon `kind`, et la contrainte ci-dessous l'impose : une
  -- notification « message » sans conversation ne pourrait pas
  -- s'ouvrir, donc elle n'a pas le droit d'exister.
  post_id         uuid references public.posts(id)   on delete cascade,
  comment_id      uuid references public.comments(id) on delete cascade,
  conversation_id text  references public.conversations(id) on delete cascade,

  created_at      timestamptz not null default now(),
  -- Lu ou non. Cette seule colonne est modifiable par le client.
  read_at         timestamptz,

  constraint notifications_shape check (
    (kind in ('like', 'mention') and post_id is not null)
    or (kind = 'follow')
    or (kind = 'message' and conversation_id is not null)
  ),

  -- Un événement a un seul auteur. Un like sans auteur n'est pas un
  -- like : c'est une notification de l'auteur à lui-même.
  constraint notifications_has_actor check (actor_id is not null)
);

-- La lecture du centre : « mes notifications, les plus récentes
-- d'abord ». Sans cet index, chaque ouverture du centre est un
-- balayage de table dès que la table dépasse quelques milliers de
-- lignes — et le centre est la première chose qu'on ouvre.
create index if not exists notifications_recipient_idx
  on public.notifications(recipient_id, created_at desc);

-- Le compteur non lus : il filtre `read_at is null` sur le même
-- préfixe d'index, donc il ne lisent rien d'autre que ce qu'il
-- faut.
create index if not exists notifications_unread_idx
  on public.notifications(recipient_id)
  where read_at is null;

-- Un événement ne se répète pas. Le like est déjà unique par
-- construction (`post_likes`), le suivi aussi ; ce verrou empêche
-- surtout le rejeu d'un déclencheur de fabriquer un doublon, et
-- garantit qu'un centre affiché ne peut pas montrer deux fois la
-- même chose.
--
-- Les `coalesce` sont nécessaires : en SQL, `null` ne égale pas
-- `null`, donc un index sur les colonnes brutes accepterait deux
-- lignes identiques. C'est exactement le piège du `===` de
-- JavaScript — les deux langages ont le même défaut, pour la même
-- raison : ils comparent l'absence de valeur à l'absence de valeur.
create unique index if not exists notifications_event_uidx
  on public.notifications (
    recipient_id,
    kind,
    coalesce(actor_id::text, ''),
    coalesce(post_id::text, ''),
    coalesce(comment_id::text, ''),
    coalesce(conversation_id, '')
  );

comment on table public.notifications is
  'Événements adressés à un compte : like, abonnement, mention, message. Écriture par déclencheur uniquement.';


-- ------------------------------------------------------------
--  2. RLS
-- ------------------------------------------------------------

alter table public.notifications enable row level security;

drop policy if exists "notifications_read" on public.notifications;
create policy "notifications_read" on public.notifications
  for select using (auth.uid() = recipient_id);

-- Insertion fermée. C'est la règle centrale de cette migration : la
-- notification est un fait qui s'est produit, pas une déclaration.
drop policy if exists "notifications_insert" on public.notifications;
create policy "notifications_insert" on public.notifications
  for insert with check (false);

-- On ne modifie que ses propres notifications…
drop policy if exists "notifications_update" on public.notifications;
create policy "notifications_update" on public.notifications
  for update using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);

-- …et la RLS raisonne en lignes, jamais en colonnes : sans ce
-- `revoke`, `read_at` autorisé aussi `recipient_id`. Un client
-- pourrait alors se garder une notification en écrivant
-- `recipient_id = l'autre` avec un `with check` satisfait par la
-- ligne d'origine. C'est le même mur que `likes = 9999`, dressé
-- par la migration 005, au même endroit.
revoke update (recipient_id, actor_id, kind, post_id, comment_id,
               conversation_id, created_at)
  on public.notifications from authenticated;

drop policy if exists "notifications_delete" on public.notifications;
create policy "notifications_delete" on public.notifications
  for delete using (auth.uid() = recipient_id);


-- ------------------------------------------------------------
--  3. Les mentions
-- ------------------------------------------------------------

-- Fonction SQL de référence pour l'extraction des mentions. Le
-- module TypeScript `lib/mentions.ts` applique exactement la même
-- règle ; toute divergence se corrige d'abord ici.
--
-- Le mot qui suit le `@` est capturé **en entier**, accents compris,
-- puis filtré : on ne veut pas qu'une mention soit tronquée. Trois
-- refus, comme pour les hashtags :
--
-- - `@` seul, et `user@` : pas de mot, pas de mention ;
-- - `@référence` : le mot est accentué, donc ce n'est pas un pseudo ;
-- - `@42` : c'est un numéro, pas un compte.
--
-- Le résultat est **normalisé en minuscules**, comme les hashtags. Les
-- pseudos sont créés par `handle_new_user` en minuscules, donc `@Koffi`
-- et `@koffi` désignent le même compte ; sans cette normalisation, une
-- mention écrite en majuscule ne réveillerait personne, et l'écart ne se
-- verrait qu'à la production, où le pseudo existe mais ne correspond à
-- aucune ligne.
--
-- Le caractère **avant** le `@` compte. Sans cette contrainte,
-- `contact@koffi.dev` produirait deux mentions (« koffi » et «
-- dev ») pour une adresse email : quelqu'un aurait été mentionné
-- sans l'avoir jamais été. D'où le groupe de tête
-- `(^|[^A-Za-z0-9._%+-])`, qui refuse un `@` collé à un mot.
create or replace function public.extract_mentions(body text)
returns text[]
language sql immutable
set search_path = public as $$
  select coalesce(array_agg(distinct m[2]), '{}')
  from regexp_matches(coalesce(body, ''),
                       '(^|[^A-Za-z0-9._%+-])@([A-Za-z0-9_]+)', 'g') as m
  where m[2] is not null
    and m[2] !~ '^[0-9]+$'
$$;

comment on function public.extract_mentions(text) is
  'Pseudos mentionnés dans un texte. Alimente notifications.kind = ''mention''.';


-- ------------------------------------------------------------
--  4. Les déclencheurs
-- ------------------------------------------------------------

-- Un seul point d'entrée pour les trois événements qui visent un
-- compte : on écrit une fois la règle « pas de notification à
-- soi-même » et « pas de doublon ».
--
-- `on conflict do nothing` porte sur l'index `notifications_event_uidx`
-- — c'est lui qui rend l'opération idempotente. Un déclencheur
-- rejoué (réparation, `pg_trigger`, import) ne fabrique donc pas une
-- seconde ligne, ce qui est exactement ce que ferait un rejeu du
-- moteur de démonstration.
create or replace function public.raise_notification(
  p_recipient uuid,
  p_actor     uuid,
  p_kind      text,
  p_post      uuid default null,
  p_comment   uuid default null,
  p_convo     text  default null
)
returns void
language plpgsql
security definer
set search_path = public as $$
begin
  -- Aucune notification à soi-même : on s'aime, on se suit, on se
  -- cite — mais cela ne fait pas une actualité à lire.
  if p_recipient is null or p_actor is null or p_recipient = p_actor then
    return;
  end if;

  insert into public.notifications
    (recipient_id, actor_id, kind, post_id, comment_id, conversation_id, created_at)
  values
    (p_recipient, p_actor, p_kind, p_post, p_comment, p_convo, now())
  on conflict do nothing;
end;
$$;

-- 4.1. Un like vise l'auteur du post, pas l'auteur du like.
create or replace function public.notify_post_like()
returns trigger
language plpgsql
security definer
set search_path = public as $$
declare
  v_author uuid;
begin
  select author_id into v_author from public.posts where id = new.post_id;
  perform public.raise_notification(v_author, new.user_id, 'like', new.post_id);
  return new;
end;
$$;

drop trigger if exists on_post_likes_notify on public.post_likes;
create trigger on_post_likes_notify
  after insert on public.post_likes
  for each row execute function public.notify_post_like();

-- 4.2. Un abonnement vise la personne suivie, pas la personne qui
--      suit. L'inversion est le bug d'implémentation le plus
--      probable de ce fichier : elle marche quand le test regarde
--      son propre écran, et n'envoie rien aux autres.
create or replace function public.notify_follow()
returns trigger
language plpgsql
security definer
set search_path = public as $$
begin
  perform public.raise_notification(new.followee_id, new.follower_id, 'follow');
  return new;
end;
$$;

drop trigger if exists on_follows_notify on public.follows;
create trigger on_follows_notify
  after insert on public.follows
  for each row execute function public.notify_follow();

-- 4.3. Les mentions, dans une publication et dans un commentaire.
--
-- Même fonction pour les deux : l'événement est le même, seule la
-- table change. Les deux écritures passent par `insert … select`,
-- donc la source est une **table**, jamais une valeur envoyée par
-- le client : un client qui n'écrit pas de mention n'en produit
-- aucune, et un client qui en écrit trop se heurte à la jointure
-- sur `users` — un pseudo inexistant ne notifie personne.
--
-- Le code d'une publication est **ignoré** : il contient des `@`
-- décoratifs (`@decorator` en Python, `@Override` en Java), et
-- mentionner quelqu'un depuis un bout de code n'a jamais voulu
-- dire grand-chose.
create or replace function public.notify_mentions_from_posts()
returns trigger
language plpgsql
security definer
set search_path = public as $$
begin
  insert into public.notifications
    (recipient_id, actor_id, kind, post_id, created_at)
  select u.id, new.author_id, 'mention', new.id, new.created_at
    from unnest(public.extract_mentions(new.text)) as m(pseudo)
    join public.users u on u.pseudo = lower(m.pseudo)
  where u.id is distinct from new.author_id
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_posts_mentions_notify on public.posts;
create trigger on_posts_mentions_notify
  after insert on public.posts
  for each row execute function public.notify_mentions_from_posts();

create or replace function public.notify_mentions_from_comments()
returns trigger
language plpgsql
security definer
set search_path = public as $$
begin
  insert into public.notifications
    (recipient_id, actor_id, kind, post_id, comment_id, created_at)
  select u.id, new.author_id, 'mention', new.post_id, new.id, new.created_at
    from unnest(public.extract_mentions(new.text)) as m(pseudo)
    join public.users u on u.pseudo = lower(m.pseudo)
  where u.id is distinct from new.author_id
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_comments_mentions_notify on public.comments;
create trigger on_comments_mentions_notify
  after insert on public.comments
  for each row execute function public.notify_mentions_from_comments();

-- 4.4. Un message privé vise **tous** les participants sauf son
--      auteur.
--
--      Pas « le premier participant qui n'est pas l'auteur » : une
--      conversation en a deux, et le premier trouvé dépend de
--      l'ordre du tableau. C'était le piège que la migration 006
--      referme pour l'adhésion ; on ne le rouvre pas ici.
create or replace function public.notify_direct_message()
returns trigger
language plpgsql
security definer
set search_path = public as $$
begin
  insert into public.notifications
    (recipient_id, actor_id, kind, conversation_id, created_at)
  select p, new.author_id, 'message', new.conversation_id, new.created_at
    from unnest(
      (select c.participants from public.conversations c
        where c.id = new.conversation_id)
    ) as p
   where p is not null and p <> new.author_id
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_dm_notify on public.direct_messages;
create trigger on_dm_notify
  after insert on public.direct_messages
  for each row execute function public.notify_direct_message();


-- ------------------------------------------------------------
--  5. Report : l'état déjà présent
-- ------------------------------------------------------------
--
--  Les déclencheurs ne se déclenchent que sur les écritures
--  futures. Sur une base qui a déjà des likes, des suivis et des
--  messages, le centre serait vide — et il le resterait, puisque
--  l'insertion est fermée au client. On rejoue donc une fois les
--  règles sur l'existant.
--
--  Uniquement sur les trois derniers jours : c'est ce qu'un lecteur
--  qui ouvre l'application s'attend à voir. Rejouer deux ans d'historique
--  produirait un centre rempli de notifications qu'il n'a jamais
--  eu le temps de voir, et qu'aucun produit n'affiche.
insert into public.notifications
  (recipient_id, actor_id, kind, post_id, created_at, read_at)
select p.author_id, l.user_id, 'like', l.post_id, l.created_at,
       case when l.created_at < now() - interval '3 days' then l.created_at end
  from public.post_likes l
  join public.posts p on p.id = l.post_id
 where l.created_at >= now() - interval '3 days'
on conflict do nothing;

insert into public.notifications
  (recipient_id, actor_id, kind, created_at, read_at)
select f.followee_id, f.follower_id, 'follow', f.created_at,
       case when f.created_at < now() - interval '3 days' then f.created_at end
  from public.follows f
 where f.created_at >= now() - interval '3 days'
on conflict do nothing;

insert into public.notifications
  (recipient_id, actor_id, kind, post_id, comment_id, created_at, read_at)
select u.id, c.author_id, 'mention', c.post_id, c.id, c.created_at,
       case when c.created_at < now() - interval '3 days' then c.created_at end
  from public.comments c
  cross join lateral unnest(public.extract_mentions(c.text)) as m(pseudo)
  join public.users u on u.pseudo = lower(m.pseudo)
 where c.created_at >= now() - interval '3 days'
   and u.id is distinct from c.author_id
on conflict do nothing;

insert into public.notifications
  (recipient_id, actor_id, kind, conversation_id, created_at, read_at)
select p, d.author_id, 'message', d.conversation_id, d.created_at,
       case when d.created_at < now() - interval '3 days' then d.created_at end
  from public.direct_messages d
  cross join lateral unnest(
    (select c.participants from public.conversations c
      where c.id = d.conversation_id)) as p
 where d.created_at >= now() - interval '3 days'
   and p is not null
   and p <> d.author_id
on conflict do nothing;


-- ------------------------------------------------------------
--  REALTIME
-- ------------------------------------------------------------
--  Le compteur de la cloche doit bouger quand quelqu'un écrit, sans
--  que le lecteur recharge la page. C'est le seul écran qui vit
--  d'un flux, donc le seul où l'on ajoute la table à la
--  publication.
--
--  Pas de `REPLICA IDENTITY FULL` : le client ne reçoit que les
--  insertions, jamais les suppressions ni les modifications, donc
--  l'identité de ligne complète ne lui apporterait rien.
alter publication supabase_realtime add table public.notifications;