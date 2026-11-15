import { recordModerationFlag } from "@/lib/moderation/service";
import { analyzeWrittenText } from "@/lib/trust-safety";
import type { RestRow } from "./query";

/**
 * Écritures de modération après l'insertion.
 *
 * Ces deux gestes sont sortis de `query.ts` pour garder le routeur REST
 * sous la barre des 800 lignes. Ils ne dépendent que du nom de la table et
 * des lignes écrites : les déplacer ne change aucune règle.
 */
export type PendingFlag = {
  table: string;
  field: string;
  targetId: string | null;
  severity: "info" | "warning" | "critical";
  reason: string;
  details: Record<string, unknown>;
};

/** Enregistre les signaux après une écriture réussie, sans la retarder. */
export async function storeFlags(
  flags: PendingFlag[],
  inserted: RestRow[] | null,
): Promise<void> {
  if (flags.length === 0) return;
  const ids = (inserted ?? [])
    .map((row) => (typeof row.id === "string" ? row.id : null))
    .filter((id): id is string => Boolean(id));
  await Promise.all(
    flags.map((flag, index) =>
      recordModerationFlag({
        targetType:
          flag.table === "posts"
            ? "post"
            : flag.table === "comments"
              ? "comment"
              : flag.table === "stories"
                ? "story"
                : flag.table === "users"
                  ? "profile"
                  : "message",
        targetId: flag.targetId ?? ids[index] ?? `refus:${Date.now()}`,
        source: "text",
        severity: flag.severity,
        reason: flag.reason,
        details: { ...flag.details, field: flag.field, table: flag.table },
      }),
    ),
  );
}

/**
 * Rattache une écriture à un dossier Trust & Safety.
 *
 * L'écriture est déjà faite : cette analyse ne peut donc pas la refuser.
 * Elle ouvre un dossier si un moteur trouve quelque chose, et elle est
 * volontairement silencieuse en cas de panne.
 */
export async function analyzeInserted(
  tableName: string,
  rows: RestRow[] | null,
): Promise<void> {
  if (!rows || rows.length === 0) return;
  const targetType: Record<string, string> = {
    posts: "post",
    comments: "comment",
    direct_messages: "direct_message",
    group_messages: "group_message",
    stories: "story",
    users: "profile",
  };
  const type = targetType[tableName];
  if (!type) return;
  const fields: Record<string, string[]> = {
    posts: ["text"],
    comments: ["text"],
    direct_messages: ["text"],
    group_messages: ["text"],
    stories: ["caption"],
    users: ["prenom", "pseudo", "bio", "filiere"],
  };
  const names = fields[tableName];
  if (!names) return;

  for (const row of rows.slice(0, 5)) {
    const id = typeof row.id === "string" ? row.id : null;
    if (!id) continue;
    const authorId =
      typeof row.author_id === "string"
        ? row.author_id
        : tableName === "users"
          ? id
          : null;
    if (!authorId) continue;
    const text = names
      .map((field) => (typeof row[field] === "string" ? row[field] : ""))
      .filter(Boolean)
      .join("\n")
      .trim();
    if (!text) continue;
    await analyzeWrittenText({ targetType: type, targetId: id, text, authorId }).catch(
      () => undefined,
    );
  }
}
