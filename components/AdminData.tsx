"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/Icon";

/**
 * Données — `/admin/data`.
 *
 * Ce module partageait son écran avec « Plateforme » et « Dépendances » :
 * il parlait donc de région d'exécution et de services configurés, qui ne
 * sont pas son sujet. Il manquait l'essentiel — et c'est exactement ce qui
 * a manqué le 14 novembre : **l'état des deux bases et celui des sauvegardes**.
 *
 * L'écran est organisé par ordre de gravité, pas par ordre de beauté :
 *
 *  1. la base active et la secours, avec le pilotage du retour ;
 *  2. la sauvegarde hors site, avec son âge et un verdict ;
 *  3. les stockages de fichiers (R2, Blob, PostgreSQL) ;
 *  4. les volumes, table par table ;
 *  5. les tables vides, qui disent ce que l'application promet sans servir.
 */

type TableSize = { table: string; bytes: number; rows: number };

type DatabaseInspection = {
  target: "primary" | "standby";
  configured: boolean;
  reachable: boolean;
  active: boolean;
  latencyMs: number | null;
  host: string | null;
  migrations: number | null;
  schema: string | null;
  health: "unknown" | "ok" | "down";
  error: string | null;
  lastSeenAt: string | null;
  databaseBytes: number | null;
  tableCount: number | null;
  connections: number | null;
  serverVersion: string | null;
};

type StorageProvider = {
  id: "r2" | "vercel-blob" | "postgres";
  label: string;
  configured: boolean;
  reachable: boolean | null;
  objects: number | null;
  bytes: number | null;
  truncated: boolean;
  detail: string;
};

type DataState = {
  checkedAt: string;
  database: {
    ok: boolean;
    latencyMs: number | null;
    reason: string | null;
    host: string | null;
  };
  failover: {
    active: "primary" | "standby";
    standbyConfigured: boolean;
    switchedAt: string | null;
    reason: string | null;
  };
  config: {
    enabled: boolean;
    autoReturn: boolean;
    primaryConfigured: boolean;
    standbyConfigured: boolean;
    active: "primary" | "standby";
  } | null;
  databases: Record<"primary" | "standby", DatabaseInspection> | null;
  storage: {
    checkedAt: string;
    providers: StorageProvider[];
    references: {
      postsWithMedia: number;
      directMessagesWithMedia: number;
      groupMessagesWithMedia: number;
      storiesWithMedia: number;
    } | null;
    orphaned: number | null;
    readable: boolean;
  } | null;
  sizeBytes: number | null;
  migration: string | null;
  tables: TableSize[];
  tableCount: { total: number; empty: number };
  backups: {
    configured: boolean;
    count: number | null;
    newestAt: string | null;
    newestBytes: number | null;
    verdict: "ok" | "stale" | "missing" | "unconfigured" | "error";
    detail: string;
  };
};

const BACKUP_LABEL: Record<DataState["backups"]["verdict"], string> = {
  ok: "Sauvegarde à jour",
  stale: "Sauvegarde trop ancienne",
  missing: "Aucune sauvegarde",
  unconfigured: "Hors site non configuré",
  error: "Vérification impossible",
};

