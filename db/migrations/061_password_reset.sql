-- ============================================================
-- 061 — Réinitialisation de mot de passe
--
-- Le navigateur ne reçoit qu'un jeton aléatoire une fois ; la base n'en
-- garde que le SHA-256. Un jeton expire après 30 minutes et ne peut servir
-- qu'une fois. Aucune politique RLS : seules les routes serveur y accèdent.
-- ============================================================

create table if not exists public.password_reset_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists password_reset_tokens_user_idx
  on public.password_reset_tokens (user_id, created_at desc);

create index if not exists password_reset_tokens_expiry_idx
  on public.password_reset_tokens (expires_at);

alter table public.password_reset_tokens enable row level security;

comment on table public.password_reset_tokens is
  'Jetons de réinitialisation à usage unique ; seules les routes serveur les lisent.';
