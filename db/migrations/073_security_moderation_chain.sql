-- ============================================================
--  DEVNET — migration 073 : sécurité, modération, chaîne d'audit
--
--  Trois manques constatés en exploitation, corrigés ici sans toucher
--  aux données existantes :
--
--   1. **Le journal d'audit n'était pas infalsifiable.** Un
--      administrateur pouvait supprimer une ligne du journal (le
--      privilège DELETE restait accordé à `authenticated` par la
--      migration 062, et aucune politique ne l'arrêtait puisqu'il n'y
--      a pas de politique DELETE : PostgreSQL refuse, certes, mais le
--      propriétaire de la base — donc une migration ou un script —
--      pouvait réécrire l'historique sans laisser de trace). On ajoute
--      une chaîne de hachage : chaque ligne porte le hachage de la
--      précédente, et `verify_admin_audit_chain()` dit où la chaîne
--      casse.
--
--   2. **La modération ne laissait aucune trace.** Un texte refusé, une
--      image signalée, un média bloqué : rien n'était conservé, donc
--      rien n'était révisable. `moderation_flags` garde la décision et
--      son motif ; `moderation_blocked_media` garde les empreintes des
--      médias interdits pour reconnaître un renvoi du même fichier.
--
--   3. **Les signaux de sécurité n'avaient pas de table.** Connexions
--      échouées en rafale, écritures massives, actions d'administration
--      hors horaire : le serveur les détecte désormais et les écrit
--      dans `security_events`, lisible seulement par l'administration.
--
--  Plus une règle de produit : **plus de vidéo dans le fil**. Les
--  colonnes restent (les publications existantes doivent rester
--  lisibles), mais un trigger refuse toute nouvelle vidéo sur `posts`.
--  Les statuts et les messages, eux, gardent la vidéo.
--
--  Rollback : drop des deux tables de modération, de `security_events`,
--  des colonnes de chaîne et des trois triggers ; `posts` retrouve son
--  comportement d'origine. Aucune colonne existante n'est supprimée.
-- ============================================================

-- ── 1. Chaîne de hachage du journal d'audit ───────────────────

alter table public.admin_audit_log
  add column if not exists prev_hash text,
  add column if not exists hash      text;

create index if not exists admin_audit_log_chain_idx
  on public.admin_audit_log (created_at desc, id desc);

/**
 * Calcule `prev_hash` et `hash` à chaque insertion.
 *
 * `sha256()` est natif depuis PostgreSQL 11 : pas de dépendance à
 * pgcrypto, que la migration 063 a justement retiré. Le hachage couvre
 * l'identité de la ligne et son contenu ; il ne couvre pas `created_at`
 * au-delà de la seconde, ce qui suffit à détecter une réécriture ou une
 * suppression dans la chaîne.
 */
create or replace function public.admin_audit_chain()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  previous text;
begin
  select hash into previous
    from public.admin_audit_log
   order by created_at desc, id desc
   limit 1;

  new.prev_hash := coalesce(previous, '');
  new.hash := encode(
    sha256(convert_to(
      coalesce(new.prev_hash, '') || '|'
      || new.id::text || '|'
      || coalesce(new.actor_id::text, '') || '|'
      || new.action || '|'
      || new.target_type || '|'
      || new.target_id || '|'
      || new.details::text || '|'
      || to_char(new.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.US'),
      'UTF8'
    )),
    'hex'
  );

  return new;
end;
$$;

drop trigger if exists admin_audit_log_chain on public.admin_audit_log;
create trigger admin_audit_log_chain
  before insert on public.admin_audit_log
  for each row execute function public.admin_audit_chain();

/**
 * Vérifie la chaîne, dans l'ordre chronologique.
 *
 * Renvoie `{ ok, checked, broken_at, detail }`. Un trou de `prev_hash`
 * (ligne insérée avant cette migration) n'est pas une rupture : on
 * repart de la première ligne hachée. Une rupture est un `prev_hash`
 * qui ne correspond pas au `hash` de la ligne précédente, ou un
 * `hash` recalculé qui ne correspond pas.
 */
create or replace function public.verify_admin_audit_chain()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row_record record;
  previous text := null;
  checked int := 0;
  expected text;
begin
  if not public.is_admin() then
    raise exception 'réservé à l''administration' using errcode = '42501';
  end if;

  for row_record in
    select id, actor_id, action, target_type, target_id, details, created_at, prev_hash, hash
      from public.admin_audit_log
     where hash is not null
     order by created_at asc, id asc
  loop
    checked := checked + 1;

    if previous is not null and row_record.prev_hash is distinct from previous then
      return jsonb_build_object(
        'ok', false,
        'checked', checked,
        'brokenAt', row_record.id,
        'detail', 'prev_hash ne correspond pas au hachage de la ligne précédente'
      );
    end if;

    expected := encode(
      sha256(convert_to(
        coalesce(row_record.prev_hash, '') || '|'
        || row_record.id::text || '|'
        || coalesce(row_record.actor_id::text, '') || '|'
        || row_record.action || '|'
        || row_record.target_type || '|'
        || row_record.target_id || '|'
        || row_record.details::text || '|'
        || to_char(row_record.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.US'),
        'UTF8'
      )),
      'hex'
    );

    if expected <> row_record.hash then
      return jsonb_build_object(
        'ok', false,
        'checked', checked,
        'brokenAt', row_record.id,
        'detail', 'le contenu de la ligne ne correspond plus à son hachage'
      );
    end if;

    previous := row_record.hash;
  end loop;

  return jsonb_build_object('ok', true, 'checked', checked, 'brokenAt', null, 'detail', null);
end;
$$;

revoke all on function public.verify_admin_audit_chain() from public, anon;
grant execute on function public.verify_admin_audit_chain() to authenticated;

-- Un journal ne se réécrit pas, même avec la clé du propriétaire : on
-- retire le privilège de mise à jour et de suppression au rôle applicatif.
revoke update, delete on public.admin_audit_log from authenticated;

-- ── 2. Signaux de sécurité ────────────────────────────────────

create table if not exists public.security_events (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null,
  severity   text not null default 'info'
               check (severity in ('info', 'warning', 'critical')),
  actor_id   uuid references public.users(id) on delete set null,
  subject    text not null default '',
  ip_hash    text not null default '',
  user_agent text not null default '',
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists security_events_created_idx
  on public.security_events (created_at desc);
create index if not exists security_events_kind_idx
  on public.security_events (kind, created_at desc);
create index if not exists security_events_severity_idx
  on public.security_events (severity, created_at desc)
  where severity <> 'info';

alter table public.security_events enable row level security;

drop policy if exists security_events_admin_read on public.security_events;
create policy security_events_admin_read
  on public.security_events
  for select to authenticated
  using (public.is_admin());

revoke insert, update, delete on public.security_events from anon, authenticated;
grant select on public.security_events to authenticated;

comment on table public.security_events is
  'Signaux de sécurité (connexions échouées, rafales, actions sensibles). Écriture serveur uniquement.';

-- ── 3. File de modération et empreintes de médias bloqués ────

create table if not exists public.moderation_flags (
  id          uuid primary key default gen_random_uuid(),
  target_type text not null
                check (target_type in ('post', 'comment', 'message', 'story', 'profile', 'media')),
  target_id   text not null,
  source      text not null default 'text'
                check (source in ('text', 'image', 'heuristic', 'ai', 'report', 'sentinel')),
  severity    text not null default 'warning'
                check (severity in ('info', 'warning', 'critical')),
  reason      text not null,
  details     jsonb not null default '{}'::jsonb,
  status      text not null default 'open'
                check (status in ('open', 'confirmed', 'dismissed')),
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  constraint moderation_flags_resolved_coherent
    check ((status = 'open' and resolved_at is null)
        or (status <> 'open' and resolved_at is not null))
);

create index if not exists moderation_flags_open_idx
  on public.moderation_flags (status, created_at desc);
create index if not exists moderation_flags_target_idx
  on public.moderation_flags (target_type, target_id);

alter table public.moderation_flags enable row level security;

drop policy if exists moderation_flags_admin_read on public.moderation_flags;
create policy moderation_flags_admin_read
  on public.moderation_flags
  for select to authenticated
  using (public.is_admin());

revoke insert, update, delete on public.moderation_flags from anon, authenticated;
grant select on public.moderation_flags to authenticated;

create table if not exists public.moderation_blocked_media (
  id         uuid primary key default gen_random_uuid(),
  phash      text not null unique,
  reason     text not null default '',
  added_by   uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.moderation_blocked_media enable row level security;

drop policy if exists moderation_blocked_media_admin_read on public.moderation_blocked_media;
create policy moderation_blocked_media_admin_read
  on public.moderation_blocked_media
  for select to authenticated
  using (public.is_admin());

revoke insert, update, delete on public.moderation_blocked_media from anon, authenticated;
grant select on public.moderation_blocked_media to authenticated;

-- ── 4. Empreinte et affiche des médias ───────────────────────
--  `phash` sert à reconnaître un média déjà bloqué ; `poster_url` sert
--  à afficher une vignette avant de charger la vidéo (moins d'octets,
--  moins de latence, pas de lecteur noir).

alter table public.media_files
  add column if not exists phash      text,
  add column if not exists poster_url text not null default '',
  add column if not exists origin_mime text not null default '',
  add column if not exists transcoded boolean not null default false;

create index if not exists media_files_phash_idx
  on public.media_files (phash) where phash is not null;

comment on column public.media_files.phash is
  'Empreinte perceptuelle (dHash 64 bits) : détecte le renvoi d''un média déjà bloqué.';
comment on column public.media_files.poster_url is
  'Vignette d''une vidéo, affichée avant lecture.';
comment on column public.media_files.transcoded is
  'Vrai quand le serveur a réencodé la vidéo en H.264/AAC lisible partout.';

-- ── 5. Plus de vidéo dans le fil ─────────────────────────────
--  La colonne `media_type` reste (les publications existantes doivent
--  rester lisibles) mais un trigger refuse toute **nouvelle** vidéo.
--  Un test `old.media_type is distinct from 'video'` laisse passer les
--  mises à jour d'une ligne déjà vidéo (par exemple un like qui touche
--  la même ligne via un autre chemin), sans rouvrir la porte.

create or replace function public.reject_video_on_posts()
returns trigger
language plpgsql
as $$
begin
  if new.media_type = 'video' then
    if tg_op = 'INSERT' then
      raise exception 'la vidéo n''est pas autorisée dans le fil ; publie-la en statut ou en message'
        using errcode = '23514';
    end if;
    if old.media_type is distinct from 'video' then
      raise exception 'la vidéo n''est pas autorisée dans le fil ; publie-la en statut ou en message'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists posts_reject_video on public.posts;
create trigger posts_reject_video
  before insert or update of media_type on public.posts
  for each row execute function public.reject_video_on_posts();

comment on function public.reject_video_on_posts() is
  'Le fil accepte des photos, pas des vidéos ; les statuts et messages gardent la vidéo.';

-- ── 6. Index de lecture chaude ───────────────────────────────
--  Le fil trie par date, l'hydratation lit par identifiant, les écrans
--  d'administration comptent par date. Ces index manquaient, et un
--  `order by created_at desc` sur une table qui grossit finit par trier
--  toute la table à chaque page.

create index if not exists posts_created_at_idx
  on public.posts (created_at desc);
create index if not exists posts_author_created_idx
  on public.posts (author_id, created_at desc);
create index if not exists posts_media_type_idx
  on public.posts (media_type) where media_type <> '';
create index if not exists comments_created_idx
  on public.comments (created_at desc);
create index if not exists sessions_expiry_idx
  on public.sessions (expires_at desc);

comment on table public.moderation_flags is
  'File de modération : texte refusé, image signalée, heuristique ou sentinelle.';

-- ── 7. Termes de modération administrables ───────────────────
--  La liste de base vit dans le code (`lib/moderation/text.ts`) : elle est
--  versionnée, testée et déployée avec l'application. Cette table ajoute ce
--  que l'exploitation doit pouvoir décider sans redéployer — un mot propre à
--  une communauté, un nom de produit utilisé comme insulte, une trêve.

create table if not exists public.moderation_terms (
  id         uuid primary key default gen_random_uuid(),
  term       text not null check (length(btrim(term)) between 2 and 80),
  category   text not null default 'custom'
               check (category in ('insult', 'hate', 'sexual', 'violence', 'scam', 'drugs', 'selfharm', 'custom')),
  severity   text not null default 'warning'
               check (severity in ('info', 'warning', 'critical')),
  active     boolean not null default true,
  added_by   uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists moderation_terms_unique
  on public.moderation_terms (lower(term));

alter table public.moderation_terms enable row level security;

drop policy if exists moderation_terms_admin_read on public.moderation_terms;
create policy moderation_terms_admin_read
  on public.moderation_terms
  for select to authenticated
  using (public.is_admin());

revoke insert, update, delete on public.moderation_terms from anon, authenticated;
grant select on public.moderation_terms to authenticated;

comment on table public.moderation_terms is
  'Termes ajoutés par l''exploitation ; la liste de base reste dans le code.';
