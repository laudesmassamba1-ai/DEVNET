export async function readObjectBody(
  request: Request,
): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function stringField(
  body: Record<string, unknown>,
  name: string,
): string | null {
  const value = body[name];
  return typeof value === "string" ? value : null;
}

export function objectField(
  body: Record<string, unknown>,
  name: string,
): Record<string, unknown> {
  const value = body[name];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
