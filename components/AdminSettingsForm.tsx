"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/Icon";

/**
 * Réglages d'exploitation — `/admin/settings`.
 *
 * Ce module affichait auparavant le barème XP de « Progression » : la page
 * « Paramètres » ne contenait aucun paramètre. Elle en contient maintenant
 * trois, et chacun a un effet réel :
 *
 *  - `maintenance` ferme l'application aux comptes non administrateurs ;
 *  - `maintenance_message` est le texte qu'ils lisent pendant la fermeture ;
 *  - `signups_enabled` ferme les inscriptions sans fermer la lecture.
 *
 * Trois principes, pour que l'écran ne mente pas :
 *
 *  - **Rien n'est enregistré tant qu'on n'a pas cliqué.** Les champs sont
 *    locaux ; « Enregistrer » est le seul chemin vers la base, et il est
 *    désactivé quand rien n'a changé.
 *  - **Le serveur fait foi.** Après écriture, l'écran reprend la réponse de
 *    l'API, jamais la valeur supposée. Si la base refuse, on affiche son
 *    message et l'état revient à ce qu'il était.
 *  - **La fermeture est annoncée comme telle.** Activer le mode
 *    maintenance coupe l'accès à tous les autres comptes : le libellé le
 *    dit, au lieu de laisser croire à un simple interrupteur.
 */

type Settings = {
  maintenance: boolean;
  maintenance_message: string;
  signups_enabled: boolean;
};

const MESSAGE_MAX = 280;

export function AdminSettingsForm() {
  const [saved, setSaved] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/settings", { cache: "no-store" });
      const body = (await res.json()) as {
        settings?: Settings;
        updatedAt?: string | null;
        error?: string;
      };
      if (!res.ok || !body.settings) {
        setError(body.error ?? "Lecture des réglages impossible.");
        setSaved(null);
        setDraft(null);
        return;
      }
      setSaved(body.settings);
      setDraft(body.settings);
      setUpdatedAt(body.updatedAt ?? null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Réseau indisponible.");
      setSaved(null);
      setDraft(null);
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

  const dirty =
    saved !== null &&
    draft !== null &&
    (saved.maintenance !== draft.maintenance ||
      saved.maintenance_message !== draft.maintenance_message ||
      saved.signups_enabled !== draft.signups_enabled);

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setDone(false);
    setError(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = (await res.json()) as { settings?: Settings; error?: string };
      if (!res.ok || !body.settings) {
        setError(body.error ?? "Enregistrement refusé.");
        return;
      }
      // Le serveur fait foi : on reprend sa réponse telle quelle.
      setSaved(body.settings);
      setDraft(body.settings);
      setUpdatedAt(new Date().toISOString());
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Réseau indisponible.");
    } finally {
      setBusy(false);
    }
  };

  if (error && !draft) {
    return (
      <section className="px-(--gutter) py-5">
        <p role="alert" className="max-w-prose text-13 text-danger">
          {error}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="mo-press mt-3 min-h-(--h-tap) rounded-(--radius-chip)
            border border-line-3 px-4 text-13 text-chalk-2"
        >
          Réessayer
        </button>
      </section>
    );
  }

  if (!draft) {
    return (
      <section className="px-(--gutter) py-5">
        <p className="text-13 text-chalk-4">Chargement des réglages…</p>
      </section>
    );
  }

  return (
    <div className="divide-y divide-line-2">
      <section className="px-(--gutter) py-5" aria-labelledby="admin-maint-title">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center border border-line-2 text-signal">
            <Icon name="lock" size={18} />
          </span>
          <div>
            <h2 id="admin-maint-title" className="font-display text-display-m font-semibold">
              Mode maintenance
            </h2>
            <p className="mt-1 max-w-prose text-13 leading-relaxed text-chalk-3">
              Ferme l’application à tous les comptes sauf les administrateurs.
              Les données ne sont pas touchées : la lecture reprend telle quelle
              à la réouverture.
            </p>
          </div>
        </div>

        <label className="mt-4 flex min-h-(--h-tap) items-center gap-3">
          <input
            type="checkbox"
            checked={draft.maintenance}
            onChange={(event) =>
              setDraft({ ...draft, maintenance: event.target.checked })
            }
            className="size-4 accent-signal"
          />
          <span className="text-13 text-chalk-2">
            Fermer l’application aux comptes non administrateurs
          </span>
        </label>

        <label className="mt-4 block">
          <span className="font-mono text-12 text-chalk-4">
            Message affiché pendant la fermeture
          </span>
          <textarea
            value={draft.maintenance_message}
            onChange={(event) =>
              setDraft({ ...draft, maintenance_message: event.target.value })
            }
            maxLength={MESSAGE_MAX}
            rows={3}
            className="mt-1.5 w-full rounded-(--radius-input) border border-line-3
              bg-surface-2 px-3 py-2 text-13 text-chalk-2"
          />
          <span className="mt-1 block font-mono text-12 text-chalk-4 tnum">
            {draft.maintenance_message.length} / {MESSAGE_MAX}
          </span>
        </label>
      </section>

      <section className="px-(--gutter) py-5" aria-labelledby="admin-signup-title">
        <h2 id="admin-signup-title" className="font-display text-display-m font-semibold">
          Inscriptions
        </h2>
        <p className="mt-1 max-w-prose text-13 leading-relaxed text-chalk-3">
          Fermer les inscriptions ne ferme pas la lecture : les comptes
          existants continuent de se connecter et de consulter le réseau.
        </p>
        <label className="mt-4 flex min-h-(--h-tap) items-center gap-3">
          <input
            type="checkbox"
            checked={draft.signups_enabled}
            onChange={(event) =>
              setDraft({ ...draft, signups_enabled: event.target.checked })
            }
            className="size-4 accent-signal"
          />
          <span className="text-13 text-chalk-2">
            Autoriser la création de nouveaux comptes
          </span>
        </label>
      </section>

      <section className="px-(--gutter) py-5">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || busy}
            className="mo-press min-h-(--h-tap) rounded-(--radius-chip) border
              border-signal px-4 text-13 font-medium text-signal
              disabled:border-line-3 disabled:text-chalk-4"
          >
            {busy ? "Enregistrement…" : "Enregistrer"}
          </button>
          {dirty && (
            <button
              type="button"
              onClick={() => setDraft(saved)}
              className="mo-press min-h-(--h-tap) rounded-(--radius-chip)
                border border-line-3 px-4 text-13 text-chalk-3"
            >
              Annuler
            </button>
          )}
          <p role="status" aria-live="polite" className="text-12 text-chalk-4">
            {error
              ? error
              : done
                ? "Enregistré. L’effet est immédiat."
                : dirty
                  ? "Modifications non enregistrées."
                  : updatedAt
                    ? `À jour · ${new Date(updatedAt).toLocaleString("fr-FR")}`
                    : "À jour."}
          </p>
        </div>
        <p className="mt-3 max-w-prose text-12 leading-relaxed text-chalk-4">
          Chaque enregistrement est journalisé dans{" "}
          <Link href="/admin/audit" className="text-signal underline-offset-2 hover:underline">
            le journal d’audit
          </Link>
          , avec l’identité du compte qui l’a fait et les valeurs avant et après.
        </p>
      </section>
    </div>
  );
}
