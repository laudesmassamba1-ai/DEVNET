/**
 * Service de modération côté serveur : lire les termes administrables,
 * décider, puis laisser une trace.
 *
 * Le module de texte ne touche jamais la base : il est pur, donc testable, et
 * c'est ce qui permet de l'appeler depuis la passerelle REST, depuis les
 * statuts et depuis les sentinelles avec exactement la même règle.
 *
 * Ici on ajoute trois choses que le module pur ne peut pas faire :
 *  - charger les termes ajoutés par l'exploitation (cache court) ;
 *  - écrire un `moderation_flag` quand un contenu est publié malgré un
 *    avertissement, ou quand il est refusé ;
 *  - alimenter la file de relecture sans doublon.
 */
import { getPostgresPool } from "@/platform/infrastructure/postgres/pool";
import {
  moderateText,
  type ExtraTerm,
  type ModerationCategory,
  type ModerationSeverity,
  type TextModerationResult,
} from "./text";

export type ModerationTargetType =
  | "post"
  | "comment"
  | "message"
  | "story"
  | "profile"
  | "media";

let cache: { at: number; terms: ExtraTerm[] } | null = null;
const CACHE_TTL_MS = 60_000;

/** Termes ajoutés par l'administration, avec un cache d'une minute. */
export async function loadExtraTerms(): Promise<ExtraTerm[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.terms;
  try {
    const result = await getPostgresPool().query<{
      term: string;
      category: ModerationCategory;
      severity: ModerationSeverity;
    }>(
      `select term, category, severity
         from public.moderation_terms
        where active
        order by created_at desc
        limit 500`,
    );
    const terms: ExtraTerm[] = result.rows.map((row) => ({
      term: row.term,
      category: row.category,
      severity: row.severity,
    }));
    cache = { at: Date.now(), terms };
    return terms;
  } catch {
    // Table absente (migration pas encore appliquée) : la liste du code suffit.
    cache = { at: Date.now(), terms: [] };
    return [];
  }
}

/** Invalide le cache après une modification administrative. */
export function invalidateModerationTerms(): void {
  cache = null;
}

/** Analyse un texte avec la liste complète. */
export async function evaluateText(text: string): Promise<TextModerationResult> {
  return moderateText(text, await loadExtraTerms());
}

/**
 * Enregistre un signal dans la file, sans doublon ouvert.
 *
 * Un contenu signalé deux fois par deux chemins (texte puis image) doit
 * apparaître deux fois s'il s'agit de deux raisons différentes, mais pas
 * cinquante fois parce que le même écran a été rouvert.
 */
export async function recordModerationFlag(input: {
  targetType: ModerationTargetType;
  targetId: string;
  source: "text" | "image" | "heuristic" | "ai" | "report" | "sentinel";
  severity: ModerationSeverity;
  reason: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    await getPostgresPool().query(
      `insert into public.moderation_flags
         (target_type, target_id, source, severity, reason, details)
       select $1, $2, $3, $4, $5, $6::jsonb
        where not exists (
          select 1 from public.moderation_flags
           where target_type = $1 and target_id = $2 and status = 'open'
        )`,
      [
        input.targetType,
        input.targetId.slice(0, 200),
        input.source,
        input.severity,
        input.reason.slice(0, 400),
        JSON.stringify(input.details ?? {}),
      ],
    );
  } catch (error) {
    console.error(
      "[moderation] signal non enregistré",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export type ModerationFlagRow = {
  id: string;
  target_type: ModerationTargetType;
  target_id: string;
  source: string;
  severity: ModerationSeverity;
  reason: string;
  details: Record<string, unknown>;
  status: "open" | "confirmed" | "dismissed";
  created_at: string;
  resolved_at: string | null;
};

/** File de relecture, du plus grave au plus ancien. */
export async function listModerationFlags(
  status: "open" | "confirmed" | "dismissed" | "all" = "open",
  limit = 100,
): Promise<ModerationFlagRow[]> {
  const result = await getPostgresPool().query<ModerationFlagRow>(
    `select id, target_type, target_id, source, severity, reason, details,
            status, created_at, resolved_at
       from public.moderation_flags
      where ($1 = 'all' or status = $1)
      order by
        case severity when 'critical' then 0 when 'warning' then 1 else 2 end,
        created_at desc
      limit $2`,
    [status, Math.max(1, Math.min(500, limit))],
  );
  return result.rows;
}

/** Clôt un signal avec une décision humaine. */
export async function resolveModerationFlag(
  id: string,
  decision: "confirmed" | "dismissed",
  actorId: string,
): Promise<void> {
  await getPostgresPool().query(
    `update public.moderation_flags
        set status = $2, resolved_at = now()
      where id = $1 and status = 'open'`,
    [id, decision],
  );
  await getPostgresPool().query(
    `insert into public.admin_audit_log (actor_id, action, target_type, target_id, details)
     values ($1, 'moderation.flag', 'flag', $2, $3::jsonb)`,
    [actorId, id, JSON.stringify({ decision })],
  );
}

/** Ajoute un terme administrable (et invalide le cache). */
export async function addModerationTerm(input: {
  term: string;
  category: ModerationCategory;
  severity: ModerationSeverity;
  actorId: string;
}): Promise<void> {
  await getPostgresPool().query(
    `insert into public.moderation_terms (term, category, severity, added_by)
     values ($1, $2, $3, $4)
     on conflict (lower(term)) do update
       set category = excluded.category, severity = excluded.severity, active = true`,
    [input.term.trim().slice(0, 80), input.category, input.severity, input.actorId],
  );
  invalidateModerationTerms();
}

/** Désactive un terme administrable. */
export async function removeModerationTerm(term: string): Promise<void> {
  await getPostgresPool().query(
    "update public.moderation_terms set active = false where lower(term) = lower($1)",
    [term.trim().slice(0, 80)],
  );
  invalidateModerationTerms();
}
