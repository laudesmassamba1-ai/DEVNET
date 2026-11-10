/**
 * Stickers — catalogue, création, retrait.
 *
 * `GET` rend le catalogue visible : les stickers de la maison, les stickers
 * publics des autres, et **tous les miens**, y compris retirés. `POST` crée
 * un sticker de texte ou une image (re-encodée ici, jamais publiée telle
 * quelle) ou retire un des siens.
 *
 * Le navigateur n'envoie jamais son identifiant : la session le donne, la
 * RLS tranche.
 */
import { NextRequest, NextResponse } from "next/server";
import { decodeDataUrl, readStickerAction, StickersRepositoryError } from "@/modules/stickers";
import { currentUserId } from "@/lib/supabase/server";
import { getServerStickersRepository } from "@/platform/server-container";
import { HOUSE_STICKERS, houseStickersEnabled } from "@/lib/sticker-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function errorResponse(error: unknown): NextResponse {
  if (error instanceof StickersRepositoryError) {
    // Un refus d'image est une réponse de validation, pas une panne.
    const status = error.code === "image-refusee" ? 422 : 503;
    console.error("[stickers] échec", error.operation, error.code);
    return NextResponse.json({ error: error.message }, { status, headers: NO_STORE });
  }
  console.error(
    "[stickers] erreur inattendue",
    error instanceof Error ? error.message : String(error),
  );
  return NextResponse.json({ error: "stickers indisponibles" }, { status: 500, headers: NO_STORE });
}

export async function GET(): Promise<NextResponse> {
  try {
    const stickers = await getServerStickersRepository().list(await currentUserId());
    return NextResponse.json({ stickers }, { headers: NO_STORE });
  } catch (error) {
    // Démonstration forcée : pas de base, donc pas de catalogue. On sert
    // celui de la maison plutôt qu'une grille vide — sinon le sélecteur
    // de sticker a l'air cassé alors qu'il n'y a rien à interroger.
    if (houseStickersEnabled()) {
      return NextResponse.json({ stickers: HOUSE_STICKERS }, { headers: NO_STORE });
    }
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const readerId = await currentUserId();
  if (!readerId) {
    return NextResponse.json({ error: "session requise" }, { status: 401, headers: NO_STORE });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "corps illisible" }, { status: 400, headers: NO_STORE });
  }

  const action = readStickerAction(raw);
  if (!action.ok) {
    return NextResponse.json({ error: action.error }, { status: 400, headers: NO_STORE });
  }

  const repository = getServerStickersRepository();
  try {
    if (action.value.action === "retire") {
      await repository.retire(readerId, action.value.stickerId);
      return NextResponse.json({ ok: true }, { headers: NO_STORE });
    }

    if (action.value.action === "texte") {
      const { name, glyph, fg, bg, visibility } = action.value;
      const sticker = await repository.create(readerId, {
        kind: "texte",
        name,
        glyph,
        fg,
        bg,
        visibility,
      });
      return NextResponse.json({ ok: true, sticker }, { headers: NO_STORE });
    }

    const decoded = decodeDataUrl(action.value.dataUrl);
    if (!decoded) {
      return NextResponse.json({ error: "image illisible" }, { status: 400, headers: NO_STORE });
    }
    const sticker = await repository.create(readerId, {
      kind: "image",
      name: action.value.name,
      source: decoded.bytes,
      visibility: action.value.visibility,
    });
    return NextResponse.json({ ok: true, sticker }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
