-- L'adresse email n'est plus lisible par les autres membres.
--
-- La politique `users_read` autorise tout utilisateur authentifié à lire
-- la ligne `users` des autres : c'est voulu pour le pseudo, l'avatar ou la
-- bio. Mais `select *` exposait aussi `email`, ce qui transformait
-- l'annuaire public en fuite d'adresses.
--
-- On retire le privilège de table et on le rend colonne par colonne, en
-- laissant `email` de côté. PostgREST refuse alors `select=*` sur `users`
-- (il exige toutes les colonnes) : les lectures doivent nommer leurs
-- colonnes, ce que fait `lib/supabase/profile.ts`. L'email du compte
-- courant vient de la session `auth`, jamais de la table.
--
-- L'annuaire d'administration continue de lire les emails via
-- `admin_search_accounts()`, qui vérifie `is_admin()` et s'exécute en
-- `security definer`.

revoke select on public.users from anon, authenticated;

grant select (
  id,
  prenom,
  pseudo,
  filiere,
  niveau,
  langages,
  avatar_color,
  bio,
  followers,
  following,
  created_at,
  account_type,
  verified,
  ville,
  pays,
  links,
  theme,
  is_admin,
  verification_status,
  verification_note
) on public.users to anon, authenticated;

create or replace function public.admin_search_accounts(term text default '')
returns table (
  id uuid,
  prenom text,
  pseudo text,
  email text,
  avatar_color text,
  account_type text,
  verified boolean,
  is_admin boolean,
  verification_status text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    u.id,
    u.prenom,
    u.pseudo,
    u.email,
    u.avatar_color,
    u.account_type,
    u.verified,
    u.is_admin,
    u.verification_status,
    u.created_at
  from public.users u
  where public.is_admin()
    and (
      coalesce(term, '') = ''
      or u.pseudo ilike '%' || term || '%'
      or u.prenom ilike '%' || term || '%'
      or u.email ilike '%' || term || '%'
    )
  order by u.is_admin desc, u.pseudo asc
  limit 300;
$$;

revoke all on function public.admin_search_accounts(text) from public;
grant execute on function public.admin_search_accounts(text) to authenticated;
