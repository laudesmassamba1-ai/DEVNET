import { NextResponse } from "next/server";
import { ADMIN_NO_STORE, requireAdmin } from "@/lib/admin-server";
import { checkDatabase, hasDatabaseUrl, getPostgresPool } from "@/platform/infrastructure/postgres/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const configured = (value: string | undefined): boolean => Boolean(value?.trim());

/** État système agrégé : aucune valeur de secret ne quitte cette route. */
export async function GET(): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json(
      { error: admin.error },
      { status: admin.status, headers: ADMIN_NO_STORE },
    );
  }

  const health = await checkDatabase(2_000);
  let counts: Record<string, number> = {};
  let sizeBytes: number | null = null;
  let migration: string | null = null;

  try {
    const pool = getPostgresPool();
    const [aggregate, size, latestMigration] = await Promise.all([
      pool.query(`
        select
          (select count(*)::int from public.users) as users,
          (select count(*)::int from public.posts) as posts,
          (select count(*)::int from public.projects) as projects,
          (select count(*)::int from public.reports where status = 'open') as reports_open,
          (select count(*)::int from public.sessions where expires_at > now()) as sessions_active
      `),
      pool
        .query<{ bytes: string }>("select pg_database_size(current_database())::text as bytes")
        .catch(() => null),
      pool
        .query<{ name: string }>("select name from public.schema_migrations order by applied_at desc limit 1")
        .catch(() => null),
    ]);
    counts = aggregate.rows[0] as Record<string, number>;
    sizeBytes = size?.rows[0] ? Number(size.rows[0].bytes) : null;
    migration = latestMigration?.rows[0]?.name ?? null;
  } catch {
    // Les compteurs sont secondaires : la sonde de disponibilité reste la
    // source principale de l'écran.
  }

  return NextResponse.json(
    {
      checkedAt: new Date().toISOString(),
      region: process.env.VERCEL_REGION ?? null,
      environment: process.env.VERCEL_ENV ?? null,
      database: {
        configured: hasDatabaseUrl(),
        ok: health.ok,
        latencyMs: health.ok ? health.latencyMs : null,
        reason: health.ok ? null : health.reason,
      },
      counts,
      sizeBytes,
      migration,
      services: {
        database: hasDatabaseUrl(),
        blob: configured(process.env.BLOB_READ_WRITE_TOKEN),
        r2: Boolean(
          (process.env.R2_ENDPOINT?.trim() || process.env.R2_ACCOUNT_ID?.trim()) &&
            configured(process.env.R2_ACCESS_KEY_ID) &&
            configured(process.env.R2_SECRET_ACCESS_KEY) &&
            configured(process.env.R2_BUCKET) &&
            configured(process.env.R2_PUBLIC_URL),
        ),
        googleLogin:
          configured(process.env.GOOGLE_CLIENT_ID) &&
          configured(process.env.GOOGLE_CLIENT_SECRET) &&
          configured(process.env.AUTH_OAUTH_SECRET),
        githubLogin:
          configured(process.env.GITHUB_LOGIN_CLIENT_ID) &&
          configured(process.env.GITHUB_LOGIN_CLIENT_SECRET) &&
          configured(process.env.AUTH_OAUTH_SECRET),
        githubRepos:
          configured(process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID) &&
          configured(process.env.GITHUB_CLIENT_SECRET) &&
          configured(process.env.GITHUB_CRYPT_KEY),
      },
    },
    { headers: ADMIN_NO_STORE },
  );
}
