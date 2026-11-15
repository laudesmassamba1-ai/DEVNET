-- ============================================================
-- 064 — Abonnements Web Push
--
-- Une ligne par appareil, pas par personne : le même compte se connecte
-- sur un iPhone et sur un ordinateur, et les deux attendent leurs
-- notifications. L'`endpoint` est unique — c'est l'adresse que le
-- navigateur a créée pour cet appareil, elle ne se partage pas.
--
-- Les couples `p256dh` / `auth` sont les clés de chiffrement de cet
-- appareil. Sans elles, un message poussé arrive illisible : le
-- protocole (RFC 8291) chiffre le contenu pour l'appareil, pas pour le
-- serveur. Elles ne sortent jamais de la base et ne sont lues que par la
-- route d'envoi.
--
-- RLS : chacun voit et gère les siens. La route d'envoi lit les lignes
-- du **destinataire**, donc pas au nom de l'expéditeur : elle passe par
-- la connexion serveur, comme les autres envois.
-- ============================================================

create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- Une ligne qui n'a plus été revue depuis six mois est un appareil
  -- perdu ; la colonne permet de la retirer sans deviner.
  last_error   text
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_read on public.push_subscriptions;
create policy push_subscriptions_read
  on public.push_subscriptions for select
  using (auth.uid() = user_id);

drop policy if exists push_subscriptions_insert on public.push_subscriptions;
create policy push_subscriptions_insert
  on public.push_subscriptions for insert
  with check (auth.uid() = user_id);

drop policy if exists push_subscriptions_update on public.push_subscriptions;
create policy push_subscriptions_update
  on public.push_subscriptions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists push_subscriptions_delete on public.push_subscriptions;
create policy push_subscriptions_delete
  on public.push_subscriptions for delete
  using (auth.uid() = user_id);

comment on table public.push_subscriptions is
  'Un abonnement Web Push par appareil ; les clés p256dh/auth ne sortent jamais du serveur.';
