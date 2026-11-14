import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { AdminConsoleNav } from "@/components/AdminConsoleNav";
import { AdminAudit } from "@/components/AdminAudit";
import { AdminOverview } from "@/components/AdminOverview";
import { AdminRadar } from "@/components/AdminRadar";
import { AdminReports } from "@/components/AdminReports";
import { AdminSecurity } from "@/components/AdminSecurity";
import { AdminSettingsPanel } from "@/components/AdminSettingsPanel";
import { AdminSystem } from "@/components/AdminSystem";
import { AdminTeam } from "@/components/AdminTeam";
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

      {moduleInfo.key === "content" ? (
        <AdminReports />
      ) : moduleInfo.key === "security" ? (
        <AdminSecurity />
      ) : moduleInfo.key === "audit" ? (
        <AdminAudit />
      ) : ["data", "platform", "dependencies"].includes(moduleInfo.key) ? (
        <AdminSystem />
      ) : moduleInfo.surface === "backend" ? (
        <AdminRadar />
      ) : moduleInfo.surface === "dashboard" ? (
        <AdminOverview />
      ) : moduleInfo.surface === "progression" ? (
        <AdminSettingsPanel />
      ) : moduleInfo.surface === "team" ? (
        <AdminTeam />
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
          <p className="mt-3 text-12 text-chalk-4">
            Aucun chiffre de démonstration ni aucune action d&apos;administration
            n&apos;est présenté comme réel.
          </p>
        </section>
      )}
    </AppShell>
  );
}
