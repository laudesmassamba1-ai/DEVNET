"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Dépendances — `/admin/dependencies`.
 *
 * Le module annonçait « aucun registre des ports et adaptateurs actifs n'est
 * exposé ». C'était vrai, et c'est un angle mort : le dépôt contient
 * plusieurs implémentations du même port, et rien dans l'application ne
 * disait laquelle tourne. Le 14 novembre, la base est tombée et le fil a
 * répondu un tableau vide : sans ce registre, impossible de distinguer
 * « pas de contenu » de « mauvais adaptateur ».
 *
 * L'écran sépare trois choses qu'on confond souvent :
 *  - ce qui est **actif** (choisi à l'exécution, avec la raison) ;
 *  - ce qui est **orphelin** (présent dans le dépôt, jamais instancié) ;
 *  - ce qui est **configuré** (un service externe, sans sonde réseau).
 */

type Adapter = {
  module: string;
  port: string;
  implementations: { name: string; kind: string; active: boolean }[];
  selected: string | null;
  note: string;
};

type Dependencies = {
  checkedAt: string;
  environment: {
    demo: boolean;
    region: string | null;
    vercelEnv: string | null;
    activeDatabase: "primary" | "standby";
  };
  adapters: Adapter[];
  orphans: { module: string; name: string; why: string }[];
  plugins: { id: string; name: string; version: string }[];
  services: { name: string; configured: boolean; role: string }[];
};

export function AdminDependencies() {
  const [data, setData] = useState<Dependencies | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/dependencies", { cache: "no-store" });
      const payload = (await res.json()) as Dependencies & { error?: string };
      if (!res.ok || !payload.adapters) {
        setError(payload.error ?? "Lecture impossible.");
        setData(null);
        return;
      }
      setData(payload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Réseau indisponible.");
      setData(null);
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

  if (error) {
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

  if (!data) {
    return (
      <section className="px-(--gutter) py-5">
        <p className="text-13 text-chalk-4">Lecture…</p>
      </section>
    );
  }

  return (
    <div className="divide-y divide-line-2">
      <section className="px-(--gutter) py-5">
        <h2 className="font-display text-display-m font-semibold">Contexte d’exécution</h2>
        <dl className="mt-3 divide-y divide-line-2 border-y border-line-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
            <dt className="text-13 text-chalk-3">Mode démonstration</dt>
            <dd className={`font-mono text-12 font-semibold ${data.environment.demo ? "text-danger" : "text-ok"}`}>
              {data.environment.demo ? "actif — données en mémoire" : "non — données réelles"}
            </dd>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
            <dt className="text-13 text-chalk-3">Base active</dt>
            <dd className="font-mono text-12 text-chalk-2">
              {data.environment.activeDatabase === "primary" ? "primaire" : "secours"}
            </dd>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
            <dt className="text-13 text-chalk-3">Région</dt>
            <dd className="font-mono text-12 text-chalk-2">
              {data.environment.region ?? "locale / inconnue"}
            </dd>
          </div>
        </dl>
      </section>

      <section className="px-(--gutter) py-5">
        <h2 className="font-display text-display-m font-semibold">Ports et adaptateurs</h2>
        <p className="mt-1 max-w-prose text-13 leading-relaxed text-chalk-3">
          Un port est un contrat ; un adaptateur est une façon de le tenir.
          Plusieurs existent pour le même port, et un seul tourne.
        </p>

        <ul className="mt-3 divide-y divide-line-2">
          {data.adapters.map((adapter) => (
            <li key={adapter.module} className="py-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-12 text-chalk-4">{adapter.module}</span>
                <span className="text-13 text-chalk-2">{adapter.port}</span>
              </div>
              <p className="mt-1 font-mono text-12 text-signal">
                {adapter.selected ?? "aucun adaptateur actif"}
              </p>
              <p className="mt-1 max-w-prose text-13 leading-relaxed text-chalk-3">
                {adapter.note}
              </p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {adapter.implementations.map((implementation) => (
                  <li
                    key={implementation.name}
                    className={`rounded-(--radius-chip) border px-2 py-0.5 font-mono text-12
                      ${implementation.active
                        ? "border-signal text-signal"
                        : "border-line-3 text-chalk-4"}`}
                  >
                    {implementation.name}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>

      <section className="px-(--gutter) py-5">
        <h2 className="font-display text-display-m font-semibold">
          Adaptateurs orphelins
        </h2>
        {data.orphans.length === 0 ? (
          <p className="mt-2 max-w-prose text-13 leading-relaxed text-chalk-3">
            Aucun. Chaque implémentation présente dans le dépôt est choisie
            dans au moins une configuration.
          </p>
        ) : (
          <>
            <p className="mt-1 max-w-prose text-13 leading-relaxed text-chalk-3">
              Présents dans le dépôt, jamais instanciés. Soit du code mort, soit
              une bascule prévue mais jamais câblée.
            </p>
            <ul className="mt-3 divide-y divide-line-2">
              {data.orphans.map((orphan) => (
                <li key={`${orphan.module}-${orphan.name}`} className="py-2">
                  <span className="font-mono text-12 text-chalk-2">{orphan.name}</span>
                  <span className="ml-2 font-mono text-12 text-chalk-4">{orphan.module}</span>
                  <p className="mt-0.5 text-12 text-chalk-4">{orphan.why}</p>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="px-(--gutter) py-5">
        <h2 className="font-display text-display-m font-semibold">Services externes</h2>
        <p className="mt-1 max-w-prose text-13 leading-relaxed text-chalk-3">
          Configuration seulement : cette page ne sonde aucun service. Un
          registre qui appellerait Google et GitHub à chaque ouverture serait
          lent, et mentirait en cas de panne réseau.
        </p>
        <ul className="mt-3 divide-y divide-line-2">
          {data.services.map((service) => (
            <li key={service.name} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
              <span className="text-13 text-chalk-2">{service.name}</span>
              <span className="flex items-baseline gap-3">
                <span className="text-12 text-chalk-4">{service.role}</span>
                <span
                  className={`font-mono text-12 font-semibold ${service.configured ? "text-ok" : "text-chalk-4"}`}
                >
                  {service.configured ? "configuré" : "absent"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {data.plugins.length > 0 && (
        <section className="px-(--gutter) py-5">
          <h2 className="font-display text-display-m font-semibold">Plugins enregistrés</h2>
          <ul className="mt-3 divide-y divide-line-2">
            {data.plugins.map((plugin) => (
              <li key={plugin.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
                <span className="text-13 text-chalk-2">{plugin.name}</span>
                <span className="font-mono text-12 text-chalk-4">
                  {plugin.id} · v{plugin.version}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="px-(--gutter) py-4 font-mono text-12 text-chalk-4">
        Mesuré le {new Date(data.checkedAt).toLocaleString("fr-FR")}
      </p>
    </div>
  );
}
