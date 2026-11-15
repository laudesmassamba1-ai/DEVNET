"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Annonces — `/admin/communications`.
 *
 * Le module annonçait « à instrumenter » : il n'y avait aucun moyen de
 * dire quelque chose à l'ensemble des comptes. Il y en a un maintenant.
 *
 * Rien ne se supprime ici. Retirer une annonce la dépublie et laisse la
 * date de retrait : un message qui a été lu ne s'efface pas parce qu'il
 * n'est plus d'actualité. L'historique reste lisible, avec ce qui était
 * publié et quand.
 */

type Announcement = {
  id: string;
  title: string;
  body: string;
  level: "info" | "warning" | "critical";
  published: boolean;
  created_at: string;
  retracted_at: string | null;
  created_by_pseudo: string | null;
};

const LEVEL_LABEL: Record<Announcement["level"], string> = {
  info: "Information",
  warning: "Avertissement",
  critical: "Critique",
};

export function AdminAnnouncements() {
  const [rows, setRows] = useState<Announcement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [level, setLevel] = useState<Announcement["level"]>("info");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/announcements", { cache: "no-store" });
      const payload = (await res.json()) as { announcements?: Announcement[]; error?: string };
      if (!res.ok || !payload.announcements) {
        setError(payload.error ?? "Lecture impossible.");
        setRows([]);
        return;
      }
      setRows(payload.announcements);
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

  const publish = async () => {
    if (title.trim().length < 3 || body.trim().length < 1) {
      setError("Un titre de 3 caractères et un message sont nécessaires.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body, level }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(payload.error ?? "Publication refusée.");
        return;
      }
      setTitle("");
      setBody("");
      setLevel("info");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Réseau indisponible.");
    } finally {
      setBusy(false);
    }
  };

  const retract = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/announcements", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(payload.error ?? "Retrait refusé.");
        return;
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Réseau indisponible.");
    } finally {
      setBusy(false);
    }
  };

  const live = (rows ?? []).filter((row) => row.published && !row.retracted_at).length;

  return (
    <div className="divide-y divide-line-2">
      <section className="px-(--gutter) py-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-display-m font-semibold">Publier une annonce</h2>
          {rows !== null && (
            <p className="font-mono text-12 text-chalk-4 tnum">
              {live} en ligne · {rows.length} au total
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
              placeholder="Maintenance planifiée samedi"
              className="mt-1.5 w-full rounded-(--radius-input) border border-line-3
                bg-surface-2 px-3 py-2 text-13 text-chalk-2"
            />
          </label>

          <label className="block">
            <span className="font-mono text-12 text-chalk-4">Message</span>
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="Ce qui change, quand, et ce que les comptes doivent faire."
              className="mt-1.5 w-full rounded-(--radius-input) border border-line-3
                bg-surface-2 px-3 py-2 text-13 text-chalk-2"
            />
            <span className="mt-1 block font-mono text-12 text-chalk-4 tnum">
              {body.length} / 2000
            </span>
          </label>

          <fieldset>
            <legend className="font-mono text-12 text-chalk-4">Niveau</legend>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {(["info", "warning", "critical"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setLevel(value)}
                  aria-pressed={level === value}
                  className={`mo-press min-h-(--h-tap) rounded-(--radius-chip) border px-3 text-13
                    ${level === value
                      ? "border-signal text-signal"
                      : "border-line-3 text-chalk-3"}`}
                >
                  {LEVEL_LABEL[value]}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void publish()}
              disabled={busy}
              className="mo-press min-h-(--h-tap) rounded-(--radius-chip) border
                border-signal px-4 text-13 font-medium text-signal
                disabled:border-line-3 disabled:text-chalk-4"
            >
              {busy ? "Publication…" : "Publier"}
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
        <h2 className="font-display text-display-m font-semibold">Historique</h2>

        {rows === null ? (
          <p className="mt-3 text-13 text-chalk-4">Chargement…</p>
        ) : rows.length === 0 ? (
          <p className="mt-3 max-w-prose text-13 leading-relaxed text-chalk-3">
            Aucune annonce publiée. Les comptes n’ont donc rien reçu de
            l’administration à ce jour.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line-2">
            {rows.map((row) => {
              const isLive = row.published && !row.retracted_at;
              return (
                <li key={row.id} className="py-3">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-mono text-12 text-chalk-4">
                      {LEVEL_LABEL[row.level]} · {isLive ? "en ligne" : "retirée"}
                    </span>
                    <span className="text-12 text-chalk-4">
                      {new Date(row.created_at).toLocaleString("fr-FR")}
                    </span>
                    {row.created_by_pseudo && (
                      <span className="text-12 text-chalk-4">par {row.created_by_pseudo}</span>
                    )}
                  </div>
                  <p className="mt-1 font-display text-base font-semibold">{row.title}</p>
                  <p className="mt-1 max-w-prose text-13 leading-relaxed text-chalk-3">
                    {row.body}
                  </p>
                  {isLive ? (
                    <button
                      type="button"
                      onClick={() => void retract(row.id)}
                      disabled={busy}
                      className="mo-press mt-2 min-h-(--h-tap) rounded-(--radius-chip)
                        border border-line-3 px-3 text-12 text-chalk-3"
                    >
                      Retirer
                    </button>
                  ) : (
                    row.retracted_at && (
                      <p className="mt-2 text-12 text-chalk-4">
                        retirée le {new Date(row.retracted_at).toLocaleString("fr-FR")}
                      </p>
                    )
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
