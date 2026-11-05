/**
 * Nom **fixe** du cookie qui porte la session Supabase.
 *
 * `@supabase/ssr` dérive ce nom de l'URL du projet : le navigateur, qui
 * parle à l'origine relayée (`http://localhost:3000`), obtenait
 * `sb-localhost-auth-token`, tandis que le serveur, qui lit
 * `NEXT_PUBLIC_SUPABASE_URL` (`http://127.0.0.1:54321`), cherchait
 * `sb-127-auth-token`. Les deux côtés ne voyaient donc pas le même
 * cookie : la connexion réussissait dans le navigateur, puis le proxy et
 * le layout refusaient `/admin` faute de session — constaté sur le
 * Supabase local.
 *
 * Le nom est posé explicitement (`cookieOptions.name`) dans les trois
 * clients : navigateur, serveur, proxy. Il ne dépend plus de l'hôte, ce
 * qui garde la session lisible côté serveur que l'on passe par
 * `localhost`, `127.0.0.1` ou un tunnel. Changer ce nom déconnecte les
 * sessions existantes : c'est un changement de format, pas un détail.
 */
export const AUTH_COOKIE_NAME = "sb-devnet-auth-token";
