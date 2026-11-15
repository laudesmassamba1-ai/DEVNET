"use client";

import { useCallback, useEffect, useState } from "react";
import { Loading } from "@/components/Avatar";
import { SafetySettingsForm } from "@/components/SafetySettingsForm";
import { useToast } from "@/components/Toast";

/**
 * Protection du compte : ce que je bloque, ce que je mets en sourdine, et
 * les sanctions qui me concernent avec leur voie de recours.
 *
 * L'écran ne invente aucune action : chaque bouton appelle une RPC qui vérifie
 * l'identité en base. Un blocage n'est pas une sanction — il ne se voit pas
 * chez l'autre et ne remonte pas dans son historique.
 */

type Relation = { id: string; pseudo: string; created_at: string };
type Sanction = {
  id: string;
  kind: string;
  reason_code: string;
  status: string;
  starts_at: string;
  ends_at: string | null;
  issued_by_pseudo: string | null;
};

type Appeal = {
  id: string;
  sanction_id: string;
  message: string;
  status: "pending" | "upheld" | "overturned";
  decision_note: string;
  created_at: string;
  reviewed_at: string | null;
  sanction_kind: string;
  sanction_reason: string;
};

type Payload = {
  blocks: Relation[];
  mutes: Relation[];
  sanctions: Sanction[];
  appeals?: Appeal[];
};

const LABEL: Record<string, string> = {
  warning: "avertissement",
  restrict: "restriction",
  suspend: "suspension",
  ban: "bannissement",
};