const DB_LABEL: Record<DatabaseInspection["target"], string> = {
  primary: "Primaire",
  standby: "Secours",
};

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} Go`;
}

function formatDate(value: string | null): string {
  if (!value) return "jamais";
  return new Date(value).toLocaleString("fr-FR");
}

function shortHash(value: string | null): string {
  if (!value) return "—";
  return value.slice(0, 10);
}

export function AdminData() {
  const [data, setData] = useState<DataState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"probe" | "switch" | null>(null);
  const [pendingTarget, setPendingTarget] = useState<"primary" | "standby" | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/data", { cache: "no-store" });
      const payload = (await res.json()) as DataState & { error?: string };
      if (!res.ok || !payload.database) {
        setError(payload.error ?? "Lecture impossible.");
        setData(null);
        return;
      }
      setData(payload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Réseau indisponible.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const probe = useCallback(async () => {
    setBusy("probe");
    setNotice(null);
    try {
      const res = await fetch("/api/admin/failover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "probe" }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) {
        setNotice({ tone: "err", text: payload.error ?? "Sonde impossible." });
        return;
      }
      await load();
      setNotice({ tone: "ok", text: "Sonde effectuée sur les deux bases." });
    } catch {
      setNotice({ tone: "err", text: "Réseau indisponible : la sonde n'a pas abouti." });
    } finally {
      setBusy(null);
    }
  }, [load]);

  const switchDatabase = useCallback(
    async (target: "primary" | "standby") => {
      setBusy("switch");
      setNotice(null);
      try {
        const res = await fetch("/api/admin/failover", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "switch", target, confirmation: "basculer" }),
        });
        const payload = (await res.json()) as {
          ok?: boolean;
          reason?: string;
          error?: string;
          audit?: { ok?: boolean; error?: string };
        };
        if (!res.ok) {
          setNotice({ tone: "err", text: payload.error ?? "Bascule refusée." });
          return;
        }
        if (!payload.ok) {
          setNotice({
            tone: "err",
            text: `Bascule refusée : ${payload.reason ?? "raison inconnue"}`,
          });
        } else {
          setNotice({
            tone: "ok",
            text:
              `Bascule effectuée vers la base ${target === "primary" ? "primaire" : "de secours"}. `
              + "Aucune écriture n'est copiée : les données de la base quittée restent dessus.",
          });
        }
        if (payload.audit && payload.audit.ok === false) {
          setNotice({
            tone: "err",
            text: payload.audit.error ?? "Bascule effectuée, mais le journal n'a pas été écrit.",
          });
        }
        setPendingTarget(null);
        await load();
      } catch {
        setNotice({ tone: "err", text: "Réseau indisponible : la bascule n'a pas abouti." });
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

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

  if (error) {
    return (
      <section className="px-4 py-5">
        <p role="alert" className="max-w-prose text-13 text-danger">
          {error}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="mo-press mt-3 min-h-11 rounded-md
            border border-line-3 px-4 text-13 text-chalk-2"
        >
          Réessayer
        </button>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="px-4 py-5">
        <p className="text-13 text-chalk-4">{loading ? "Lecture…" : "Aucune donnée."}</p>
      </section>
    );
  }

  const backupTone =
    data.backups.verdict === "ok"
      ? "text-ok border-ok"
      : data.backups.verdict === "stale" || data.backups.verdict === "missing"
        ? "text-danger border-danger"
        : "text-chalk-3 border-line-3";

  const databases = data.databases;
  const schemaMatch =
    databases?.primary.schema && databases?.standby.schema
      ? databases.primary.schema === databases.standby.schema
      : null;
  return (
    <div className="divide-y divide-line-2">
      <section className="px-4 py-5" aria-labelledby="admin-data-bases">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="admin-data-bases" className="font-display text-display-m font-semibold">
            Bases de données
          </h2>
          <div className="flex items-baseline gap-2">
            <button
              type="button"
              onClick={() => void probe()}
              disabled={busy !== null}
              className="min-h-11 rounded-md border border-line-3
                px-3 text-12 text-chalk-3 disabled:opacity-50"
            >
              {busy === "probe" ? "Sonde…" : "Sonder"}
            </button>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="min-h-11 rounded-md border border-line-3
                px-3 text-12 text-chalk-3 disabled:opacity-50"
            >
              {loading ? "Actualisation…" : "Actualiser"}
            </button>
          </div>
        </div>

        <p className="mt-1 max-w-prose text-13 leading-relaxed text-chalk-3">
          La bascule automatique sert la secours dès que la base active ne répond
          plus. Le retour, lui, se décide : revenir abandonne les écritures faites
          sur la secours pendant l&apos;incident.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {(["primary", "standby"] as const).map((target) => {
            const db = databases?.[target];
            if (!db) {
              return (
                <div key={target} className="border border-line-2 p-3">
                  <p className="font-display text-base font-semibold">{DB_LABEL[target]}</p>
                  <p className="mt-1 font-mono text-12 text-chalk-4">état non mesuré</p>
                </div>
              );
            }
            const tone = !db.configured
              ? "text-chalk-4 border-line-3"
              : db.reachable
                ? "text-ok border-ok"
                : "text-danger border-danger";
            return (
              <div key={target} className="border border-line-2 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-display text-base font-semibold">
                    {DB_LABEL[target]}
                    {db.active && (
                      <span className="ml-2 font-mono text-12 font-bold uppercase tracking-widest text-signal">
                        active
                      </span>
                    )}
                  </p>
                  <span className={`border-l-2 pl-2 font-mono text-12 font-semibold ${tone}`}>
                    {!db.configured
                      ? "non configurée"
                      : db.reachable
                        ? "en ligne"
                        : "injoignable"}
                  </span>
                </div>
                <dl className="mt-2 divide-y divide-line-2 border-y border-line-2">
                  <Row label="Hôte" value={db.host ?? "—"} />
                  <Row
                    label="Latence"
                    value={db.latencyMs === null ? "—" : `${db.latencyMs} ms`}
                  />
                  <Row label="Migrations" value={db.migrations === null ? "—" : String(db.migrations)} />
                  <Row label="Empreinte" value={shortHash(db.schema)} />
                  <Row label="Taille" value={formatBytes(db.databaseBytes)} />
                  <Row
                    label="Tables"
                    value={db.tableCount === null ? "—" : String(db.tableCount)}
                  />
                  <Row
                    label="Connexions"
                    value={db.connections === null ? "—" : String(db.connections)}
                  />
                  <Row label="Version" value={db.serverVersion ?? "—"} />
                  {db.error && <Row label="Dernière erreur" value={db.error} danger />}
                </dl>
              </div>
            );
          })}
        </div>

        <p className="mt-3 font-mono text-12 text-chalk-4">
          Schémas identiques :{" "}
          <span
            className={
              schemaMatch === true
                ? "text-ok"
                : schemaMatch === false
                  ? "text-danger"
                  : "text-chalk-3"
            }
          >
            {schemaMatch === true ? "oui" : schemaMatch === false ? "non" : "non comparable"}
          </span>
          {data.config
            ? ` · bascule ${data.config.enabled ? "active" : "désactivée"}`
            : ""}
          {data.config
            ? ` · retour ${data.config.autoReturn ? "automatique" : "manuel"}`
            : ""}
        </p>

        {data.failover.switchedAt && (
          <p className="mt-1 font-mono text-12 text-chalk-4">
            dernière bascule le {formatDate(data.failover.switchedAt)}
            {data.failover.reason ? ` · ${data.failover.reason}` : ""}
          </p>
        )}

        <DatabaseSwitchPanel
          data={data}
          pendingTarget={pendingTarget}
          busy={busy}
          setPendingTarget={setPendingTarget}
          switchDatabase={switchDatabase}
        />

        {notice && (
          <p
            role={notice.tone === "err" ? "alert" : "status"}
            className={`mt-3 max-w-prose border-l-2 pl-3 text-13 leading-relaxed ${
              notice.tone === "err" ? "border-danger text-danger" : "border-ok text-ok"
            }`}
          >
            {notice.text}
          </p>
        )}

        <div className="mt-4 border border-line-2 p-3">
          <p className="font-mono text-12 text-chalk-4">Base active</p>
          <p className="mt-1 text-13 leading-relaxed text-chalk-2">
            {data.failover.active === "primary"
              ? "On tourne sur la base primaire."
              : "On tourne sur la base de secours : les données de la primaire ne sont pas visibles."}
          </p>
          <p className="mt-1 font-mono text-12 text-chalk-4">
            endpoint {data.database.host ?? "—"} · {formatBytes(data.sizeBytes)} · dernière
            migration {data.migration ?? "inconnue"}
          </p>
        </div>
      </section>

      <section className="px-4 py-5" aria-labelledby="admin-data-backup">
        <h2 id="admin-data-backup" className="font-display text-display-m font-semibold">
          Sauvegarde
        </h2>
        <div className={`mt-3 border-l-2 pl-3 ${backupTone}`}>
          <p className="font-display text-base font-semibold">
            {BACKUP_LABEL[data.backups.verdict]}
          </p>
          <p className="mt-1 max-w-prose text-13 leading-relaxed text-chalk-3">
            {data.backups.detail}
          </p>
        </div>
        <dl className="mt-3 divide-y divide-line-2 border-y border-line-2">
          <Row
            label="Archives hors site"
            value={data.backups.count === null ? "—" : String(data.backups.count)}
          />
          <Row label="La plus récente" value={formatDate(data.backups.newestAt)} />
          <Row label="Taille de la dernière" value={formatBytes(data.backups.newestBytes)} />
        </dl>
        <p className="mt-3 max-w-prose text-12 leading-relaxed text-chalk-4">
          Vérifié en lecture seule sur le stockage hors site. Aucune archive
          n&apos;est téléchargée, aucune clé n&apos;est exposée.
        </p>
      </section>

      {data.storage && (
        <section className="px-4 py-5" aria-labelledby="admin-data-storage">
          <h2 id="admin-data-storage" className="font-display text-display-m font-semibold">
            Stockage des fichiers
          </h2>
          <p className="mt-1 max-w-prose text-13 leading-relaxed text-chalk-3">
            Un média vit sur R2, sur Vercel Blob, ou dans PostgreSQL quand aucun
            stockage objet n&apos;est configuré. Ces chemins n&apos;ont ni le même
            coût ni la même vitesse.
          </p>

          <ul className="mt-3 divide-y divide-line-2">
            {data.storage.providers.map((provider) => {
              const tone = !provider.configured
                ? "text-chalk-4 border-line-3"
                : provider.reachable
                  ? "text-ok border-ok"
                  : "text-danger border-danger";
              return (
                <li key={provider.id} className="py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-display text-base font-semibold">{provider.label}</span>
                    <span className={`border-l-2 pl-2 font-mono text-12 font-semibold ${tone}`}>
                      {!provider.configured
                        ? "non configuré"
                        : provider.reachable === null
                          ? "non mesuré"
                          : provider.reachable
                            ? "opérationnel"
                            : "injoignable"}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-12 text-chalk-4 tnum">
                    {provider.objects === null ? "—" : `${provider.objects} objet(s)`}
                    {provider.bytes !== null ? ` · ${formatBytes(provider.bytes)}` : ""}
                    {provider.truncated ? " · minimum" : ""}
                  </p>
                  <p className="mt-1 max-w-prose text-13 leading-relaxed text-chalk-3">
                    {provider.detail}
                  </p>
                </li>
              );
            })}
          </ul>

          {data.storage.references && (
            <dl className="mt-3 divide-y divide-line-2 border-y border-line-2">
              <Row label="Publications avec média" value={String(data.storage.references.postsWithMedia)} />
              <Row
                label="Messages privés avec média"
                value={String(data.storage.references.directMessagesWithMedia)}
              />
              <Row
                label="Messages de groupe avec média"
                value={String(data.storage.references.groupMessagesWithMedia)}
              />
              <Row label="Statuts avec média" value={String(data.storage.references.storiesWithMedia)} />
              <Row
                label="Fichiers non référencés"
                value={data.storage.orphaned === null ? "—" : String(data.storage.orphaned)}
                danger={(data.storage.orphaned ?? 0) > 0}
              />
            </dl>
          )}
        </section>
      )}

      <section className="px-4 py-5" aria-labelledby="admin-data-tables">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="admin-data-tables" className="font-display text-display-m font-semibold">
            Tables les plus lourdes
          </h2>
          <p className="font-mono text-12 text-chalk-4 tnum">
            {data.tableCount.total} tables · {data.tableCount.empty} vides
          </p>
        </div>

        {data.tables.length === 0 ? (
          <p className="mt-3 text-13 text-chalk-4">
            Aucune taille lisible : la base ne répond pas.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line-2">
            {data.tables.map((table) => (
              <li key={table.table} className="flex items-baseline justify-between gap-3 py-2">
                <span className="font-mono text-12 text-chalk-2">{table.table}</span>
                <span className="flex items-baseline gap-3 font-mono text-12 text-chalk-4 tnum">
                  <span>{table.rows.toLocaleString("fr-FR")} lignes</span>
                  <span>{formatBytes(table.bytes)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}

        {data.tableCount.empty > 0 && (
          <p className="mt-3 max-w-prose text-13 leading-relaxed text-chalk-3">
            {data.tableCount.empty} table{data.tableCount.empty > 1 ? "s" : ""} sur{" "}
            {data.tableCount.total} ne contien{data.tableCount.empty > 1 ? "nent" : "t"} aucune
            ligne. Ce sont des écrans qui existent sans contenu : à remplir, ou à
            assumer comme vides.
          </p>
        )}
      </section>

      <p className="px-4 py-4 font-mono text-12 text-chalk-4">
        Mesuré le {formatDate(data.checkedAt)}
        {data.storage ? ` · stockage ${formatDate(data.storage.checkedAt)}` : ""}
      </p>
    </div>
  );
}

function Row({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 py-2">
      <dt className="text-13 text-chalk-3">{label}</dt>
      <dd className={`font-mono text-12 ${danger ? "text-danger" : "text-chalk-2"}`}>{value}</dd>
    </div>
  );
}

/**
 * Le bloc de décision.
 *
 * Il n'affiche jamais « reconnecter Systalink » en dur : les rôles primaire et
 * secours sont des variables d'environnement, et une étiquette qui nomme un
 * hébergeur particulier mentirait dès qu'on inverse les deux. L'écran parle de
 * « la base primaire » et « la base de secours », et rappelle la conséquence.
 */
function DatabaseSwitchPanel({
  data,
  pendingTarget,
  busy,
  setPendingTarget,
  switchDatabase,
}: {
  data: DataState;
  pendingTarget: "primary" | "standby" | null;
  busy: "probe" | "switch" | null;
  setPendingTarget: (target: "primary" | "standby" | null) => void;
  switchDatabase: (target: "primary" | "standby") => void;
}) {
  const target: "primary" | "standby" = data.failover.active === "primary" ? "standby" : "primary";
  const db = data.databases?.[target];
  const label = target === "primary" ? "la base primaire" : "la base de secours";
  const configured = data.config ? (target === "primary" ? data.config.primaryConfigured : data.config.standbyConfigured) : Boolean(db?.configured);
  const reachable = db?.reachable === true;

  return (
    <div className="mt-4 border border-line-2 p-3">
      <p className="font-display text-base font-semibold">
        {target === "primary"
          ? "Revenir sur la base primaire"
          : "Basculer sur la base de secours"}
      </p>
      <p className="mt-1 max-w-prose text-13 leading-relaxed text-chalk-3">
        {target === "primary"
          ? "La primaire répond de nouveau ? Le retour ne copie aucune écriture : "
            + "tout ce qui a été publié sur la secours pendant l'incident restera dessus. "
            + "La bascule est refusée si les schémas diffèrent."
          : "La secours prend le relais. Elle contient les données de sa dernière "
            + "synchronisation, pas celles de la primaire à cet instant."}
      </p>

      {!configured && (
        <p className="mt-2 font-mono text-12 text-danger">
          Aucune URL n&apos;est configurée pour {label} : la bascule ne peut pas aboutir.
        </p>
      )}
      {configured && !reachable && (
        <p className="mt-2 font-mono text-12 text-danger">
          {label} ne répond pas à la sonde : la bascule sera refusée par le garde-fou.
        </p>
      )}

      {pendingTarget === target ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => switchDatabase(target)}
            disabled={busy !== null}
            className="mo-press inline-flex min-h-11 items-center gap-1.5 rounded-md
              border border-danger bg-danger/10 px-3 font-mono text-12 font-bold uppercase
              tracking-widest text-danger disabled:opacity-40"
          >
            <Icon name="check" size={12} strokeWidth={2.4} />
            confirmer
          </button>
          <button
            type="button"
            onClick={() => setPendingTarget(null)}
            disabled={busy !== null}
            className="min-h-11 rounded-md border border-line-3 px-3
              font-mono text-12 text-chalk-3 disabled:opacity-40"
          >
            annuler
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setPendingTarget(target)}
          disabled={busy !== null}
          className="mo-press mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-md
            border border-line-3 px-3 font-mono text-12 font-bold uppercase tracking-widest
            text-chalk-2 disabled:opacity-40"
        >
          <Icon name="server" size={12} strokeWidth={2.2} />
          {busy === "switch" ? "bascule…" : `basculer vers ${target === "primary" ? "la primaire" : "la secours"}`}
        </button>
      )}
    </div>
  );
}
