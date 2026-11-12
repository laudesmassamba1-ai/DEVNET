/**
 * Octets d'un média.
 *
 * Le chemin est la clé primaire et n'est jamais réécrit : le cache peut donc
 * être immuable. La lecture passe par `withAnon` et la politique
 * `media_files_read`, qui retrouve la sémantique de l'ancien bucket public.
 */
import { withAnon } from "@/platform/infrastructure/postgres/with-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Row extends Record<string, unknown> {
  mime: string;
  bytes: Buffer | null;
  url: string | null;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ path: string }> },
): Promise<Response> {
  const { path } = await context.params;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(path)) {
    return new Response("introuvable", { status: 404 });
  }

  try {
    const rows = await withAnon((query) =>
      query<Row>(
        "select mime, bytes, url from public.media_files where path = $1 limit 1",
        [path],
      ),
    );
    const media = rows[0];
    if (!media) return new Response("introuvable", { status: 404 });

    if (media.url) {
      return new Response(null, {
        status: 302,
        headers: {
          Location: media.url,
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    if (!media.bytes) return new Response("introuvable", { status: 404 });

    return new Response(new Uint8Array(media.bytes), {
      headers: {
        "Content-Type": media.mime,
        "Content-Length": String(media.bytes.length),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("[media] lecture impossible", error);
    return new Response("média indisponible", { status: 503 });
  }
}
