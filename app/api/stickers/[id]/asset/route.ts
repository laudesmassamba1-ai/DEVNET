/**
 * Octets d'un sticker d'image.
 *
 * Une route dédiée, séparée du catalogue : les octets sont lourds, et une
 * liste ne doit pas les transporter. Le cache est immuable — un sticker ne
 * change jamais d'octets (il est retiré, pas modifié), et l'URL contient son
 * identifiant définitif.
 */
import { NextResponse } from "next/server";
import { StickersRepositoryError } from "@/modules/stickers";
import { currentUserId } from "@/lib/api/server";
import { getServerStickersRepository } from "@/platform/server-container";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;

  try {
    const asset = await getServerStickersRepository().fetchAsset(await currentUserId(), id);
    if (!asset) {
      return NextResponse.json({ error: "sticker introuvable" }, { status: 404 });
    }

    return new Response(new Uint8Array(asset.bytes), {
      headers: {
        "Content-Type": asset.mime,
        "Content-Length": String(asset.bytes.length),
        // Un sticker privé ne doit jamais atterrir dans un cache partagé.
        "Cache-Control":
          asset.visibility === "public"
            ? "public, max-age=31536000, immutable"
            : "private, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    if (error instanceof StickersRepositoryError) {
      console.error("[stickers] octets illisibles", error.code);
    }
    return NextResponse.json({ error: "sticker indisponible" }, { status: 503 });
  }
}
