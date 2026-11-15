/**
 * Façade serveur du Trust & Safety.
 *
 * Tout passe par `withUser` : les RPC sont `security definer`, mais elles
 * lisent `auth.uid()` — donc l'identité doit être posée dans la transaction.
 * Aucune fonction de ce fichier n'utilise le pool propriétaire pour une
 * action utilisateur : ce serait contourner la RLS et les gardes en base.
 */
import { withUser } from "@/platform/infrastructure/postgres/with-user";

export type ModerationRole =
  | "owner"
  | "admin"
  | "lead_moderator"
  | "moderator"
  | "analyst";

export type SanctionKind = "warning" | "restrict" | "suspend" | "ban";

export type SanctionRow = {
  id: string;
  user_id: string;
  pseudo: string | null;
  kind: SanctionKind;
  reason_code: string;
  note: string;
  status: "active" | "lifted" | "expired";
  starts_at: string;
  ends_at: string | null;
  issued_by: string | null;
  issued_by_pseudo: string | null;
  lifted_at: string | null;
  created_at: string;
  pending_appeals: number;
};

export type AppealRow = {
  id: string;
  sanction_id: string;
  user_id: string;
  pseudo: string | null;
  message: string;
  status: "pending" | "upheld" | "overturned";
  reviewed_by: string | null;
  reviewed_at: string | null;
  decision_note: string;
  created_at: string;
  sanction_kind: SanctionKind;
  sanction_reason: string;
};

export type RelationRow = { id: string; pseudo: string; created_at: string };

export type SafetyAudience = "everyone" | "followers" | "nobody";

export type SafetySettings = {
  user_id: string;
  who_can_message: SafetyAudience;
  who_can_comment: SafetyAudience;
  who_can_mention: SafetyAudience;
  filter_offensive: boolean;
  hide_sensitive_media: boolean;
  blocked_words: string[];
  updated_at: string;
};

export type MyAppeal = {
  id: string;
  sanction_id: string;
  message: string;
  status: "pending" | "upheld" | "overturned";
  decision_note: string;
  created_at: string;
  reviewed_at: string | null;
  sanction_kind: SanctionKind;
  sanction_reason: string;
};

export type MyProtection = {
  blocks: RelationRow[];
  mutes: RelationRow[];
  sanctions: SanctionRow[];
  settings: SafetySettings;
  appeals: MyAppeal[];
};

/** Erreur lisible, sans exposer le SQL ni l'URL de connexion. */
export class TrustSafetyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "TrustSafetyError";
  }
}

function translate(error: unknown): TrustSafetyError {
  const message = error instanceof Error ? error.message : "";
  if (/réservé|permission denied/i.test(message)) {
    return new TrustSafetyError("action réservée à la modération", 403);
  }
  if (/introuvable/i.test(message)) return new TrustSafetyError("élément introuvable", 404);
  if (/invalide|inconnu|suspendu|banni|soi-même|entre 10/i.test(message)) {
    return new TrustSafetyError(message, 400);
  }
  if (/déjà|unique|duplicate/i.test(message)) {
    return new TrustSafetyError("action déjà effectuée", 409);
  }
  return new TrustSafetyError("action impossible", 503);
}

async function run<T extends Record<string, unknown>>(
  userId: string,
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  try {
    return await withUser(userId, (query) => query<T>(sql, values));
  } catch (error) {
    throw translate(error);
  }
}

/** Rôle effectif, calculé en base (is_admin inclus). */
export async function effectiveRole(userId: string): Promise<ModerationRole | null> {
  const rows = await run<{ role: ModerationRole | null }>(
    userId,
    "select public.trust_safety_role() as role",
  );
  return rows[0]?.role ?? null;
}

/** Protection du compte courant : blocages, sourdines, sanctions. */
export async function myProtection(userId: string): Promise<MyProtection> {
  const [blocks, mutes, sanctions, settings, appeals] = await Promise.all([
    run<RelationRow>(
      userId,
      `select u.id, u.pseudo, b.created_at
         from public.user_blocks b
         join public.users u on u.id = b.blocked_id
        where b.blocker_id = $1
        order by b.created_at desc`,
      [userId],
    ),
    run<RelationRow>(
      userId,
      `select u.id, u.pseudo, m.created_at
         from public.user_mutes m
         join public.users u on u.id = m.muted_id
        where m.muter_id = $1
        order by m.created_at desc`,
      [userId],
    ),
    run<SanctionRow>(
      userId,
      `select s.id, s.user_id, u.pseudo as pseudo, s.kind, s.reason_code, s.note,
              s.status, s.starts_at, s.ends_at, s.issued_by, i.pseudo as issued_by_pseudo,
              s.lifted_at, s.created_at, 0::int as pending_appeals
         from public.user_sanctions s
         join public.users u on u.id = s.user_id
         left join public.users i on i.id = s.issued_by
        where s.user_id = $1
        order by s.created_at desc
        limit 50`,
      [userId],
    ),
    getSafetySettings(userId),
    run<MyAppeal>(
      userId,
      `select a.id, a.sanction_id, a.message, a.status, a.decision_note,
              a.created_at, a.reviewed_at,
              s.kind as sanction_kind, s.reason_code as sanction_reason
         from public.sanction_appeals a
         join public.user_sanctions s on s.id = a.sanction_id
        where a.user_id = $1
        order by a.created_at desc
        limit 50`,
      [userId],
    ),
  ]);
  return { blocks, mutes, sanctions, settings, appeals };
}

