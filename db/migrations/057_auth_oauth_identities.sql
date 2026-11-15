-- ============================================================
--  057 — Identités OAuth (Google, GitHub)
--
--  Une identité externe relie un compte DevNet à un sujet stable
--  chez le fournisseur (`sub` Google, `id` GitHub). Le sujet est
--  la clé : un email peut changer, le sujet ne change pas.
--
--  Pourquoi une table séparée de `auth.users` :
--    · `auth.users` garde le contrat attendu par `handle_new_user()` ;
--    · un même compte peut avoir plusieurs fournisseurs sans
--      dupliquer l'identité DevNet ni les sessions ;
--    · la liaison est révocable (supprimer la ligne) sans toucher
--      au compte ni au mot de passe.
--
--  Aucune politique RLS, volontairement : cette table est lue et
--  écrite par l'adaptateur d'authentification, avec la connexion
--  privilégiée. Une identité d'utilisateur n'a pas besoin de voir
--  les sujets OAuth des autres comptes.
-- ============================================================

create table if not exists public.user_identities (
  provider   text not null,
  subject    text not null,
  user_id    uuid not null references public.users(id) on delete cascade,
  email      text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_identities_provider_check check (provider in ('google', 'github')),
  constraint user_identities_subject_check check (subject <> ''),
  primary key (provider, subject)
);

comment on table public.user_identities is
  'Sujets OAuth stables reliés à un compte DevNet. Hors annuaire : aucune politique RLS.';
comment on column public.user_identities.subject is
  'Identifiant immuable du fournisseur (sub Google, id GitHub), jamais l''email.';
comment on column public.user_identities.email is
  'Dernière adresse vérifiée fournie par le fournisseur, pour diagnostic et liaison.';

create index if not exists user_identities_user_idx
  on public.user_identities (user_id);

alter table public.user_identities enable row level security;
