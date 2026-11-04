import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { AdminConsoleNav } from "@/components/AdminConsoleNav";
import { AdminOverview } from "@/components/AdminOverview";
import { AdminRadar } from "@/components/AdminRadar";
import { AdminSettingsPanel } from "@/components/AdminSettingsPanel";
import { ADMIN_MODULES } from "@/lib/admin-modules";

export default async function AdminSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  const moduleInfo = ADMIN_MODULES.find((item) => item.key === section);
  if (!moduleInfo || moduleInfo.key === "accounts") notFound();

  return (
    <AppShell title={`Administration · ${moduleInfo.label}`} path={`~/admin/${section}`}>
      <AdminConsoleNav active={moduleInfo.key} />
      <header className="border-b border-line-2 px-(--gutter) py-5">
        <p className="font-mono text-[11px] text-chalk-4">
          {moduleInfo.priority} · {moduleInfo.status === "partiel" ? "Partiel" : "À instrumenter"}
        </p>
        <h1 className="mt-1 font-display text-[22px] font-semibold tracking-[-0.03em]">
          {moduleInfo.label}
        </h1>
      </header>

      {moduleInfo.surface === "backend" ? (
        <AdminRadar />
      ) : moduleInfo.surface === "dashboard" ? (
        <AdminOverview />
      ) : moduleInfo.surface === "data" ? (
        <>
          <AdminOverview />
          <section className="mx-(--gutter) my-5 border-l-2 border-line-3 bg-surface-2 px-4 py-4">
            <h2 className="font-display text-[16px] font-semibold">
              Couverture des données
            </h2>
            <p className="mt-2 max-w-prose text-[13px] leading-relaxed text-chalk-3">
              Seuls les volumes de profils, publications, projets et leur activité récente
              sont mesurés ici. La taille des tables, les connexions, les migrations et les
              sauvegardes ne sont pas exposées.
            </p>
          </section>
        </>
      ) : moduleInfo.surface === "progression" ? (
        <AdminSettingsPanel />
      ) : moduleInfo.surface === "content" ? (
        <section
          role="status"
          className="mx-(--gutter) my-5 border-l-2 border-line-3 bg-surface-2 px-4 py-4"
        >
          <h2 className="font-display text-[16px] font-semibold">
            File de modération admin indisponible
          </h2>
          <p className="mt-2 max-w-prose text-[13px] leading-relaxed text-chalk-3">
            Les signalements sont actuellement visibles par les auteurs concernés et les
            responsables de groupe. Une file globale et des actions modérateur auditées ne
            sont pas configurées.
          </p>
          <Link
            href="/moderation"
            className="mt-4 inline-flex min-h-[var(--h-tap)] items-center border-b border-signal
              text-[13px] font-semibold text-signal hover:text-chalk"
          >
            Ouvrir la modération de tes contenus
          </Link>
        </section>
      ) : (
        <section
          role="status"
          className="mx-(--gutter) my-5 border-l-2 border-line-3
            bg-surface-2 px-4 py-4"
        >
          <h2 className="font-display text-[16px] font-semibold">
            Données non disponibles
          </h2>
          <p className="mt-2 max-w-prose text-[13px] leading-relaxed text-chalk-3">
            {moduleInfo.reason}
          </p>
          <p className="mt-3 text-[12px] text-chalk-4">
            Aucun chiffre de démonstration ni aucune action d&apos;administration
            n&apos;est présenté comme réel.
          </p>
        </section>
      )}
    </AppShell>
  );
}
