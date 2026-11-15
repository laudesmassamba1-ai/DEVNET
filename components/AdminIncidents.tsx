"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/Icon";

/**
 * Registre d'incidents — `/admin/incidents`.
 *
 * Le module existait dans la navigation et annonçait « à instrumenter ».
 * Il lit maintenant un vrai registre et permet de l'alimenter : ouvrir un
 * incident, le passer en surveillance, le clore avec sa résolution.
 *
 * Le formulaire est volontairement court. Un incident se déclare pendant
 * qu'il se produit : trois champs, pas de mise en scène. La gravité est
 * un choix explicite, et le libellé dit ce qu'elle implique.
 */

type Incident = {
  id: string;
  title: string;
  body: string;
  severity: "minor" | "major" | "critical";
  status: "open" | "monitoring" | "resolved";
  created_at: string;
  resolved_at: string | null;
  opened_by_pseudo: string | null;
};

const SEVERITY_LABEL: Record<Incident["severity"], string> = {
  minor: "Mineur",
  major: "Majeur",
  critical: "Critique",
};

const STATUS_LABEL: Record<Incident["status"], string> = {
  open: "Ouvert",
  monitoring: "Sous surveillance",
  resolved: "Clos",
};

export function AdminIncidents() {
  const [rows, setRows] = useState<Incident[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [severity, setSeverity] = useState<Incident["severity"]>("minor");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/incidents", { cache: "no-store" });
      const payload = (await res.json()) as { incidents?: Incident[]; error?: string };
      if (!res.ok || !payload.incidents) {
        setError(payload.error ?? "Lecture impossible.");
        setRows([]);
        return;
      }
      setRows(payload.incidents);
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

  const open = async () => {
    if (title.trim().length < 3) {
      setError("Le titre doit faire au moins 3 caractères.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body, severity }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(payload.error ?? "Ouverture refusée.");
        return;
      }
      setTitle("");
      setBody("");
      setSeverity("minor");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Réseau indisponible.");
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (id: string, status: Incident["status"]) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/incidents", {
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

  const openCount = (rows ?? []).filter((row) => row.status !== "resolved").length;

  return (
    <div className="divide-y divide-line-2">
      <section className="px-(--gutter) py-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-display-m font-semibold">Déclarer un incident</h2>
          {rows !== null && (
            <p className="font-mono text-12 text-chalk-4 tnum">
              {openCount} en cours · {rows.length} au total
            </p>
          )}
        </div>

        <div className="mt-4 grid gap-3">
          <label className="block">
            <span className="font-mono text-12 text-chalk-4">Titre</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={140}
              placeholder="Base lente sur les écritures"
              className="mt-1.5 w-full rounded-(--radius-input) border border-line-3
                bg-surface-2 px-3 py-2 text-13 text-chalk-2"
            />
          </label>

          <label className="block">
            <span className="font-mono text-12 text-chalk-4">Détail (facultatif)</span>
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={2000}
              rows={2}
              placeholder="Ce qui est observé, depuis quand, ce qui est fait."
              className="mt-1.5 w-full rounded-(--radius-input) border border-line-3
                bg-surface-2 px-3 py-2 text-13 text-chalk-2"
            />
          </label>

          <fieldset>
            <legend className="font-mono text-12 text-chalk-4">Gravité</legend>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {(["minor", "major", "critical"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSeverity(value)}
                  aria-pressed={severity === value}
                  className={`mo-press min-h-(--h-tap) rounded-(--radius-chip) border px-3 text-13
                    ${severity === value
                      ? "border-signal text-signal"
                      : "border-line-3 text-chalk-3"}`}
                >
                  {SEVERITY_LABEL[value]}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void open()}
              disabled={busy}
              className="mo-press min-h-(--h-tap) rounded-(--radius-chip) border
                border-signal px-4 text-13 font-medium text-signal
                disabled:border-line-3 disabled:text-chalk-4"
            >
              {busy ? "Enregistrement…" : "Ouvrir l’incident"}
            </button>
            {error && (
              <p role="alert" className="text-12 text-danger">
                {error}
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="px-(--gutter) py-5">
        <h2 className="font-display text-display-m font-semibold">Registre</h2>

        {rows === null ? (
          <p className="mt-3 text-13 text-chalk-4">Chargement…</p>
        ) : rows.length === 0 ? (
          <p className="mt-3 max-w-prose text-13 leading-relaxed text-chalk-3">
            Aucun incident enregistré. C’est une bonne nouvelle, et ce n’est
            pas une preuve : le registre ne contient que ce qu’on y met.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line-2">
            {rows.map((row) => (
              <li key={row.id} className="py-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-12 text-chalk-4">
                    {SEVERITY_LABEL[row.severity]} · {STATUS_LABEL[row.status]}
                  </span>
                  <span className="text-12 text-chalk-4">
                    {new Date(row.created_at).toLocaleString("fr-FR")}
                  </span>
                </div>
                <p className="mt-1 font-display text-base font-semibold">{row.title}</p>
                {row.body && (
                  <p className="mt-1 max-w-prose text-13 leading-relaxed text-chalk-3">
                    {row.body}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {row.status !== "monitoring" && row.status !== "resolved" && (
                    <button
                      type="button"
                      onClick={() => void setStatus(row.id, "monitoring")}
                      disabled={busy}
                      className="mo-press min-h-(--h-tap) rounded-(--radius-chip)
                        border border-line-3 px-3 text-12 text-chalk-3"
                    >
                      Sous surveillance
                    </button>
                  )}
                  {row.status !== "resolved" && (
                    <button
                      type="button"
                      onClick={() => void setStatus(row.id, "resolved")}
                      disabled={busy}
                      className="mo-press min-h-(--h-tap) rounded-(--radius-chip)
                        border border-line-3 px-3 text-12 text-chalk-3"
                    >
                      Clore
                    </button>
                  )}
                  {row.status === "resolved" && row.resolved_at && (
                    <span className="inline-flex items-center gap-1 text-12 text-chalk-4">
                      <Icon name="check" size={12} />
                      clos le {new Date(row.resolved_at).toLocaleString("fr-FR")}
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
