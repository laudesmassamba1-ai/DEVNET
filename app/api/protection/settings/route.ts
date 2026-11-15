import { NextRequest, NextResponse } from "next/server";
import { currentUserId } from "@/lib/api/server";
import {
  mySafetySettings,
  setSafetySettings,
  TrustSafetyError,
  type SafetyAudience,
} from "@/lib/trust-safety/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const AUDIENCES: ReadonlySet<SafetyAudience> = new Set(["everyone", "followers", "nobody"]);

function audience(value: unknown): SafetyAudience | undefined {
  return typeof value === "string" && AUDIENCES.has(value as SafetyAudience)
    ? (value as SafetyAudience)
    : undefined;
}

async function session(): Promise<{ userId: string } | { error: NextResponse }> {
  try {
    const userId = await currentUserId();
    if (!userId) {
      return { error: NextResponse.json({ error: "session requise" }, { status: 401, headers: NO_STORE }) };
    }
    return { userId };
  } catch {
    return {
      error: NextResponse.json({ error: "session indisponible" }, { status: 503, headers: NO_STORE }),
    };
  }
}

export async function GET(): Promise<NextResponse> {
  const auth = await session();
  if ("error" in auth) return auth.error;

  try {
    return NextResponse.json({ settings: await mySafetySettings(auth.userId) }, { headers: NO_STORE });
  } catch (error) {
    const status = error instanceof TrustSafetyError ? error.status : 503;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "lecture impossible" },
      { status, headers: NO_STORE },
    );
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const auth = await session();
  if ("error" in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "corps illisible" }, { status: 400, headers: NO_STORE });
  }

  const words = Array.isArray(body.blocked_words)
    ? body.blocked_words.filter((word): word is string => typeof word === "string")
    : undefined;

  if (words && words.length > 100) {
    return NextResponse.json(
      { error: "100 mots filtrés au maximum" },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const settings = await setSafetySettings(auth.userId, {
      whoCanMessage: audience(body.who_can_message),
      whoCanComment: audience(body.who_can_comment),
      whoCanMention: audience(body.who_can_mention),
      filterOffensive:
        typeof body.filter_offensive === "boolean" ? body.filter_offensive : undefined,
      hideSensitiveMedia:
        typeof body.hide_sensitive_media === "boolean" ? body.hide_sensitive_media : undefined,
      blockedWords: words,
    });
    return NextResponse.json({ settings }, { headers: NO_STORE });
  } catch (error) {
    const status = error instanceof TrustSafetyError ? error.status : 503;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "écriture impossible" },
      { status, headers: NO_STORE },
    );
  }
}
