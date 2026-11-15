export const REST_PATH = "/rest/v1/";

export interface RequestHeaders {
  get(name: string): string | null;
}

export function siteOrigin(requestHeaders: RequestHeaders): string | null {
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (host) {
    const forwarded = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const local = host.startsWith("localhost") || host.startsWith("127.");
    return `${forwarded || (local ? "http" : "https")}://${host}`;
  }

  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  return vercel ? `https://${vercel.replace(/\/+$/, "")}` : null;
}

export function restTarget(input: RequestInfo | URL, origin: string): URL | null {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return null;
  }
  const index = url.pathname.indexOf(REST_PATH);
  if (index === -1) return null;
  const table = url.pathname.slice(index + REST_PATH.length);
  const target = new URL(`/api/rest/${table}`, origin);
  target.search = url.search;
  return target;
}
