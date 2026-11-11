import { supabase } from "@/lib/supabase/client";
import { AUTHOR_COLUMNS } from "@/lib/social";
import type { Report, ReportStatus } from "@/lib/types";
import {
  OPEN_REPORT_CAP,
  REPORT_PAGE_SIZE,
  type ReportInsert,
  type ReportRepository,
  type ReportRow,
  type ReportScope,
} from "../../ports/report-repository";

/**
 * Adaptateur Supabase du port de modération.
 *
 * Il porte la **forme** des requêtes, pas les règles : la RLS décide qui voit
 * quoi et qui peut classer. Une vérification ici serait une seconde règle,
 * donc un second endroit où se tromper — et un endroit qu'un autre client
 * contournerait.
 *
 * Il fonctionne aussi en mode démonstration : le client maison branche alors
 * `lib/demo/`, qui implémente les mêmes méthodes et les mêmes erreurs.
 */
export class SupabaseReportRepository implements ReportRepository {
  async insert({ reporterId, reason, details, target }: ReportInsert): Promise<{
    error: string | null;
  }> {
    const row: Record<string, unknown> = {
      reporter_id: reporterId,
      reason,
      details,
    };

    // La ligne ne porte qu'une clé étrangère, les trois autres restent
    // `null` : c'est ce que la contrainte « exactement une cible » attend.
    switch (target.type) {
      case "post":
        row.post_id = target.id;
        break;
      case "comment":
        row.comment_id = target.id;
        break;
      case "group_message":
        row.message_id = target.id;
        break;
      case "user":
        row.reported_user = target.id;
        break;
    }

    const { error } = await supabase.from("reports").insert(row);
    return { error: error ? error.message : null };
  }

  async list(readerId: string, scope: ReportScope): Promise<ReportRow[]> {
    let query = supabase
      .from("reports")
      // `reports` vise `users` par deux chemins (`reporter_id`,
      // `reported_user`) : la contrainte portée ici est celle de l'auteur
      // du signalement.
      .select(`*, reporter:users!reports_reporter_id_fkey(${AUTHOR_COLUMNS})`)
      .order("created_at", { ascending: false })
      .limit(REPORT_PAGE_SIZE);

    if (scope === "mine") query = query.eq("reporter_id", readerId);
    else query = query.neq("reporter_id", readerId);

    const { data } = await query;
    const rows = ((data ?? []) as (Report & { reporter: unknown })[]).filter(Boolean);

    return rows.map((r) => ({
      ...r,
      reporter: (r.reporter ?? null) as ReportRow["reporter"],
    }));
  }

  async classify(
    id: string,
    status: Exclude<ReportStatus, "open">,
  ): Promise<{ error: string | null; updated: boolean }> {
    const { data, error } = await supabase
      .from("reports")
      .update({ status })
      .eq("id", id)
      .select("id, status, resolved_at")
      .maybeSingle();

    return { error: error ? error.message : null, updated: Boolean(data) };
  }

  async countOpen(readerId: string): Promise<number> {
    const { data } = await supabase
      .from("reports")
      .select("id")
      .eq("status", "open")
      .neq("reporter_id", readerId)
      .limit(OPEN_REPORT_CAP);

    return (data ?? []).length;
  }
}
