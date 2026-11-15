-- ============================================================
--  046 — Empreintes de mot de passe et sessions
--
--  Préalable de l'authentification servie par PostgreSQL direct.
--  Tant que ce schéma n'existe pas, la session vient encore de
--  Supabase : il n'y a **aucune** colonne de mot de passe et aucune
--  table de sessions dans le schéma applicatif.
--
--  Deux tables, séparées du profil pour une raison de sécurité :
--  `public.users` est lisible par les autres comptes (annuaire,
--  jointure des publications). Y poser une empreinte la rendrait
--  lisible par toute requête `select *` sur un profil. Les deux
--  tables ci-dessous sont donc hors de l'annuaire.
--
--  Aucune politique RLS n'est créée, volontairement :
--    · `authenticated` et `anon` n'obtiennent aucune ligne
--      (RLS activée sans politique = refus par défaut) ;
--    · le propriétaire de la base (le rôle qui migre, celui de
--      `DATABASE_URL`) contourne la RLS et peut lire les empreintes.
--  L'adaptateur d'authentification utilise donc la connexion
--  propriétaire, jamais `withUser` : une identité d'utilisateur ne
--  doit pas pouvoir lire une empreinte, même la sienne.
--
--  Aucune dépendance d'extension : le hachage est fait par Node
--  (`scrypt`), la base ne stocke que le résultat.
-- ============================================================

create table if not exists public.user_credentials (
  user_id uuid primary key references public.users(id) on delete cascade,
  password_hash text not null,
  updated_at timestamptz not null default now()
);

comment on table public.user_credentials is
  'Empreinte scrypt du mot de passe. Hors annuaire : aucune politique RLS, lisible par le seul propriétaire de la base.';
comment on column public.user_credentials.password_hash is
  'Format scrypt$N$r$p$sel$empreinte, en base64. Jamais de mot de passe en clair, jamais d''empreinte réversible.';

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  user_agent text
);

comment on table public.sessions is
  'Sessions ouvertes. Le jeton n''est jamais stocké : seule son empreinte SHA-256 l''est, donc une fuite de la table ne donne aucune session utilisable.';
comment on column public.sessions.token_hash is
  'SHA-256 hexadécimal du jeton remis au navigateur (cookie httpOnly).';

create index if not exists sessions_user_idx on public.sessions (user_id);
create index if not exists sessions_expiry_idx on public.sessions (expires_at);

alter table public.user_credentials enable row level security;
alter table public.sessions enable row level security;
