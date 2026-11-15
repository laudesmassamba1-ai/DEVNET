"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/Toast";

/**
 * Qui peut m'écrire, me commenter, me mentionner ; mots masqués ; médias
 * sensibles. Chaque champ est enregistré par la RPC `set_safety_settings`,
 * qui valide les valeurs et ne touche qu'à la ligne du compte courant.
 */

type Audience = "everyone" | "followers" | "nobody";

type Settings = {
  who_can_message: Audience;
  who_can_comment: Audience;
  who_can_mention: Audience;
  filter_offensive: boolean;
  hide_sensitive_media: boolean;
  blocked_words: string[];
};

const LABEL: Record<Audience, string> = {
  everyone: "tout le monde",
  followers: "mes abonnés",
  nobody: "personne",
};

const DEFAULTS: Settings = {
  who_can_message: "everyone",
  who_can_comment: "everyone",
  who_can_mention: "everyone",
  filter_offensive: true,
  hide_sensitive_media: false,
  blocked_words: [],
};

export function SafetySettingsForm() {
  const toast = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [words, setWords] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const response = await fetch("/api/protection/settings", { cache: "no-store" });
        const payload = (await response.json().catch(() => null)) as
          | { settings?: Settings; error?: string }
          | null;
        if (!response.ok) throw new Error(payload?.error ?? "lecture impossible");
        if (!alive) return;
        setSettings(payload?.settings ?? DEFAULTS);
        setWords((payload?.settings?.blocked_words ?? []).join(", "));
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : "lecture impossible");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function save(patch: Partial<Settings>) {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/protection/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const payload = (await response.json().catch(() => null)) as
        | { settings?: Settings; error?: string }
        | null;
      if (!response.ok) throw new Error(payload?.error ?? "écriture impossible");
      if (payload?.settings) {
        setSettings(payload.settings);
        setWords(payload.settings.blocked_words.join(", "));
      }
      toast("Protection mise à jour");
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "écriture impossible", "err");
    } finally {
      setBusy(false);
    }
  }

  if (!settings) {
    return error ? (
      <p role="alert" className="px-4 py-4 text-13 text-danger">{error}</p>
    ) : (
      <p className="px-4 py-4 text-13 text-chalk-4">Lecture des paramètres…</p>
    );
  }

  const select = (
    key: "who_can_message" | "who_can_comment" | "who_can_mention",
    label: string,
  ) => (
    <label className="block">
      <span className="font-mono text-12 text-chalk-4">{label}</span>
      <select
        value={settings[key]}
        disabled={busy}
        onChange={(event) => void save({ [key]: event.target.value as Audience })}
        className="mt-1 min-h-11 w-full rounded-md border border-line-3 bg-surface px-2 text-13 text-chalk disabled:opacity-50"
      >
        {(["everyone", "followers", "nobody"] as const).map((value) => (
          <option key={value} value={value}>{LABEL[value]}</option>
        ))}
      </select>
    </label>
  );

  return (
    <section className="px-4 py-5" aria-labelledby="safety-settings">
      <h3 id="safety-settings" className="font-display text-15 font-semibold">
        Qui peut interagir
      </h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {select("who_can_message", "messages privés")}
        {select("who_can_comment", "commentaires")}
        {select("who_can_mention", "mentions")}
      </div>

      <div className="mt-4 space-y-2">
        <label className="flex items-center gap-2 text-13 text-chalk-2">
          <input
            type="checkbox"
            checked={settings.filter_offensive}
            disabled={busy}
            onChange={(event) => void save({ filter_offensive: event.target.checked })}
            className="size-4"
          />
          masquer les commentaires potentiellement offensants
        </label>
        <label className="flex items-center gap-2 text-13 text-chalk-2">
          <input
            type="checkbox"
            checked={settings.hide_sensitive_media}
            disabled={busy}
            onChange={(event) => void save({ hide_sensitive_media: event.target.checked })}
            className="size-4"
          />
          masquer les médias sensibles avant ouverture
        </label>
      </div>

      <form
        className="mt-4 flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const list = words
            .split(",")
            .map((word) => word.trim())
            .filter(Boolean)
            .slice(0, 100);
          void save({ blocked_words: list });
        }}
      >
        <label className="min-w-56 flex-1">
          <span className="font-mono text-12 text-chalk-4">
            mots masqués (séparés par des virgules, 100 max)
          </span>
          <input
            value={words}
            onChange={(event) => setWords(event.target.value)}
            maxLength={2000}
            className="mt-1 min-h-11 w-full rounded-md border border-line-3 bg-surface px-3 text-13 text-chalk"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="min-h-11 rounded-md border border-signal bg-signal/10 px-3 font-mono text-12 font-bold uppercase tracking-widest text-signal disabled:opacity-40"
        >
          enregistrer
        </button>
      </form>
    </section>
  );
}
