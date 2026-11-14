-- ============================================================
--  DEVNET — migration 070 : audience des stories
--
--  Jusqu'ici, toute story vivante était lisible par n'importe quel
--  compte authentifié. Une story « privée » n'existait donc pas : le
--  seul rempart était l'absence d'UI. Cette migration pose la règle
--  dans la base, avant toute promesse d'écran.
--
--  Trois audiences :
--    public    — tout le monde, y compris sans session ;
--    followers — les personnes qui suivent l'auteur ;
--    private   — l'auteur uniquement.
--
--  `story_is_live` est redéfinie : elle sert aussi aux policies des
--  likes, vues, réponses, stickers et médias. Sans cette extension, le
--  média d'une story privée resterait lisible par son identifiant
--  direct, même si la liste ne l'affiche plus.
--
--  Rollback : restaurer la fonction de la migration 047, supprimer la
--  policy `stories_read` puis la recréer avec `expires_at > now()`,
--  recréer `story_media_read` avec `story_is_live` seul, puis
--  `alter table public.stories drop column audience;`.
--  La migration est additive ; les stories existantes deviennent
--  `public` par défaut.
-- ============================================================

alter table public.stories
  add column if not exists audience text not null default 'public';

alter table public.stories
  drop constraint if exists stories_audience_check;
alter table public.stories
  add constraint stories_audience_check
  check (audience in ('public', 'followers', 'private'));

create index if not exists stories_audience_live_idx
  on public.stories (audience, expires_at desc);

/**
 * Vrai si la story est vivante **et** lisible par l'identité courante.
 *
 * `security definer` est nécessaire : la policy de `stories` ne peut pas
 * interroger `follows` pour un lecteur anonyme, et les policies des
 * tables filles doivent voir la même décision que la story. La fonction
 * ne rend qu'un booléen et son `search_path` est fixé.
 */
create or replace function public.story_is_live(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.stories s
     where s.id = target
       and s.expires_at > now()
       and (
         s.audience = 'public'
         or s.author_id = auth.uid()
         or (
           s.audience = 'followers'
           and exists (
             select 1
               from public.follows f
              where f.followee_id = s.author_id
                and f.follower_id = auth.uid()
           )
         )
       )
  );
$$;

revoke all on function public.story_is_live(uuid) from public;
grant execute on function public.story_is_live(uuid) to authenticated, anon;

drop policy if exists "stories_read" on public.stories;
create policy "stories_read" on public.stories
  for select using (
    expires_at > now()
    and (
      audience = 'public'
      or author_id = auth.uid()
      or (
        audience = 'followers'
        and exists (
          select 1
            from public.follows f
           where f.followee_id = stories.author_id
             and f.follower_id = auth.uid()
        )
      )
    )
  );

drop policy if exists "story_media_read" on public.story_media;
create policy "story_media_read" on public.story_media
  for select using (
    public.story_is_live(story_media.story_id)
    or public.story_author(story_media.story_id) = auth.uid()
  );

comment on column public.stories.audience is
  'public : tout le monde ; followers : abonnés de l''auteur ; private : auteur uniquement.';
comment on function public.story_is_live(uuid) is
  'Vrai si la story est vivante et lisible par l''identité courante (audience comprise).';
comment on policy "stories_read" on public.stories is
  'Une story vivante n''est lisible que dans son audience.';