async function read(): Promise<Payload> {
  const response = await fetch("/api/protection", { cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new Error(payload?.error ?? "lecture impossible");
  return payload as Payload;
}

export function ProtectionPanel() {
  const toast = useToast();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [appealFor, setAppealFor] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await read());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "lecture impossible");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement initial, pas une synchronisation
    void load();
  }, [load]);

  async function act(action: string, userId: string, success: string) {
    if (busy) return;
    setBusy(`${action}-${userId}`);
    try {
      const response = await fetch("/api/protection", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, userId }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; protection?: Payload }
        | null;
      if (!response.ok) throw new Error(payload?.error ?? "action impossible");
      if (payload?.protection) setData(payload.protection);
      toast(success);
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "action impossible", "err");
    } finally {
      setBusy(null);
    }
  }

  async function submitAppeal(sanctionId: string) {
    if (busy || message.trim().length < 10) return;
    setBusy(`appeal-${sanctionId}`);
    try {
      const response = await fetch("/api/sanctions/appeal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sanctionId, message }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "recours impossible");
      setAppealFor(null);
      setMessage("");
      toast("Recours déposé");
      await load();
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "recours impossible", "err");
    } finally {
      setBusy(null);
    }
  }

  if (!data && !error) return <Loading label="Lecture de tes protections" />;

  return (
    <div className="divide-y divide-line-2">
      <section className="px-4 py-5">
        <h2 className="font-display text-display-m font-semibold">Protection</h2>
        <p className="mt-2 max-w-prose text-13 leading-relaxed text-chalk-3">
          Bloquer coupe les interactions croisées ; mettre en sourdine masque les
          publications sans notifier la personne. Une sanction se conteste ici,
          une seule fois à la fois.
        </p>
        {error && (
          <p role="alert" className="mt-3 border-l-2 border-danger pl-3 text-13 text-danger">
            {error}
          </p>
        )}
      </section>

      <SafetySettingsForm />

      {data && (
        <section className="px-4 py-5" aria-labelledby="protect-blocks">
          <h3 id="protect-blocks" className="font-display text-15 font-semibold">
            Comptes bloqués ({data.blocks.length})
          </h3>
          {data.blocks.length === 0 ? (
            <p className="mt-2 text-13 text-chalk-4">Aucun compte bloqué.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line-2 border-y border-line-2">
              {data.blocks.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-2 py-2.5">
                  <span className="text-13 text-chalk-2">{row.pseudo || row.id.slice(0, 8)}</span>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void act("unblock", row.id, "Compte débloqué")}
                    className="min-h-11 rounded-md border border-line-3 px-3 font-mono text-12 text-chalk-3 disabled:opacity-40"
                  >
                    débloquer
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {data && (
        <section className="px-4 py-5" aria-labelledby="protect-mutes">
          <h3 id="protect-mutes" className="font-display text-15 font-semibold">
            En sourdine ({data.mutes.length})
          </h3>
          {data.mutes.length === 0 ? (
            <p className="mt-2 text-13 text-chalk-4">Aucun compte en sourdine.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line-2 border-y border-line-2">
              {data.mutes.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-2 py-2.5">
                  <span className="text-13 text-chalk-2">{row.pseudo || row.id.slice(0, 8)}</span>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void act("unmute", row.id, "Sourdine retirée")}
                    className="min-h-11 rounded-md border border-line-3 px-3 font-mono text-12 text-chalk-3 disabled:opacity-40"
                  >
                    réactiver
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {data?.appeals && data.appeals.length > 0 && (
        <section className="px-4 py-5" aria-labelledby="protect-appeals">
          <h3 id="protect-appeals" className="font-display text-15 font-semibold">
            Recours déposés ({data.appeals.length})
          </h3>
          <ul className="mt-2 divide-y divide-line-2 border-y border-line-2">
            {data.appeals.map((appeal) => (
              <li key={appeal.id} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-13 font-semibold text-chalk">
                    {LABEL[appeal.sanction_kind] ?? appeal.sanction_kind} · {appeal.status}
                  </span>
                  <span className="font-mono text-12 text-chalk-4">
                    {new Date(appeal.created_at).toLocaleDateString("fr-FR")}
                  </span>
                </div>
                {appeal.decision_note && (
                  <p className="mt-1 text-12 leading-relaxed text-chalk-3">
                    {appeal.decision_note}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {data && (
        <section className="px-4 py-5" aria-labelledby="protect-sanctions">
          <h3 id="protect-sanctions" className="font-display text-15 font-semibold">
            Sanctions ({data.sanctions.length})
          </h3>
          {data.sanctions.length === 0 ? (
            <p className="mt-2 text-13 text-chalk-4">Aucune sanction sur ce compte.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line-2 border-y border-line-2">
              {data.sanctions.map((sanction) => (
                <li key={sanction.id} className="py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-13 font-semibold text-chalk">
                      {LABEL[sanction.kind] ?? sanction.kind} · {sanction.status}
                    </span>
                    <span className="font-mono text-12 text-chalk-4">
                      {sanction.ends_at
                        ? `jusqu'au ${new Date(sanction.ends_at).toLocaleDateString("fr-FR")}`
                        : "sans fin"}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-12 text-chalk-4">
                    motif : {sanction.reason_code}
                  </p>
                  {sanction.status === "active" && (
                    <div className="mt-2">
                      {appealFor === sanction.id ? (
                        <form
                          className="flex flex-wrap items-end gap-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void submitAppeal(sanction.id);
                          }}
                        >
                          <label className="min-w-56 flex-1">
                            <span className="font-mono text-12 text-chalk-4">
                              pourquoi cette décision est erronée
                            </span>
                            <input
                              value={message}
                              onChange={(event) => setMessage(event.target.value)}
                              minLength={10}
                              maxLength={2000}
                              className="mt-1 min-h-11 w-full rounded-md border border-line-3 bg-surface px-3 text-13 text-chalk"
                            />
                          </label>
                          <button
                            type="submit"
                            disabled={busy !== null || message.trim().length < 10}
                            className="min-h-11 rounded-md border border-signal bg-signal/10 px-3 font-mono text-12 font-bold uppercase tracking-widest text-signal disabled:opacity-40"
                          >
                            envoyer
                          </button>
                        </form>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setAppealFor(sanction.id)}
                          className="min-h-11 rounded-md border border-line-3 px-3 font-mono text-12 text-chalk-3"
                        >
                          contester
                        </button>
                      )}
                    </div>
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
