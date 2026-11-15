/**
 * Écriture et vérification du journal d'audit.
 *
 * Une seule fonction écrit, et elle écrit **avec l'identité réelle de
 * l'acteur** : les routes d'administration ne doivent pas pouvoir signer une
 * décision au nom d'un autre compte. La chaîne de hachage (migration 073) est
 * calculée par un trigger : si l'application oubliait un champ, la base
 * refuserait toujours de produire une ligne non chaînée.
 *
 * La vérification est déléguée à `verify_admin_audit_chain()` plutôt que
 * recalculée ici : deux implémentations du même hachage finiraient par
 * diverger, et c'est exactement ce qu'un journal d'audit ne peut pas se
 * permettre.
 */
import { getPostgresPool } from "@/platform/infrastructure/postgres/pool";
import { withUser } from "@/platform/infrastructure/postgres/with-user";

export type AuditEntry = {
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  details?: Record<string, unknown>;
};

/**
 * Ajoute une entrée au journal.
 *
 * Ne lève jamais : une action d'administration réussie ne doit pas être
 * annulée parce que le journal a échoué. L'échec est signalé à l'appelant
 * pour qu'il l'affiche, mais il ne masque pas le résultat de l'action.
 */
export async function writeAudit(
  entry: AuditEntry,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    /*
     * Écriture par le pool propriétaire, pas par `withUser`.
     *
     * La migration 059 a **révoqué** INSERT sur `admin_audit_log` au rôle
     * `authenticated` : c'est voulu, un client ne doit pas pouvoir forger
     * une ligne d'audit. L'appelant a déjà vérifié `is_admin` et fournit
     * l'identité réelle de l'acteur ; le contrôle d'accès est ici « le
     * serveur est le seul écrivain », pas « la RLS autorise ».
     */
    await getPostgresPool().query(
      `insert into public.admin_audit_log
         (actor_id, action, target_type, target_id, details)
       values ($1, $2, $3, $4, $5::jsonb)`,
      [
        entry.actorId,
        entry.action.slice(0, 80),
        entry.targetType.slice(0, 40),
        entry.targetId.slice(0, 120),
        JSON.stringify(entry.details ?? {}),
      ],
    );
    return { ok: true };
  } catch (error) {
    console.error(
      "[audit] écriture impossible",
      error instanceof Error ? error.message : String(error),
    );
    return { ok: false, error: "action effectuée, mais le journal n'a pas pu être écrit" };
  }
}

export type AuditChainReport =
  | { ok: true; checked: number }
  | { ok: false; checked: number; brokenAt: string | null; detail: string | null }
  | { ok: false; checked: 0; brokenAt: null; detail: string };

/**
 * Vérifie l'intégrité de la chaîne.
 *
 * `ok: false` avec `checked: 0` signifie « je n'ai pas pu vérifier » — ce
 * n'est pas la même chose qu'une chaîne rompue, et l'écran doit le dire.
 */
export async function verifyAuditChain(actorId: string): Promise<AuditChainReport> {
  try {
    const parsed = await withUser(actorId, (query) =>
      query<{ report: { ok: boolean; checked: number; brokenAt: string | null; detail: string | null } }>(
        "select public.verify_admin_audit_chain() as report",
      ),
    );
    const report = parsed[0]?.report;
    if (!report) {
      return { ok: false, checked: 0, brokenAt: null, detail: "réponse vide du vérificateur" };
    }
    if (report.ok) return { ok: true, checked: Number(report.checked ?? 0) };
    return {
      ok: false,
      checked: Number(report.checked ?? 0),
      brokenAt: report.brokenAt ?? null,
      detail: report.detail ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      checked: 0,
      brokenAt: null,
      detail:
        error instanceof Error && /does not exist|n'existe pas/i.test(error.message)
          ? "le vérificateur n'est pas installé (migration 073 non appliquée)"
          : "vérification impossible : la base ne répond pas",
    };
  }
}
