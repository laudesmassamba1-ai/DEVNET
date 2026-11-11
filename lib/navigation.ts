const PARENT_ROUTES: Record<string, string> = {
  communities: "/communities",
  groups: "/groups",
  github: "/github",
  ide: "/projects",
  post: "/feed",
  projects: "/projects",
};

export function getBackFallback(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0 || pathname === "/feed") return null;

  if (segments[0] === "admin" && segments.length > 1) return "/admin";
  if (segments[0] === "u" && segments.length > 2) {
    return `/u/${segments[1]}`;
  }

  const parent = PARENT_ROUTES[segments[0]];
  if (parent) return parent;

  return segments.length > 1 ? `/${segments[0]}` : "/feed";
}
