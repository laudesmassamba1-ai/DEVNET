import { NextRequest, NextResponse } from "next/server";
import { publicOrigin, TOKEN_COOKIE } from "@/lib/github/oauth";

export async function DELETE(request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(TOKEN_COOKIE, "", {
    httpOnly: true,
    secure: publicOrigin(request).startsWith("https:"),
    sameSite: "lax",
    path: "/api/github",
    maxAge: 0,
  });
  return response;
}