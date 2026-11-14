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

    const cache = media.is_private ? PRIVATE_NO_STORE : PUBLIC_IMMUTABLE;

    // Une URL distante n'est suivie que si elle est HTTPS : le repli sur les
    // octets reste possible, et une valeur corrompue en base ne transforme
    // pas la route en redirection ouverte.
    if (media.url && /^https:\/\//i.test(media.url)) {
      return new Response(null, {
        status: 302,
        headers: {
          Location: media.url,
          "Cache-Control": media.is_private ? PRIVATE_NO_STORE : "public, max-age=3600",
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
