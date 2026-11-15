import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { AdminConsoleNav } from "@/components/AdminConsoleNav";
import { AdminAnalytics } from "@/components/AdminAnalytics";
import { AdminAnnouncements } from "@/components/AdminAnnouncements";
import { AdminCases } from "@/components/AdminCases";
import { AdminAudit } from "@/components/AdminAudit";
import { AdminCompliance } from "@/components/AdminCompliance";
import { AdminData } from "@/components/AdminData";
import { AdminDependencies } from "@/components/AdminDependencies";
import { AdminIncidents } from "@/components/AdminIncidents";
import { AdminModeration } from "@/components/AdminModeration";
import { AdminPolicy } from "@/components/AdminPolicy";
import { AdminRadar } from "@/components/AdminRadar";
import { AdminReports } from "@/components/AdminReports";
import { AdminSanctions } from "@/components/AdminSanctions";
import { AdminSecurity } from "@/components/AdminSecurity";
import { AdminSettingsForm } from "@/components/AdminSettingsForm";
import { AdminSettingsPanel } from "@/components/AdminSettingsPanel";
import { AdminPlatform } from "@/components/AdminPlatform";
import { AdminTeam } from "@/components/AdminTeam";
import { ADMIN_MODULES, type AdminModuleKey } from "@/lib/admin-modules";

/**
 * Quel composant rend quel module.
 *
 * Le routage se faisait par `surface`, ce qui faisait mentir trois écrans :
 * « Paramètres » affichait le barème XP de « Progression », et
 * « Dépendances » comme « Plateforme » affichaient le Radar. Une table
 * explicite par module est plus longue et ne peut pas dériver : un module
 * sans entrée tombe dans l'écran « non disponible », jamais dans le voisin.
 */
const RENDERERS: Partial<Record<AdminModuleKey, () => React.ReactElement>> = {
  radar: () => <AdminRadar />,
  content: () => <AdminReports />,
  moderation: () => <AdminModeration />,
  policy: () => <AdminPolicy />,
  cases: () => <AdminCases />,
  sanctions: () => <AdminSanctions />,
  security: () => <AdminSecurity />,
  audit: () => <AdminAudit />,
  incidents: () => <AdminIncidents />,
  communications: () => <AdminAnnouncements />,
  compliance: () => <AdminCompliance />,
  data: () => <AdminData />,
  platform: () => <AdminPlatform />,
  dependencies: () => <AdminDependencies />,
  analytics: () => <AdminAnalytics />,
  settings: () => <AdminSettingsForm />,
  progress: () => <AdminSettingsPanel />,
  team: () => <AdminTeam />,
};

export default async function AdminSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  const moduleInfo = ADMIN_MODULES.find((item) => item.key === section);
  if (!moduleInfo || moduleInfo.key === "accounts") notFound();

  const render = RENDERERS[moduleInfo.key];

  return (
    <AppShell title={`Administration · ${moduleInfo.label}`} path={`~/admin/${section}`}>
      <AdminConsoleNav active={moduleInfo.key} />
      <header className="border-b border-line-2 px-(--gutter) py-5">
        <p className="font-mono text-12 text-chalk-4">
          {moduleInfo.priority} ·{" "}
          {moduleInfo.status === "complet"
            ? "Complet"
            : moduleInfo.status === "partiel"
              ? "Partiel"
              : "À instrumenter"}
        </p>
        <h1 className="mt-1 font-display text-[22px] font-semibold tracking-[-0.03em]">
          {moduleInfo.label}
        </h1>
      </header>

      {render ? (
        render()
      ) : (
        <section
          role="status"
          className="mx-(--gutter) my-5 border-l-2 border-line-3
            bg-surface-2 px-4 py-4"
        >
          <h2 className="font-display text-base font-semibold">
            Données non disponibles
          </h2>
          <p className="mt-2 max-w-prose text-13 leading-relaxed text-chalk-3">
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
