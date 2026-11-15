"use client";

import { useCallback, useEffect, useState } from "react";
import { Loading } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { useToast } from "@/components/Toast";

/**
 * Modération — la file de relecture.
 *
 * Le filtre de texte et l'empreinte d'image proposent ; cet écran décide.
 * Trois raisons de séparer les deux :
 *
 *  1. un faux positif sur une photo de profil est une sanction injuste ;
 *  2. une règle affichée est une règle contournée — l'écran ne montre jamais
 *     le contenu signalé, seulement la catégorie et le motif ;
 *  3. une décision doit être attribuable : chaque bouton écrit dans le
 *     journal d'audit.
 */

type Severity = "info" | "warning" | "critical";

type Flag = {
  id: string;
  target_type: string;
  target_id: string;
  source: string;
  severity: Severity;
  reason: string;
  details: Record<string, unknown>;
  status: string;
  created_at: string;
};

type BlockedMedia = {
  id: string;
  phash: string;
  reason: string;
  created_at: string;
};

type Term = {
  id: string;
  term: string;
  category: string;
  severity: Severity;
  active: boolean;
  created_at: string;
};

type BlockedDomain = {
  domain: string;
  category: string;
  reason: string;
  created_at: string;
};

type Payload = {
  flags: Flag[];
  blocked: BlockedMedia[];
  domains: BlockedDomain[];
  terms: Term[];
  counts: { open: number; critical: number; blocked: number; terms: number };
};

const TONE: Record<Severity, string> = {
  critical: "text-danger border-danger",
  warning: "text-signal border-signal",
  info: "text-chalk-3 border-line-3",
};

const CATEGORIES = [
  ["custom", "terme propre"],
  ["insult", "insulte"],
  ["hate", "haine"],
  ["sexual", "sexuel"],
  ["violence", "violence"],
  ["scam", "arnaque"],
  ["drugs", "drogue"],
  ["selfharm", "auto-mutilation"],
] as const;

async function readModeration(): Promise<Payload> {
  const response = await fetch("/api/admin/moderation", { cache: "no-store" });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `lecture impossible (${response.status})`);
  }
  return (await response.json()) as Payload;
}

