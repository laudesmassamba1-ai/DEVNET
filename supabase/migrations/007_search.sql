-- ============================================================
--  DEVNET — migration v7 : découverte
--  Supabase → SQL Editor → Run
--  (après 006_messaging.sql)
--
--  Sans recherche, une base ne se visite pas : on ne peut pas trouver
--  un post même en connaissant le mot-clé, ni une personne même en
--  connaissant le pseudo. C'est la seule des deux vagues qui empêche
--  de comprendre l'existant.
--
--  Trois choix, et ce qu'ils coûtent.
--
--  1. `pg_trgm` plutôt qu'un index plein texte. La recherche porte sur
--     des pseudos et des phrases de codes, où un mot-clé apparaît au
--     milieu d'un mot, avec une faute, ou dans une accolade. Le trigramme
--     indexe des morceaux de trois caractères : il trouve `stratify`
--     dans `stratifier`, et `dat` dans `dataset`. Un index `to_tsvector`
--     exigerait des mots entiers, donc un dictionnaire, donc des mots
--     français en accès public — alors qu'on cherche ici des termes
--     techniques, souvent en anglais. Le trigramme ne connaît pas les
--     mots : c'est exactement ce qu'il faut.
--
--  2. `tags text[]` produit par un **déclencheur**, pas par le client.
--     Un hashtag écrit dans le texte doit exister dans la colonne même
--     si le client oublie, se trompe, ou ment. Le client n'écrit que du
--     texte ; la colonne se remplit toute seule. C'est la même logique
--     que `sync_post_likes` : la vérité se déduit, elle ne se déclare pas.
--
--  3. Pas de table `post_tags` de jonction. Elle serait plus propre sur
--     le papier, mais elle ajoute une lecture, une écriture et une
--     suppression pour un hashtag. Une colonne `text[]` indexée en GIN
--     répond à « ce post porte-t-il ce hashtag » en une seule requête.
--     Le seul critère qui ferait basculer le choix est un jour où il
--     faudrait compter les usages d'un tag ou suivre un hashtag ; on
--     n'est pas encore là.
-- ============================================================

create extension if not exists pg_trgm;

-- ------------------------------------------------------------
--  1. Hashtags
-- ------------------------------------------------------------

alter table public.posts
  add column if not exists tags text[] not null default '{}';

-- Index GIN : `@> '{python}'` sur un `text[]` est la question posée à
-- chaque recherche par hashtag. Sans lui, c'est un balayage de table.
create index if not exists posts_tags_idx
  on public.posts using gin (tags);

-- Les hashtags sont normalisés en minuscules : `#Python` et `#python`
-- désignent la même chose, et une recherche qui distingue les deux
-- semble cassée.
create or replace function public.extract_tags(body text)
returns text[]
language sql immutable
set search_path = public as $$
  -- `[[:alnum:]_]+` capture le mot **en entier**, accents compris, pour
  -- que `#référence` ne soit pas tronqué en « r ». Le tri se fait ensuite :
  -- un mot accentué n'est pas un hashtag, il reste du texte. Sans ce tri,
  -- la version SQL indexerait « r » et la version TypeScript rien — les
  -- deux modes divergeraient sur le même post.
  select coalesce(array_agg(distinct lower(m[1])), '{}')
  from regexp_matches(coalesce(body, ''), '#([[:alnum:]_]+)', 'g') as m
  where m[1] ~ '^[A-Za-z0-9_]+'      -- pas d'accent
    and m[1] !~ '^[0-9]+$';           -- pas un numéro d'issue
$$;

comment on function public.extract_tags(text) is
  'Hashtags du texte, normalisés en minuscules. Alimente posts.tags.';

-- Le déclencheur **remplace** la valeur entière : un `#ancien` retiré du
-- texte disparaît aussi de la colonne. Un `array_append` en différentiel
-- laisserait les hashtags fantômes s'accumuler, et le fil « #python »
-- continuerait de renvoyer des posts qui n'en parlent plus.
create or replace function public.sync_post_tags()
returns trigger
language plpgsql
set search_path = public as $$
begin
  -- Seul `text` est lu : le code d'un post contient des `#` (commentaires
  -- Python, attributs Rust, sélecteurs CSS), et les chercher produirait
  -- des hashtags qui n'existent pas.
  new.tags := public.extract_tags(new.text);
  return new;
end;
$$;

drop trigger if exists posts_sync_tags on public.posts;
create trigger posts_sync_tags
  before insert or update of text on public.posts
  for each row execute function public.sync_post_tags();

-- Rappel pour les lignes existantes : le déclencheur ne se déclenche que
-- sur les écritures futures.
update public.posts
set tags = public.extract_tags(text)
where tags is distinct from public.extract_tags(text);

-- ------------------------------------------------------------
--  2. Recherche
-- ------------------------------------------------------------

create index if not exists posts_text_trgm
  on public.posts using gin (text gin_trgm_ops);

create index if not exists users_pseudo_trgm
  on public.users using gin (pseudo gin_trgm_ops);

create index if not exists users_prenom_trgm
  on public.users using gin (prenom gin_trgm_ops);

-- ------------------------------------------------------------
--  3. Ce que le client est autorisé à écrire
-- ------------------------------------------------------------
--
-- `tags` est un cache de `extract_tags(text)`. Si le client pouvait
-- l'écrire, il pourrait annoncer un hashtag absent du texte, et
-- quelqu'un qui clique dessus trouverait un fil vide — sans jamais
-- comprendre pourquoi. On retire donc la colonne du droit de mise à
-- jour, comme `likes` en migration 005.

revoke update (tags) on public.posts from authenticated;

comment on column public.posts.tags is
  'Hashtags du texte, extraits par le déclencheur posts_sync_tags. Jamais écrit par le client.';

-- ------------------------------------------------------------
--  REALTIME
-- ------------------------------------------------------------
--
-- Une recherche affichée en direct verrait ses résultats changer sous
-- les doigts de l'utilisateur à chaque publication. On ne l'ajoute pas :
-- la recherche est une requête, pas un flux.