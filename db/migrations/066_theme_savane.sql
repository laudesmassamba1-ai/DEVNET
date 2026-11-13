-- ============================================================
-- 066 — Trois thèmes dans `users.theme`
--
-- La contrainte posée en 034 n'autorisait que `liquid-bleu` et `light`.
-- `liquid-bleu` ne correspondait plus à aucun thème depuis longtemps (le
-- défaut réel est « dark », et `normalizeTheme` ramenait déjà toute valeur
-- inconnue vers lui), et le thème « savane » ne pouvait pas être
-- enregistré : l'écran réglages appliquait la palette puis échouait à
-- écrire le choix sur le compte.
--
-- On aligne donc la contrainte sur `lib/theme.ts` : les trois identifiants
-- affichés — `dark`, `light`, `savane` — et rien d'autre. Les lignes qui
-- portent encore l'ancien nom sont converties avant de reposer la
-- contrainte, sinon la validation échouerait sur des données existantes.
--
-- Additif : aucune colonne supprimée, aucune ligne perdue (le thème est
-- une préférence d'affichage, la conversion `liquid-bleu` → `dark` est
-- exactement ce que l'utilisateur voyait déjà).
-- ============================================================

alter table public.users
  drop constraint if exists users_theme_check;

update public.users
   set theme = 'dark'
 where theme is null
    or theme not in ('dark', 'light', 'savane');

alter table public.users
  alter column theme set default 'dark';

alter table public.users
  add constraint users_theme_check
  check (theme in ('dark', 'light', 'savane'));
