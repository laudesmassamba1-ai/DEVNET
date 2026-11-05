"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { ADMIN_MODULES, type AdminModuleKey } from "@/lib/admin-modules";

export function AdminConsoleNav({ active }: { active: AdminModuleKey }) {
  const router = useRouter();
  const activeHref = ADMIN_MODULES.find((module) => module.key === active)?.href;

  return (
    <div className="border-b border-line-2 px-(--gutter) py-3">
      <nav
        aria-label="Modules d'administration"
        className="hidden flex-wrap gap-1 shell:flex"
      >
        {ADMIN_MODULES.map((module) => (
          <Link
            key={module.key}
            href={module.href}
            aria-current={active === module.key ? "page" : undefined}
            className={`inline-flex min-h-[var(--h-tap)] shrink-0 items-center gap-2
              rounded-[var(--radius-input)] px-3 text-[12px] transition-colors
              duration-[var(--d-fast)]
              ${active === module.key
                ? "bg-surface-2 font-semibold text-signal"
                : "text-chalk-3 hover:bg-surface-2 hover:text-chalk"}`}
          >
            <Icon name={module.icon} size={14} />
            {module.label}
            {module.status === "partiel" && (
              <span className="text-[10px] text-chalk-4">partiel</span>
            )}
          </Link>
        ))}
      </nav>

      <label className="block shell:hidden">
        <span className="sr-only">Choisir un module d&apos;administration</span>
        <select
          value={activeHref}
          onChange={(event) => router.push(event.target.value)}
          className="min-h-[var(--h-tap)] w-full rounded-[var(--radius-input)]
            border border-line-2 bg-surface px-3 text-[14px] text-chalk
            focus-visible:outline-2 focus-visible:outline-offset-2
            focus-visible:outline-signal"
        >
          {ADMIN_MODULES.map((module) => (
            <option key={module.key} value={module.href}>
              {module.priority} · {module.label}
              {module.status === "indisponible"
                ? " · à instrumenter"
                : module.status === "partiel"
                  ? " · partiel"
                  : ""}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