export function AdminModeration() {
  const toast = useToast();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [term, setTerm] = useState("");
  const [category, setCategory] = useState<string>("custom");
  const [severity, setSeverity] = useState<Severity>("warning");

  const load = useCallback(async () => {
    try {
      setData(await readModeration());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "lecture impossible");
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const next = await readModeration().catch((cause: unknown) => {
        if (alive) setError(cause instanceof Error ? cause.message : "lecture impossible");
        return null;
      });
      if (alive && next) setData(next);
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function act(body: Record<string, unknown>, key: string, success: string) {
    if (busy) return;
    setBusy(key);
    try {
      const response = await fetch("/api/admin/moderation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "action impossible");
      await load();
      toast(success);
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "action impossible", "err");
    } finally {
      setBusy(null);
    }
  }

  if (!data && !error) return <Loading label="Lecture de la file de modération" />;

  return (
    <div className="divide-y divide-line-2">
      <section className="px-4 py-5" aria-labelledby="moderation-summary">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="moderation-summary" className="font-display text-display-m font-semibold">
            File de relecture
          </h2>
          <button
            type="button"
            onClick={() => void load()}
            disabled={busy !== null}
            className="min-h-11 rounded-md border border-line-3
              px-3 text-12 text-chalk-3 disabled:opacity-50"
          >
            Actualiser
          </button>
        </div>

        {error && (
          <p role="alert" className="mt-3 border-l-2 border-danger pl-3 text-13 text-danger">
            {error}
          </p>
        )}

        {data && (
          <dl className="mt-3 grid grid-cols-2 gap-3 border-y border-line-2 py-3 sm:grid-cols-4">
            {([
              ["Signaux ouverts", data.counts.open, data.counts.open > 0],
              ["Critiques", data.counts.critical, data.counts.critical > 0],
              ["Médias bloqués", data.counts.blocked, false],
              ["Termes actifs", data.counts.terms, false],
            ] as const).map(([label, value, danger]) => (
              <div key={label}>
                <dt className="text-12 text-chalk-4">{label}</dt>
                <dd
                  className={`mt-1 font-mono text-xl font-semibold tabular-nums ${danger ? "text-danger" : "text-chalk"}`}
                >
                  {value.toLocaleString("fr-FR")}
                </dd>
              </div>
            ))}
          </dl>
        )}

        <p className="mt-3 max-w-prose text-12 leading-relaxed text-chalk-4">
          Ces signaux ne suppriment rien. La suppression du contenu est un geste
          distinct, dans « Contenu ». Ici, on confirme qu&apos;un signal était
          justifié, ou on l&apos;écarte.
        </p>
      </section>

      {data && (
        <section className="px-4 py-5" aria-labelledby="moderation-flags">
          <h3 id="moderation-flags" className="font-display text-15 font-semibold">
            Signaux à relire
          </h3>
          {data.flags.length === 0 ? (
            <p className="mt-2 text-13 text-chalk-4">Aucun signal ouvert.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line-2 border-y border-line-2">
              {data.flags.map((flag) => (
                <li key={flag.id} className="py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-mono text-12 text-chalk-4">
                      {flag.target_type} · {flag.source}
                    </span>
                    <span
                      className={`border-l-2 pl-2 font-mono text-12 font-semibold uppercase tracking-wider ${TONE[flag.severity]}`}
                    >
                      {flag.severity}
                    </span>
                  </div>
                  <p className="mt-1 text-13 text-chalk-2">{flag.reason}</p>
                  {Array.isArray(flag.details?.terms) && flag.details.terms.length > 0 && (
                    <p className="mt-1 font-mono text-12 text-chalk-4">
                      termes : {(flag.details.terms as string[]).join(", ")}
                    </p>
                  )}
                  {typeof flag.details?.phash === "string" && flag.details.phash.length > 0 && (
                    <p className="mt-1 font-mono text-12 text-chalk-4">
                      empreinte : {flag.details.phash.slice(0, 16)}…
                    </p>
                  )}
                  <p className="mt-1 font-mono text-12 text-chalk-4">
                    {new Date(flag.created_at).toLocaleString("fr-FR")} · cible{" "}
                    {flag.target_id.slice(0, 12)}…
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() =>
                        void act(
                          { action: "resolve-flag", id: flag.id, decision: "confirmed" },
                          `confirm-${flag.id}`,
                          "Signal confirmé",
                        )
                      }
                      className="min-h-11 rounded-md border border-danger
                        bg-danger/8 px-3 font-mono text-12 font-bold uppercase tracking-widest
                        text-danger disabled:opacity-40"
                    >
                      confirmer
                    </button>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() =>
                        void act(
                          { action: "resolve-flag", id: flag.id, decision: "dismissed" },
                          `dismiss-${flag.id}`,
                          "Signal écarté",
                        )
                      }
                      className="min-h-11 rounded-md border border-line-3
                        px-3 font-mono text-12 text-chalk-3 disabled:opacity-40"
                    >
                      écarter
                    </button>
                    {typeof flag.details?.phash === "string" && flag.details.phash.length > 0 && (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() =>
                          void act(
                            {
                              action: "block-media",
                              phash: flag.details.phash,
                              reason: `signal ${flag.id}`,
                            },
                            `block-${flag.id}`,
                            "Image ajoutée à la liste bloquée",
                          )
                        }
                        className="min-h-11 rounded-md border border-line-3
                          px-3 font-mono text-12 text-chalk-2 disabled:opacity-40"
                      >
                        bloquer l&apos;image
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {data && (
        <section className="px-4 py-5" aria-labelledby="moderation-media">
          <h3 id="moderation-media" className="font-display text-15 font-semibold">
            Médias bloqués
          </h3>
          <p className="mt-1 max-w-prose text-13 leading-relaxed text-chalk-3">
            Une empreinte perceptuelle reconnaît une image recadrée ou réencodée.
            Le renvoi d&apos;un média banni est refusé avant stockage.
          </p>
          <form
            className="mt-3 flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const phash = String(form.get("phash") ?? "").trim();
              if (!phash) return;
              void act(
                { action: "block-media", phash, reason: String(form.get("reason") ?? "") },
                "block-manual",
                "Empreinte bannie",
              );
              event.currentTarget.reset();
            }}
          >
            <label className="min-w-40 flex-1">
              <span className="font-mono text-12 text-chalk-4">empreinte (16 hex)</span>
              <input
                name="phash"
                maxLength={16}
                placeholder="a1b2c3d4e5f60718"
                className="mt-1 min-h-11 w-full rounded-md border
                  border-line-3 bg-surface px-3 font-mono text-12 text-chalk"
              />
            </label>
            <label className="min-w-40 flex-1">
              <span className="font-mono text-12 text-chalk-4">motif</span>
              <input
                name="reason"
                maxLength={200}
                className="mt-1 min-h-11 w-full rounded-md border
                  border-line-3 bg-surface px-3 text-13 text-chalk"
              />
            </label>
            <button
              type="submit"
              disabled={busy !== null}
              className="min-h-11 rounded-md border border-line-3
                px-3 font-mono text-12 font-bold uppercase tracking-widest text-chalk-2
                disabled:opacity-40"
            >
              bannir
            </button>
          </form>

          {data.blocked.length === 0 ? (
            <p className="mt-3 text-13 text-chalk-4">Aucune empreinte bannie.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line-2 border-y border-line-2">
              {data.blocked.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="font-mono text-12 text-chalk-2">{item.phash}</p>
                    <p className="text-13 text-chalk-4">{item.reason || "sans motif"}</p>
                  </div>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                      void act(
                        { action: "unblock-media", phash: item.phash },
                        `unblock-${item.phash}`,
                        "Empreinte retirée",
                      )
                    }
                    className="min-h-11 rounded-md border border-line-3
                      px-3 font-mono text-12 text-chalk-3 disabled:opacity-40"
                  >
                    retirer
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {data && (
        <section className="px-4 py-5" aria-labelledby="moderation-domains">
          <h3 id="moderation-domains" className="font-display text-15 font-semibold">
            Domaines bloqués
          </h3>
          <p className="mt-1 max-w-prose text-13 leading-relaxed text-chalk-3">
            Le moteur de liens ne visite jamais une URL. Il compare le domaine à
            cette liste, tenue par des décisions humaines. Un domaine bloqué
            retient la publication ; un lien seulement suspect ouvre un dossier.
          </p>
          <form
            className="mt-3 flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const domain = String(form.get("domain") ?? "").trim();
              if (!domain) return;
              void act(
                {
                  action: "block-domain",
                  domain,
                  category: String(form.get("category") ?? "phishing"),
                  reason: String(form.get("reason") ?? ""),
                },
                "block-domain",
                "Domaine bloqué",
              );
              event.currentTarget.reset();
            }}
          >
            <label className="min-w-40 flex-1">
              <span className="font-mono text-12 text-chalk-4">domaine</span>
              <input
                name="domain"
                placeholder="exemple.test"
                className="mt-1 min-h-11 w-full rounded-md border border-line-3 bg-surface px-3 font-mono text-12 text-chalk"
              />
            </label>
            <label>
              <span className="font-mono text-12 text-chalk-4">catégorie</span>
              <select
                name="category"
                className="mt-1 min-h-11 rounded-md border border-line-3 bg-surface px-2 text-13 text-chalk"
              >
                <option value="phishing">hameçonnage</option>
                <option value="malware">malware</option>
                <option value="scam">arnaque</option>
                <option value="other">autre</option>
              </select>
            </label>
            <label className="min-w-40 flex-1">
              <span className="font-mono text-12 text-chalk-4">motif</span>
              <input
                name="reason"
                maxLength={200}
                className="mt-1 min-h-11 w-full rounded-md border border-line-3 bg-surface px-3 text-13 text-chalk"
              />
            </label>
            <button
              type="submit"
              disabled={busy !== null}
              className="min-h-11 rounded-md border border-line-3 px-3 font-mono text-12 font-bold uppercase tracking-widest text-chalk-2 disabled:opacity-40"
            >
              bloquer
            </button>
          </form>
          {data.domains.length === 0 ? (
            <p className="mt-3 text-13 text-chalk-4">Aucun domaine bloqué.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line-2 border-y border-line-2">
              {data.domains.map((item) => (
                <li key={item.domain} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="font-mono text-12 text-chalk-2">{item.domain}</p>
                    <p className="text-13 text-chalk-4">
                      {item.category} · {item.reason || "sans motif"}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                      void act(
                        { action: "unblock-domain", domain: item.domain },
                        `unblock-domain-${item.domain}`,
                        "Domaine retiré",
                      )
                    }
                    className="min-h-11 rounded-md border border-line-3 px-3 font-mono text-12 text-chalk-3 disabled:opacity-40"
                  >
                    retirer
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {data && (
        <section className="px-4 py-5" aria-labelledby="moderation-terms">
          <h3 id="moderation-terms" className="font-display text-15 font-semibold">
            Termes administrables
          </h3>
          <p className="mt-1 max-w-prose text-13 leading-relaxed text-chalk-3">
            La liste de base est dans le code, versionnée et testée. Ici, on
            ajoute ce qui est propre à la communauté, sans redéployer.
          </p>

          <form
            className="mt-3 flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (term.trim().length < 2) return;
              void act(
                { action: "add-term", term, category, severity },
                "add-term",
                "Terme ajouté",
              );
              setTerm("");
            }}
          >
            <label className="min-w-40 flex-1">
              <span className="font-mono text-12 text-chalk-4">terme</span>
              <input
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                maxLength={80}
                className="mt-1 min-h-11 w-full rounded-md border
                  border-line-3 bg-surface px-3 text-13 text-chalk"
              />
            </label>
            <label>
              <span className="font-mono text-12 text-chalk-4">catégorie</span>
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                className="mt-1 min-h-11 w-full rounded-md border
                  border-line-3 bg-surface px-2 text-13 text-chalk"
              >
                {CATEGORIES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="font-mono text-12 text-chalk-4">gravité</span>
              <select
                value={severity}
                onChange={(event) => setSeverity(event.target.value as Severity)}
                className="mt-1 min-h-11 w-full rounded-md border
                  border-line-3 bg-surface px-2 text-13 text-chalk"
              >
                <option value="info">info</option>
                <option value="warning">avertissement</option>
                <option value="critical">critique</option>
              </select>
            </label>
            <button
              type="submit"
              disabled={busy !== null || term.trim().length < 2}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md
                border border-signal bg-signal/10 px-3 font-mono text-12 font-bold
                uppercase tracking-widest text-signal disabled:opacity-40"
            >
              <Icon name="check" size={12} strokeWidth={2.4} />
              ajouter
            </button>
          </form>

          {data.terms.length === 0 ? (
            <p className="mt-3 text-13 text-chalk-4">Aucun terme ajouté.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line-2 border-y border-line-2">
              {data.terms.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="text-13 font-semibold text-chalk">
                      {item.term}
                      {!item.active && <span className="ml-2 text-12 text-chalk-4">inactif</span>}
                    </p>
                    <p className="font-mono text-12 text-chalk-4">
                      {item.category} · {item.severity}
                    </p>
                  </div>
                  {item.active && (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() =>
                        void act(
                          { action: "remove-term", term: item.term },
                          `term-${item.term}`,
                          "Terme désactivé",
                        )
                      }
                      className="min-h-11 rounded-md border border-line-3
                        px-3 font-mono text-12 text-chalk-3 disabled:opacity-40"
                    >
                      désactiver
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
