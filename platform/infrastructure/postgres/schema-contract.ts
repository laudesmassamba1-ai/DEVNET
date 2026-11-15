/**
 * Contrat de schéma de la base **active**.
 *
 * `/api/ready` comparait deux empreintes de schéma. Quand la secours est
 * injoignable, la comparaison vaut `null` et la readiness ne dit plus rien
 * sur la base qui sert réellement. Ce contrat comble ce trou sans dépendre
 * de la secours : il vérifie les tables, colonnes et fonctions dont
 * Trust & Safety a besoin sur la base active.
 *
 * Le résultat est mis en cache une minute : une sonde de disponibilité ne
 * doit pas interroger `information_schema` à chaque requête. Une migration
 * appliquée pendant ce délai peut donc être signalée en retard au plus
 * soixante secondes, ce qui est acceptable pour un health check.
 */
import { getPostgresPool } from "./pool";

const REQUIRED_TABLES: Record<string, string[]> = {
  moderation_roles: ["user_id", "role"],
  user_blocks: ["blocker_id", "blocked_id"],
  user_mutes: ["muter_id", "muted_id"],
  user_sanctions: ["id", "user_id", "kind", "status", "reason_code"],
  sanction_appeals: ["id", "sanction_id", "user_id", "status", "reviewed_by"],
  moderation_policy_versions: ["version", "active", "categories", "thresholds"],
  moderation_cases: ["id", "target_type", "target_id", "status", "policy_version"],
  moderation_case_events: ["case_id", "event"],
  moderation_findings: ["id", "case_id", "engine", "category"],
  moderation_evidence: ["id", "case_id", "content_table"],
  moderation_engine_runs: ["engine", "status"],
  moderation_blocked_domains: ["domain", "category", "reason"],
  user_safety_settings: [
    "user_id",
    "who_can_message",
    "who_can_comment",
    "filter_offensive",
    "hide_sensitive_media",
  ],
  reports: ["id", "story_id", "direct_message_id", "case_id", "target_type"],
  notifications: ["id", "kind", "sanction_id"],
};

const REQUIRED_FUNCTIONS = [
  "open_moderation_case",
  "set_safety_settings",
  "issue_sanction",
  "review_appeal",
  "can_view_trust_safety",
  "is_login_blocked",
];

export interface SchemaContract {
  ok: boolean;
  missing: string[];
  checkedAt: string;
}

let cached: { at: number; value: SchemaContract } | null = null;
const TTL_MS = 60_000;

export async function checkActiveSchema(): Promise<SchemaContract> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;

  const tables = Object.keys(REQUIRED_TABLES);
  const pool = getPostgresPool();
  const [columns, functions] = await Promise.all([
    pool.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name
         from information_schema.columns
        where table_schema = 'public'
          and table_name = any($1::text[])`,
      [tables],
    ),
    pool.query<{ proname: string }>(
      `select p.proname
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = any($1::text[])`,
      [REQUIRED_FUNCTIONS],
    ),
  ]);

  const foundColumns = new Set(
    columns.rows.map((row) => `${row.table_name}.${row.column_name}`),
  );
  const foundFunctions = new Set(functions.rows.map((row) => row.proname));
  const missing: string[] = [];

  for (const [table, required] of Object.entries(REQUIRED_TABLES)) {
    for (const column of required) {
      if (!foundColumns.has(`${table}.${column}`)) missing.push(`${table}.${column}`);
    }
  }
  for (const name of REQUIRED_FUNCTIONS) {
    if (!foundFunctions.has(name)) missing.push(`fonction:${name}`);
  }

  const value: SchemaContract = {
    ok: missing.length === 0,
    missing,
    checkedAt: new Date().toISOString(),
  };
  cached = { at: Date.now(), value };
  return value;
}

/** Réservé aux migrations ou aux tests qui viennent de changer le schéma. */
export function invalidateSchemaContract(): void {
  cached = null;
}
