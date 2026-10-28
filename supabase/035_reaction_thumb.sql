-- 035 — La réaction « Approuver » (👍)
--
-- `POST_REACTIONS[0]` est 👍 (`U+1F44D`) depuis le passage aux vrais emojis,
-- mais la contrainte de 022 ne l'autorisait pas : choisir la première
-- réaction d'une publication violait `reactions_emoji_check` et échouait.
-- On élargit les deux contraintes pour que l'ensemble autorisé couvre
-- exactement l'ensemble proposé (posts et messages partagent les mêmes).

alter table public.reactions
  drop constraint if exists reactions_emoji_check;

alter table public.reactions
  add constraint reactions_emoji_check
  check (emoji in (
    U&'\2705',
    U&'\+01F44D',
    U&'\2764\FE0F',
    U&'\+01F602',
    U&'\+01F62E',
    U&'\+01F622',
    U&'\+01F525'
  ));

alter table public.message_reactions
  drop constraint if exists message_reactions_emoji_check;

alter table public.message_reactions
  add constraint message_reactions_emoji_check
  check (emoji in (
    U&'\2705',
    U&'\+01F44D',
    U&'\2764\FE0F',
    U&'\+01F602',
    U&'\+01F62E',
    U&'\+01F622',
    U&'\+01F525'
  ));
