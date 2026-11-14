import Link from "next/link";
import { Icon } from "@/components/Icon";
import { XP, LEVELS } from "@/lib/gamification";
import { ADMIN_MODULES } from "@/lib/admin-modules";

const XP_RULES = [
  ["Publication", XP.post],
  ["Publication avec code", XP.postCode],
  ["Message de groupe", XP.groupMessage],
  ["Message avec code", XP.groupMessageCode],
  ["Like reçu", XP.likeReceived],
  ["Première activité du jour", XP.presence],
] as const;

export function AdminSettingsPanel() {
  const partiallyAvailable = ADMIN_MODULES.filter((module) => module.status === "partiel");

  return (
    <div className="divide-y divide-line-2">
      <section className="px-(--gutter) py-5" aria-labelledby="admin-config-title">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center border border-line-2 text-signal">
            <Icon name="settings" size={18} />
          </span>
          <div>
            <h2 id="admin-config-title" className="font-display text-[18px] font-semibold">
              Paramètres déployés
            </h2>
            <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-chalk-3">
              Les règles de progression sont définies dans le code et testées.
              Elles ne peuvent pas être modifiées depuis cette console.
            </p>
          </div>
        </div>
      </section>

      <section className="px-(--gutter) py-5" aria-labelledby="admin-xp-title">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="admin-xp-title" className="font-display text-[16px] font-semibold">
            Barème de progression
          </h3>
          <span className="font-mono text-[10px] text-chalk-4">source : lib/gamification.ts</span>
        </div>
        <dl className="mt-4 grid grid-cols-1 divide-y divide-line-2 border-y border-line-2 sm:grid-cols-2 sm:divide-y-0 sm:gap-x-8">
          {XP_RULES.map(([label, points]) => (
            <div key={label} className="flex items-center justify-between gap-4 py-3">
              <dt className="text-[13px] text-chalk-3">{label}</dt>
              <dd className="font-mono text-[13px] font-semibold tabular-nums text-chalk">
                +{points} XP
              </dd>
            </div>
          ))}
        </dl>
        <div className="mt-5">
          <h4 className="text-[13px] font-semibold text-chalk">Paliers</h4>
          <ol className="mt-2 grid grid-cols-2 gap-x-6 sm:grid-cols-5">
            {LEVELS.map((level) => (
              <li
                key={level.level}
                className="flex items-baseline justify-between gap-2 border-b border-line-2 py-2"
              >
                <span className="truncate text-12 text-chalk-3">
                  {level.level}. {level.title}
                </span>
                <span className="font-mono text-[11px] tabular-nums text-chalk-4">
                  {level.min.toLocaleString("fr-FR")}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="px-(--gutter) py-5" aria-labelledby="admin-capability-title">
        <h3 id="admin-capability-title" className="font-display text-[16px] font-semibold">
        Capacités partiellement disponibles
        </h3>
        <p className="mt-1 text-[13px] text-chalk-3">
        {partiallyAvailable.length} modules sur {ADMIN_MODULES.length} affichent déjà une
        donnée ou une configuration réelle. Les fonctions non instrumentées restent
        indisponibles.
        </p>
        <ul className="mt-3 divide-y divide-line-2 border-y border-line-2">
        {partiallyAvailable.map((module) => (
          <li key={module.key} className="flex items-center justify-between gap-3 py-3">
            <span className="text-[13px] text-chalk">{module.label}</span>
            <span className="text-[11px] text-chalk-4">Partiel</span>
          </li>
        ))}
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/admin/radar"
            className="inline-flex min-h-(--h-tap) items-center gap-2 border border-line-2 px-3
              text-12 font-semibold text-chalk-3 hover:border-signal hover:text-signal"
          >
            <Icon name="target" size={14} />
            Voir le Radar
          </Link>
          <Link
            href="/settings"
            className="inline-flex min-h-(--h-tap) items-center gap-2 border border-line-2 px-3
              text-12 font-semibold text-chalk-3 hover:border-signal hover:text-signal"
          >
            <Icon name="profile" size={14} />
            Préférences personnelles
          </Link>
        </div>
      </section>
    </div>
  );
}
