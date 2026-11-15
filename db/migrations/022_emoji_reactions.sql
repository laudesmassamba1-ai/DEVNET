-- 022 — Des réactions en vrais emojis
--
-- Pourquoi cette migration existe : la liste fermée de 016 et 018
-- codait des **noms d'icônes** (`check`, `like`, …) que seul l'ancien
-- jeu `components/Icon.tsx` savait dessiner. L'interface affiche
-- désormais de vrais emojis Unicode : il faut donc élargir la
-- contrainte **et** réécrire les lignes déjà stockées, sinon la
-- nouvelle contrainte refuserait l'existant.
--
-- Les glyphes sont écrits en échappements `U&` pour que le fichier
-- reste en ASCII : aucun emoji littéral dans le code.

-- ── Réactions de publication ────────────────────────────────────────

update public.reactions set emoji = case emoji
  when 'check'   then U&'\2705'
  when 'like'    then U&'\2764\FE0F'
  when 'smile'   then U&'\+01F602'
  when 'eye'     then U&'\+01F62E'
  when 'droplet' then U&'\+01F622'
  when 'flame'   then U&'\+01F525'
  else emoji
end;

alter table public.reactions
  drop constraint if exists reactions_emoji_check;

alter table public.reactions
  add constraint reactions_emoji_check
  check (emoji in (
    U&'\2705',
    U&'\2764\FE0F',
    U&'\+01F602',
    U&'\+01F62E',
    U&'\+01F622',
    U&'\+01F525'
  ));

-- ── Réactions de message ────────────────────────────────────────────

update public.message_reactions set emoji = case emoji
  when 'check'   then U&'\2705'
  when 'like'    then U&'\2764\FE0F'
  when 'smile'   then U&'\+01F602'
  when 'eye'     then U&'\+01F62E'
  when 'droplet' then U&'\+01F622'
  when 'flame'   then U&'\+01F525'
  else emoji
end;

alter table public.message_reactions
  drop constraint if exists message_reactions_emoji_check;

alter table public.message_reactions
  add constraint message_reactions_emoji_check
  check (emoji in (
    U&'\2705',
    U&'\2764\FE0F',
    U&'\+01F602',
    U&'\+01F62E',
    U&'\+01F622',
    U&'\+01F525'
  ));
