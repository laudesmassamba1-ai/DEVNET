import { NextRequest, NextResponse } from "next/server";
import { decryptValue, hasVaultKey } from "@/lib/github/crypto";
import { TOKEN_COOKIE } from "@/lib/github/oauth";

export async function GET(request: NextRequest) {
  if (!hasVaultKey()) {
    return NextResponse.json({ error: "unconfigured" }, { status: 503 });
  }

  const envelope = request.cookies.get(TOKEN_COOKIE)?.value;
  if (!envelope) {
    return NextResponse.json({ error: "no-token" }, { status: 401 });
  }

  const token = await decryptValue(process.env.GITHUB_CRYPT_KEY ?? "", envelope);
  if (!token) {
    return NextResponse.json({ error: "invalid-token" }, { status: 401 });
  }

  const response = await fetch("https://api.github.com/user", {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    return NextResponse.json({ error: "identity-unavailable" }, { status: 502 });
  }

  const identity = (await response.json().catch(() => null)) as { login?: string } | null;
  if (!identity?.login) {
    return NextResponse.json({ error: "identity-unavailable" }, { status: 502 });
  }

  return NextResponse.json(
    { login: identity.login },
    { headers: { "cache-control": "no-store" } },
  );
}