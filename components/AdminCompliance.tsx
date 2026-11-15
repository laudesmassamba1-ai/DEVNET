"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Conformité — `/admin/compliance`.
 *
 * Le module était marqué « indisponible » : un utilisateur qui demandait
 * ses données n'avait aucun chemin, et l'administration aucun moyen de
 * tracer la réponse. La file existe maintenant, et elle est honnête sur
 * ce qu'elle fait : elle enregistre et suit une demande, elle ne
 * déclenche pas l'export ni la suppression à votre place.
 *
 * Le libellé le dit explicitement, parce qu'un bouton « Traiter » qui ne
 * traite rien serait pire que pas de bouton.
 */

type ComplianceRequest = {
  id: string;
  kind: "export" | "deletion";
  note: string;
  status: "pending" | "in_progress" | "done" | "refused";
  resolution: string | null;
  created_at: string;
  resolved_at: string | null;
  user_id: string;
  user_pseudo: string | null;
  handled_by_pseudo: string | null;
};

const KIND_LABEL: Record<ComplianceRequest["kind"], string> = {
  export: "Export des données",
  deletion: "Suppression du compte",
};

const STATUS_LABEL: Record<ComplianceRequest["status"], string> = {
  pending: "En attente",
  in_progress: "En cours",
  done: "Traitée",
  refused: "Refusée",
};

export function AdminCompliance() {
  const [rows, setRows] = useState<ComplianceRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/compliance", { cache: "no-store" });
      const payload = (await res.json()) as { requests?: ComplianceRequest[]; error?: string };
      if (!res.ok || !payload.requests) {
        setError(payload.error ?? "Lecture impossible.");
        setRows([]);
        return;
      }
      setRows(payload.requests);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Réseau indisponible.");
      setRows([]);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      await load();
      if (!alive) return;
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  const setStatus = async (id: string, status: ComplianceRequest["status"]) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/compliance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(payload.error ?? "Mise à jour refusée.");
        return;
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Réseau indisponible.");
    } finally {
      setBusy(false);
    }
  };

  const pending = (rows ?? []).filter(
    (row) => row.status === "pending" || row.status === "in_progress",
  ).length;

  return (
    <div className="divide-y divide-line-2">
      <section className="px-(--gutter) py-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-display-m font-semibold">Demandes reçues</h2>
          {rows !== null && (
            <p className="font-mono text-12 text-chalk-4 tnum">
              {pending} à traiter · {rows.length} au total
            </p>
          )}
        </div>

        <p className="mt-2 max-w-prose text-13 leading-relaxed text-chalk-3">
          Cette file enregistre et suit les demandes. Elle ne déclenche pas
          l’export ni la suppression : ces gestes se font par{" "}
          <code className="text-chalk-2">pg_dump</code> et par la procédure de
          suppression de compte. Le statut dit où en est la demande, pas ce
          que la plateforme a fait toute seule.
        </p>

        {error && (
          <p role="alert" className="mt-3 text-12 text-danger">
            {error}
          </p>
        )}

        {rows === null ? (
          <p className="mt-3 text-13 text-chalk-4">Chargement…</p>
        ) : rows.length === 0 ? (
          <p className="mt-3 max-w-prose text-13 leading-relaxed text-chalk-3">
            Aucune demande. Les comptes n’ont pas encore exercé leur droit —
            ou ne savent pas qu’ils peuvent le faire, ce qui est un autre
            problème.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line-2">
            {rows.map((row) => (
              <li key={row.id} className="py-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-12 text-chalk-4">
                    {KIND_LABEL[row.kind]} · {STATUS_LABEL[row.status]}
                  </span>
                  <span className="text-12 text-chalk-4">
                    {new Date(row.created_at).toLocaleString("fr-FR")}
                  </span>
                </div>
                <p className="mt-1 text-13 text-chalk-2">
                  {row.user_pseudo ?? row.user_id}
                </p>
                {row.note && (
                  <p className="mt-1 max-w-prose text-13 leading-relaxed text-chalk-3">
                    « {row.note} »
                  </p>
                )}
                {row.resolution && (
                  <p className="mt-1 text-12 text-chalk-4">Résolution : {row.resolution}</p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {row.status === "pending" && (
                    <button
                      type="button"
                      onClick={() => void setStatus(row.id, "in_progress")}
                      disabled={busy}
                      className="mo-press min-h-(--h-tap) rounded-(--radius-chip)
                        border border-line-3 px-3 text-12 text-chalk-3"
                    >
                      Prendre en charge
                    </button>
                  )}
                  {row.status !== "done" && row.status !== "refused" && (
                    <>
                      <button
                        type="button"
                        onClick={() => void setStatus(row.id, "done")}
                        disabled={busy}
                        className="mo-press min-h-(--h-tap) rounded-(--radius-chip)
                          border border-signal px-3 text-12 text-signal"
                      >
                        Marquer traitée
                      </button>
                      <button
                        type="button"
                        onClick={() => void setStatus(row.id, "refused")}
                        disabled={busy}
                        className="mo-press min-h-(--h-tap) rounded-(--radius-chip)
                          border border-line-3 px-3 text-12 text-chalk-3"
                      >
                        Refuser
                      </button>
                    </>
                  )}
                  {row.resolved_at && (
                    <span className="text-12 text-chalk-4">
                      clôturée le {new Date(row.resolved_at).toLocaleString("fr-FR")}
                      {row.handled_by_pseudo ? ` par ${row.handled_by_pseudo}` : ""}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
