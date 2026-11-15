"use client";

import { useCallback, useEffect, useState } from "react";
import { OFFLINE_DATA_TTL_LABEL, OFFLINE_DATA_TTL_MS } from "@/lib/pwa";

/**
 * Gestion visible du cache hors-ligne.
 *
 * Le service worker plafonne déjà ses entrées, mais un plafond invisible
 * n'aide personne : on ne sait pas ce qui occupe l'espace, ni quoi libérer
 * sans casser l'application. Ce panneau montre l'estimation réelle du
 * navigateur et ne supprime que les données rejouables (données, médias,
 * payloads RSC). Les pages et la coque restent en place : vider ces caches
 * rendrait l'application inutilisable hors-ligne jusqu'au prochain
 * préchauffage.
 */

type CacheInfo = {
  name: string;
  entries: number;
  kind: "structure" | "données";
  /** Date à laquelle la plus ancienne lecture API cesse d'être servie. */
  expiresAt?: number | null;
};

type StorageInfo = {
  usage: number;
  quota: number;
  caches: CacheInfo[];
};

const CLEARABLE = /-(data|media|rsc)$/;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} Go`;
}

async function readStorage(): Promise<StorageInfo | null> {
  if (typeof navigator === "undefined" || typeof caches === "undefined") return null;

  const estimate = await navigator.storage?.estimate?.();
  const names = await caches.keys();
  const infos = await Promise.all(names.map(async (name) => {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    let expiresAt: number | null = null;
    if (name.endsWith("-data")) {
      const timestamps = await Promise.all(keys.slice(0, 60).map(async (key) => {
        const response = await cache.match(key);
        const raw = response?.headers.get("x-devnet-cached-at");
        const stamped = raw ? Number(raw) : NaN;
        return Number.isFinite(stamped) ? stamped + OFFLINE_DATA_TTL_MS : null;
      }));
      const valid = timestamps.filter((value): value is number => value !== null);
      if (valid.length > 0) expiresAt = Math.min(...valid);
    }
    return {
      name,
      entries: keys.length,
      kind: CLEARABLE.test(name) ? "données" as const : "structure" as const,
      expiresAt,
    };
  }));

  return {
    usage: estimate?.usage ?? 0,
    quota: estimate?.quota ?? 0,
    caches: infos.sort((a, b) => b.entries - a.entries),
  };
}

export function OfflineCachePanel() {
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setInfo(await readStorage());
    setLoading(false);
  }, []);

  useEffect(() => {
    let alive = true;
    // Lecture asynchrone : le premier rendu reste identique au HTML, et le
    // panneau se remplit quand le navigateur répond.
    void readStorage()
      .then((next) => {
        if (!alive) return;
        setInfo(next);
        setLoading(false);
      })
      .catch(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  /** Ne supprime que ce que le réseau peut reconstruire. */
  async function clearDownloaded() {
    if (typeof caches === "undefined") return;
    setClearing(true);
    setMessage(null);
    try {
      const names = (await caches.keys()).filter((name) => CLEARABLE.test(name));
      await Promise.all(names.map((name) => caches.delete(name)));
      await refresh();
      setMessage(
        names.length > 0
          ? "Données et médias hors-ligne libérés. Les pages restent disponibles."
          : "Aucune donnée téléchargée à libérer.",
      );
    } catch {
      setMessage("Le navigateur a refusé la suppression du cache.");
    } finally {
      setClearing(false);
    }
  }

  const entries = info?.caches.reduce((total, cache) => total + cache.entries, 0) ?? 0;
  const free = info && info.quota > info.usage ? info.quota - info.usage : 0;
  const supported = info !== null;

  return (
    <section className="mb-7 rounded-(--radius-card) border border-line-3 bg-surface p-4 shadow-sh-1">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <h2 className="text-13 font-bold">Cache hors-ligne</h2>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="min-h-(--h-tap) rounded-(--radius-input) px-2 text-12
            font-bold text-chalk-3 transition-colors hover:bg-surface-2
            disabled:opacity-40"
        >
          {loading ? "Lecture…" : "Actualiser"}
        </button>
      </div>

      {!supported && !loading && (
        <p className="mt-2 text-12 leading-relaxed text-chalk-3">
          Ce navigateur ne fournit pas d&apos;API de cache. Le mode hors-ligne
          complet n&apos;est donc pas disponible ici.
        </p>
      )}

      {supported && (
        <>
          <p className="mt-1 text-12 leading-relaxed text-chalk-3">
            {formatBytes(info.usage)} utilisés sur {formatBytes(info.quota)}
            {" · "}
            <strong className="text-chalk">{entries}</strong> entrée{entries === 1 ? "" : "s"}
            {" · "}
            {formatBytes(free)} libres
          </p>
          <p className="mt-1 text-12 leading-relaxed text-chalk-4">
            Les lectures API enregistrées restent valables {OFFLINE_DATA_TTL_LABEL}.
            Passé ce délai, le service worker ne les sert plus.
          </p>

          <ul className="mt-3 space-y-1.5">
            {info.caches.map((cache) => (
              <li
                key={cache.name}
                className="flex items-center justify-between gap-3 rounded-(--radius-input)
                  bg-surface-2 px-3 py-2 text-12"
              >
                <span className="min-w-0 truncate font-mono text-chalk-2">{cache.name}</span>
                <span className="shrink-0 text-right text-chalk-4">
                  {cache.entries} · {cache.kind}
                  {cache.expiresAt && (
                    <span className="block font-mono text-11">
                      jusqu&apos;au {new Date(cache.expiresAt).toLocaleDateString("fr-FR")}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() => void clearDownloaded()}
            disabled={clearing}
            className="mt-3 min-h-(--h-tap) w-full rounded-(--radius-input)
              border border-line-3 px-3 text-13 font-bold text-chalk
              transition-colors hover:bg-surface-2 disabled:opacity-40"
          >
            {clearing ? "Libération…" : "Libérer les données téléchargées"}
          </button>
          <p className="mt-2 text-12 leading-normal text-chalk-4">
            Les pages précachées et la coque de l&apos;application sont conservées.
          </p>
          {message && <p className="mt-2 text-12 text-ok">{message}</p>}
        </>
      )}
    </section>
  );
}