/** Préférences de protection du compte courant. */
export async function getSafetySettings(userId: string): Promise<SafetySettings> {
  const rows = await run<SafetySettings>(
    userId,
    `select user_id, who_can_message, who_can_comment, who_can_mention,
            filter_offensive, hide_sensitive_media, blocked_words, updated_at
       from public.user_safety_settings
      where user_id = $1`,
    [userId],
  );
  return rows[0] ?? {
    user_id: userId,
    who_can_message: "everyone",
    who_can_comment: "everyone",
    who_can_mention: "everyone",
    filter_offensive: true,
    hide_sensitive_media: false,
    blocked_words: [],
    updated_at: new Date(0).toISOString(),
  };
}

/** Met à jour les préférences par RPC : la base valide les valeurs. */
export async function setSafetySettings(
  userId: string,
  input: {
    whoCanMessage?: SafetySettings["who_can_message"];
    whoCanComment?: SafetySettings["who_can_comment"];
    whoCanMention?: SafetySettings["who_can_mention"];
    filterOffensive?: boolean;
    hideSensitiveMedia?: boolean;
    blockedWords?: string[];
  },
): Promise<SafetySettings> {
  const rows = await run<{ settings: SafetySettings }>(
    userId,
    `select to_jsonb(public.set_safety_settings($1, $2, $3, $4, $5, $6::text[])) as settings`,
    [
      input.whoCanMessage ?? null,
      input.whoCanComment ?? null,
      input.whoCanMention ?? null,
      input.filterOffensive ?? null,
      input.hideSensitiveMedia ?? null,
      input.blockedWords ?? null,
    ],
  );
  const settings = rows[0]?.settings;
  if (!settings) throw new TrustSafetyError("préférences non enregistrées", 503);
  return settings;
}

export const mySafetySettings = getSafetySettings;

export async function blockUser(userId: string, targetId: string): Promise<void> {
  await run(userId, "select public.block_user($1::uuid)", [targetId]);
}

export async function unblockUser(userId: string, targetId: string): Promise<void> {
  await run(userId, "select public.unblock_user($1::uuid)", [targetId]);
}

export async function muteUser(userId: string, targetId: string): Promise<void> {
  await run(userId, "select public.mute_user($1::uuid)", [targetId]);
}

export async function unmuteUser(userId: string, targetId: string): Promise<void> {
  await run(userId, "select public.unmute_user($1::uuid)", [targetId]);
}

export async function submitAppeal(
  userId: string,
  sanctionId: string,
  message: string,
): Promise<string> {
  const rows = await run<{ submit_appeal: string }>(
    userId,
    "select public.submit_appeal($1::uuid, $2) as submit_appeal",
    [sanctionId, message],
  );
  return rows[0].submit_appeal;
}

/** Sanctions, avec le pseudo et le nombre de recours en attente. */
export async function listSanctions(
  userId: string,
  status: "active" | "lifted" | "all" = "active",
): Promise<SanctionRow[]> {
  return run<SanctionRow>(
    userId,
    `select s.id, s.user_id, u.pseudo, s.kind, s.reason_code, s.note,
            s.status, s.starts_at, s.ends_at, s.issued_by,
            i.pseudo as issued_by_pseudo, s.lifted_at, s.created_at,
            (select count(*)::int from public.sanction_appeals a
              where a.sanction_id = s.id and a.status = 'pending') as pending_appeals
       from public.user_sanctions s
       join public.users u on u.id = s.user_id
       left join public.users i on i.id = s.issued_by
      where ($1 = 'all' or s.status = $1)
      order by s.created_at desc
      limit 200`,
    [status],
  );
}

export async function issueSanction(input: {
  actorId: string;
  userId: string;
  kind: SanctionKind;
  reasonCode: string;
  note?: string;
  days?: number | null;
  sourceFlag?: string | null;
  capabilities?: string[];
}): Promise<string> {
  const rows = await run<{ issue_sanction: string }>(
    input.actorId,
    "select public.issue_sanction($1::uuid, $2, $3, $4, $5, $6::uuid, $7::text[]) as issue_sanction",
    [
      input.userId,
      input.kind,
      input.reasonCode,
      input.note ?? "",
      input.days ?? null,
      input.sourceFlag ?? null,
      input.capabilities ?? [],
    ],
  );
  return rows[0].issue_sanction;
}

export async function liftSanction(
  actorId: string,
  sanctionId: string,
  note = "",
): Promise<void> {
  await run(actorId, "select public.lift_sanction($1::uuid, $2)", [sanctionId, note]);
}

export async function listAppeals(
  userId: string,
  status: "pending" | "upheld" | "overturned" | "all" = "pending",
): Promise<AppealRow[]> {
  return run<AppealRow>(
    userId,
    `select a.id, a.sanction_id, a.user_id, u.pseudo, a.message, a.status,
            a.reviewed_by, a.reviewed_at, a.decision_note, a.created_at,
            s.kind as sanction_kind, s.reason_code as sanction_reason
       from public.sanction_appeals a
       join public.users u on u.id = a.user_id
       join public.user_sanctions s on s.id = a.sanction_id
      where ($1 = 'all' or a.status = $1)
      order by a.created_at asc
      limit 200`,
    [status],
  );
}

export async function reviewAppeal(
  actorId: string,
  appealId: string,
  decision: "upheld" | "overturned",
  note = "",
): Promise<void> {
  await run(actorId, "select public.review_appeal($1::uuid, $2, $3)", [
    appealId,
    decision,
    note,
  ]);
}

export async function setModerationRole(
  actorId: string,
  userId: string,
  role: ModerationRole,
): Promise<void> {
  await run(actorId, "select public.set_moderation_role($1::uuid, $2)", [userId, role]);
}
