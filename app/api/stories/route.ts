/**
 * Stories et interactions — route serveur.
 *
 * Le navigateur ne lit plus la table des stories directement pour savoir
 * s'il a aimé, ni n'écrit une réponse depuis le client : l'identité est lue
 * ici, la RLS tranche, et les gestes sont validés avant Postgres.
 *
 * `GET` rend le fil des stories vivantes avec l'état du lecteur et le
 * catalogue de stickers. `POST` reçoit un geste : like, vue, réponse privée,
 * pose de sticker. Sans session, la lecture rend un fil vide et le geste est
 * refusé : personne n'agit au nom de personne.
 */
import { NextRequest, NextResponse } from "next/server";
import { readStoryAction, StoriesRepositoryError } from "@/modules/stories";
import { currentUserId } from "@/lib/api/server";
import { getServerStoriesRepository } from "@/platform/server-container";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const UNAVAILABLE = () =>
  NextResponse.json({ error: "stories indisponibles" }, { status: 503, headers: NO_STORE });

export async function GET(): Promise<NextResponse> {
  try {
    const feed = await getServerStoriesRepository().fetchFeed(await currentUserId());
    return NextResponse.json(feed, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof StoriesRepositoryError) {
      console.error("[stories] lecture impossible", error.code);
      return UNAVAILABLE();
    }
    console.error(
      "[stories] erreur inattendue",
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.json({ error: "stories indisponibles" }, { status: 500, headers: NO_STORE });
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

  const action = readStoryAction(raw);
  if (!action.ok) {
    return NextResponse.json({ error: action.error }, { status: 400, headers: NO_STORE });
  }

  const repository = getServerStoriesRepository();
  try {
    switch (action.value.action) {
      case "like": {
        const result = await repository.toggleLike(readerId, action.value.storyId);
        return NextResponse.json(result, { headers: NO_STORE });
      }
      case "view": {
        await repository.markSeen(readerId, action.value.storyId);
        return NextResponse.json({ ok: true }, { headers: NO_STORE });
      }
      case "reply": {
        const result = await repository.reply(readerId, action.value.storyId, action.value.body);
        return NextResponse.json(
          {
            ok: true,
            id: result.id,
            conversationId: result.conversationId,
            messageId: result.messageId,
          },
          { headers: NO_STORE },
        );
      }
      case "sticker": {
        const { storyId, stickerId, x, y, scale, rotation } = action.value;
        const sticker = await repository.placeSticker(readerId, storyId, {
          stickerId,
          x,
          y,
          scale,
          rotation,
        });
        return NextResponse.json({ ok: true, sticker }, { headers: NO_STORE });
      }
      case "move-sticker": {
        const { storyId, placedId, x, y, scale, rotation } = action.value;
        const sticker = await repository.moveSticker(readerId, storyId, placedId, {
          x,
          y,
          scale,
          rotation,
        });
        return NextResponse.json({ ok: true, sticker }, { headers: NO_STORE });
      }
      case "remove-sticker": {
        await repository.removeSticker(readerId, action.value.storyId, action.value.placedId);
        return NextResponse.json({ ok: true }, { headers: NO_STORE });
      }
    }
  } catch (error) {
    if (error instanceof StoriesRepositoryError) {
      console.error("[stories] geste refusé", error.operation, error.code);
      return UNAVAILABLE();
    }
    console.error(
      "[stories] erreur inattendue",
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.json({ error: "geste impossible" }, { status: 500, headers: NO_STORE });
  }
}
