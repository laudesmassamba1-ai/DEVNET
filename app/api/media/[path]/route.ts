/**
 * Octets d'un média.
 *
 * Le chemin est la clé primaire et n'est jamais réécrit. Jusqu'ici, tous les
 * fichiers étaient lisibles sans session et servis avec un cache immuable :
 * une photo envoyée dans un message privé restait donc accessible à qui
 * possédait l'URL, même après la suppression du message.
 *
 * La migration 067 porte la décision dans la base (`can_read_media_file`) :
 * un média référencé par un message privé ou de groupe n'est visible que par
 * un participant. La route lit avec l'identité de la session (`withUser`) ou
 * en anonyme (`withAnon`) : la policy fait le tri, et une ligne interdite est
 * indiscernable d'un chemin inexistant (404).
 *
 * Le cache suit la même règle : immuable pour un média public, interdit pour
 * un média privé — une réponse autorisée une fois ne doit pas survivre à la
 * perte du droit.
 */
import { currentUserId } from "@/lib/api/server";
import { withAnon, withUser, type UserQuery } from "@/platform/infrastructure/postgres/with-user";
import { hidesSensitiveMedia, isSensitiveMedia } from "@/lib/trust-safety/media-visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Row extends Record<string, unknown> {
  mime: string;
  bytes: Buffer | null;
  url: string | null;
  is_private: boolean;
}

const PUBLIC_IMMUTABLE = "public, max-age=31536000, immutable";
const PRIVATE_NO_STORE = "private, no-store, max-age=0";

export async function GET(
  _request: Request,
  context: { params: Promise<{ path: string }> },
): Promise<Response> {
  const { path } = await context.params;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(path)) {
    return new Response("introuvable", { status: 404 });
  }

  try {
    // L'identité est résolue avant la requête : une session absente ne doit
    // pas faire échouer la lecture d'un média public.
    const userId = await currentUserId().catch(() => null);
    const read = (query: UserQuery) =>
      query<Row>(
        `select mime, bytes, url,
                public.media_file_is_private($1) as is_private
           from public.media_files
          where path = $1
          limit 1`,
        [path],
      );
    const rows = userId ? await withUser(userId, read) : await withAnon(read);
    const media = rows[0];
    if (!media) return new Response("introuvable", { status: 404 });

    // Un média signalé par l'heuristique n'est pas caché pour tout le
    // monde : seule la personne qui a demandé le filtre le voit masqué.
    if (userId && (await hidesSensitiveMedia(userId)) && (await isSensitiveMedia(path))) {
      return new Response(
        `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480" role="img" aria-label="Média masqué">
          <rect width="640" height="480" fill="transparent"/>
          <text x="320" y="244" text-anchor="middle" fill="currentColor" font-family="sans-serif" font-size="20">Média masqué par ton réglage de protection</text>
        </svg>`,
        {
          status: 200,
          headers: {
            "Content-Type": "image/svg+xml; charset=utf-8",
            "Cache-Control": "private, no-store, max-age=0",
          },
        },
      );
    }

    const cache = media.is_private ? PRIVATE_NO_STORE : PUBLIC_IMMUTABLE;

    // Un média privé n'est jamais redirigé vers son URL de stockage :
    // l'URL publique de R2/Blob ne vérifie aucune permission, et la
    // communiquer au navigateur revenait à publier le fichier. Les octets
    // sont relus ici, après la décision RLS, et servis sans cache.
    if (media.url && /^https:\/\//i.test(media.url)) {
      if (media.is_private) {
        const upstream = await fetch(media.url, { cache: "no-store" });
        if (!upstream.ok || !upstream.body) {
          return new Response("média indisponible", { status: 502 });
        }
        const mime = /^(image|video)\/[a-z0-9.+-]+$/i.test(media.mime)
          ? media.mime
          : "application/octet-stream";
        return new Response(upstream.body, {
          headers: { "Content-Type": mime, "Cache-Control": PRIVATE_NO_STORE },
        });
      }
      return new Response(null, {
        status: 302,
        headers: {
          Location: media.url,
          /*
           * Le chemin est un UUID imprévisible et le contenu ne change
           * jamais sous la même clé : la redirection est immuable. Une heure
           * de cache faisait repayer un aller-retour à chaque rechargement
           * de fil pour un fichier qui ne bougera pas.
           */
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }

    if (!media.bytes || media.bytes.length === 0) {
      return new Response("introuvable", { status: 404 });
    }

    const mime = /^(image|video)\/[a-z0-9.+-]+$/i.test(media.mime)
      ? media.mime
      : "application/octet-stream";

    return new Response(new Uint8Array(media.bytes), {
      headers: {
        "Content-Type": mime,
        "Content-Length": String(media.bytes.length),
        "Cache-Control": cache,
      },
    });
  } catch (error) {
    console.error("[media] lecture impossible", error);
    return new Response("média indisponible", { status: 503 });
  }
}
