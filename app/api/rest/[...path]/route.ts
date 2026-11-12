import { NextRequest, NextResponse } from "next/server";
import { currentUserId } from "@/lib/api/server";
import {
  executeRest,
  executeRpc,
  RestError,
  type RestOutput,
  type RestQuery,
} from "@/lib/rest/query";
import { withAnon, withUser } from "@/platform/infrastructure/postgres/with-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function errorResponse(error: RestError): NextResponse {
  return NextResponse.json(
    {
      code: error.code,
      details: error.details,
      hint: null,
      message: error.message,
    },
    { status: error.status, headers: NO_STORE },
  );
}

function successResponse(
  output: RestOutput,
  method: string,
): NextResponse {
  const single = output.single;
  let body: unknown = output.rows;
  if (single && output.rows) {
    if (output.rows.length !== 1) {
      return errorResponse(
        new RestError(
          406,
          "PGRST116",
          "JSON object requested, multiple (or no) rows returned",
        ),
      );
    }
    body = output.rows[0];
  }

  const headers: Record<string, string> = { ...NO_STORE };
  if (output.count !== null) {
    const length = output.rows?.length ?? 0;
    headers["Content-Range"] =
      length > 0 ? `0-${length - 1}/${output.count}` : `*/${output.count}`;
  }

  if (method === "HEAD") {
    return new NextResponse(null, { status: 200, headers });
  }

  if (output.rows === null && method !== "GET") {
    return new NextResponse(null, { status: 204, headers });
  }

  headers["Content-Type"] = "application/json; charset=utf-8";
  return NextResponse.json(body, {
    status: method === "POST" && output.rows !== null ? 201 : 200,
    headers,
  });
}

async function handle(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await context.params;
  if (!path || path.length === 0) {
    return errorResponse(new RestError(404, "PGRST205", "relation introuvable"));
  }

  const method = request.method.toUpperCase();
  const hasBody = method === "POST" || method === "PATCH" || method === "PUT";
  let body: unknown = undefined;
  if (hasBody) {
    try {
      body = await request.json();
    } catch {
      return errorResponse(new RestError(400, "PGRST102", "corps JSON illisible"));
    }
  }

  const prefer = request.headers.get("prefer") ?? "";
  const accept = request.headers.get("accept") ?? "";

  try {
    const callerId = await currentUserId();
    const run = (query: RestQuery) => {
      if (path[0] === "rpc") {
        if (path.length !== 2) {
          throw new RestError(404, "PGRST202", "fonction introuvable");
        }
        return executeRpc(path[1], body, query);
      }
      if (path.length !== 1) {
        throw new RestError(404, "PGRST205", "relation introuvable");
      }
      return executeRest({
        table: path[0],
        method,
        searchParams: request.nextUrl.searchParams,
        body,
        prefer,
        accept,
        query,
      });
    };

    const output = callerId
      ? await withUser(callerId, run)
      : await withAnon(run);
    return successResponse(output, method);
  } catch (error) {
    if (error instanceof RestError) return errorResponse(error);
    const cause =
      error instanceof Error && error.cause instanceof Error
        ? ` cause=${error.cause.message}`
        : "";
    console.error(
      "[rest] requête impossible",
      `${error instanceof Error ? error.message : String(error)}${cause}`,
    );
    return errorResponse(new RestError(500, "PGRST500", "requête impossible"));
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  return handle(request, context);
}

export async function HEAD(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  return handle(request, context);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  return handle(request, context);
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  return handle(request, context);
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  return handle(request, context);
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  return handle(request, context);
}
