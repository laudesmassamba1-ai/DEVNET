export const AUTHOR_COLUMNS =
  "id, prenom, pseudo, avatar_color, avatar_url, account_type, verified, is_admin, filiere, niveau";

export const PROFILE_COLUMNS =
  `${AUTHOR_COLUMNS}, bio, langages, ville, pays, links, followers, following`;

export const POST_AUTHOR_COLUMNS =
  `users!posts_author_id_fkey(${AUTHOR_COLUMNS})`;
