import { NextResponse } from "next/server";
import { ADMIN_NO_STORE, requireAdmin } from "@/lib/admin-server";
import { checkDatabase, getPostgresPool } from "@/platform/infrastructure/postgres/pool";
import {
  failoverConfig,
  getFailoverState,
  inspectBothCached,
} from "@/platform/infrastructure/postgres/failover";
import { readBackupState } from "@/lib/backup-status";
import { inspectStorage } from "@/lib/storage-inventory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Hôte masqué : jamais une URL de connexion complète dans une réponse. */
function maskHost(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    return host.length > 12 ? `${host.slice(0, 6)}***${host.slice(-6)}` : "***";
  } catch {
    return null;
  }
}

/**
 * Données — ce que le module « Données » ne disait pas.
 *
 * Il partageait `AdminSystem` avec « Plateforme » et « Dépendances », donc
 * il parlait de services configurés et de région d'exécution : deux sujets
 * qui ne sont pas le sien. Il manquait l'essentiel, et c'est exactement ce
 * qui a manqué le 14 novembre : **l'état des sauvegardes**.
 *
 * Cette route répond à quatre questions, dans l'ordre où elles comptent :
 *
 *  1. Sur quelle base tourne-t-on, et la secours est-elle prête ?
 *  2. Quelle est la taille réelle, table par table ?
 *  3. **Y a-t-il une sauvegarde récente, et est-elle hors site ?**
 *  4. Les tables qui ne servent à rien sont-elles vides, ou grossissent-elles ?
 *
 * La question 3 est celle qui a coûté cher : le 14 novembre, la base est
 * tombée et personne ne pouvait dire depuis l'application si une sauvegarde
 * existait. Le script de sauvegarde dépose une archive chiffrée sur R2 avec
 * un jeton aléatoire dans le préfixe — donc invisible à qui ne connaît pas
 * l'URL. On interroge donc R2 en **lecture seule** pour lister les archives,
 * et on rapporte l'âge de la plus récente.
 *
 * Rien de secret ne sort : ni clé, ni URL de connexion, ni nom d'objet
 * complet. Seulement des dates, des tailles et un verdict.
 */

type TableSize = { table: string; bytes: number; rows: number };


/** Tailles, migration courante et tables vides — jamais bloquant. */
async function readTableState(): Promise<{
  tables: TableSize[];
  sizeBytes: number | null;
  migration: string | null;
  emptyTables: number;
  totalTables: number;
}> {
  try {
    const pool = getPostgresPool();
    const [sizes, total, latest, counts] = await Promise.all([
      pool.query<{ table: string; bytes: string; rows: string }>(`
        select c.relname as table,
               pg_total_relation_size(c.oid)::text as bytes,
               greatest(c.reltuples, 0)::bigint::text as rows
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'r'
         order by pg_total_relation_size(c.oid) desc
         limit 15
      `),
      pool.query<{ bytes: string }>(
        "select pg_database_size(current_database())::text as bytes",
      ),
      pool
        .query<{ name: string }>(
          "select name from public.schema_migrations order by applied_at desc limit 1",
        )
        .catch(() => null),
      pool.query<{ total: string; empty: string }>(`
        select count(*)::text as total,
               count(*) filter (where c.reltuples = 0)::text as empty
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'r'
      `),
    ]);

    return {
      tables: sizes.rows.map((row) => ({
        table: row.table,
        bytes: Number(row.bytes),
        rows: Number(row.rows),
      })),
      sizeBytes: total.rows[0] ? Number(total.rows[0].bytes) : null,
      migration: latest?.rows[0]?.name ?? null,
      totalTables: Number(counts.rows[0]?.total ?? 0),
      emptyTables: Number(counts.rows[0]?.empty ?? 0),
    };
  } catch {
    return { tables: [], sizeBytes: null, migration: null, emptyTables: 0, totalTables: 0 };
  }
}

export async function GET(): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json(
      { error: admin.error },
      { status: admin.status, headers: ADMIN_NO_STORE },
    );
  }

  /*
   * Tout ce qui est indépendant part en parallèle. La version séquentielle
   * payait la sonde de la base, puis R2 et Blob, puis la sauvegarde, puis
   * les tailles de tables : ~9 s sur une console froide. En parallèle, le
   * temps total est celui du plus lent, pas leur somme.
   */
  const [health, databases, storage, backups, tableState] = await Promise.all([
    checkDatabase(2_000),
    inspectBothCached().catch(() => null),
    inspectStorage().catch(() => null),
    readBackupState().catch(() => null),
    readTableState(),
  ]);
  const failover = getFailoverState();
  const { tables, sizeBytes, migration, emptyTables, totalTables } = tableState;

  return NextResponse.json(
    {
      checkedAt: new Date().toISOString(),
      database: {
        ok: health.ok,
        latencyMs: health.ok ? health.latencyMs : null,
        reason: health.ok ? null : health.reason,
        host: maskHost(
          failover.active === "standby"
            ? process.env.DATABASE_URL_STANDBY
            : process.env.DATABASE_URL,
        ),
      },
      failover: {
        active: failover.active,
        standbyConfigured: failover.standbyConfigured,
        switchedAt: failover.switchedAt,
        reason: failover.reason,
      },
      config: failoverConfig(),
      databases,
      storage,
      sizeBytes,
      migration,
      tables,
      tableCount: { total: totalTables, empty: emptyTables },
      backups: backups ?? {
        configured: false,
        count: null,
        newestAt: null,
        newestBytes: null,
        verdict: "error",
        detail: "état des sauvegardes illisible pour l'instant.",
      },
    },
    { headers: ADMIN_NO_STORE },
  );
}
