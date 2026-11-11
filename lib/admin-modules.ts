import type { IconName } from "@/components/Icon";

export type AdminModuleSurface =
  | "accounts"
  | "backend"
  | "content"
  | "data"
  | "dashboard"
  | "progression"
  | "team"
  | "unavailable";

export type AdminModuleStatus = "indisponible" | "partiel";

export const ADMIN_MODULES = [
  {
    key: "radar",
    href: "/admin/radar",
    label: "Radar",
    icon: "target",
    priority: "P0",
    status: "partiel",
    surface: "backend",
    reason: "La sonde actuelle vérifie uniquement la disponibilité du backend.",
  },
  {
    key: "accounts",
    href: "/admin",
    label: "Comptes",
    icon: "profile",
    priority: "P0",
    status: "partiel",
    surface: "accounts",
    reason: "Annuaire, rôles et vérifications disponibles ; sessions et audit restent à instrumenter.",
  },
  {
    key: "content",
    href: "/admin/content",
    label: "Contenu",
    icon: "file",
    priority: "P0",
    status: "indisponible",
    surface: "content",
    reason: "La file de modération administrative et ses actions auditées n'existent pas encore.",
  },
  {
    key: "data",
    href: "/admin/data",
    label: "Données",
    icon: "server",
    priority: "P1",
    status: "partiel",
    surface: "data",
    reason: "Aucune sonde de stockage, de connexions ou de migrations n'est exposée.",
  },
  {
    key: "security",
    href: "/admin/security",
    label: "Sécurité",
    icon: "lock",
    priority: "P0",
    status: "indisponible",
    surface: "unavailable",
    reason: "Les événements, risques et signaux de fuite ne sont pas instrumentés.",
  },
  {
    key: "audit",
    href: "/admin/audit",
    label: "Audit",
    icon: "file",
    priority: "P0",
    status: "indisponible",
    surface: "unavailable",
    reason: "Le journal admin immuable et sa chaîne de hachage sont à construire.",
  },
  {
    key: "incidents",
    href: "/admin/incidents",
    label: "Incidents",
    icon: "flag",
    priority: "P1",
    status: "indisponible",
    surface: "unavailable",
    reason: "Aucun registre d'incidents ou de résolution n'est disponible.",
  },
  {
    key: "settings",
    href: "/admin/settings",
    label: "Paramètres",
    icon: "settings",
    priority: "P1",
    status: "partiel",
    surface: "progression",
    reason: "Les drapeaux et le mode maintenance n'ont pas de stockage partagé.",
  },
  {
    key: "dependencies",
    href: "/admin/dependencies",
    label: "Dépendances",
    icon: "layers",
    priority: "P1",
    status: "partiel",
    surface: "backend",
    reason: "Aucun registre des ports et adaptateurs actifs n'est exposé.",
  },
  {
    key: "analytics",
    href: "/admin/analytics",
    label: "Analytique",
    icon: "chart",
    priority: "P1",
    status: "partiel",
    surface: "dashboard",
    reason: "Aucune mesure agrégée respectueuse de la vie privée n'est collectée.",
  },
  {
    key: "communications",
    href: "/admin/communications",
    label: "Communications",
    icon: "messages",
    priority: "P2",
    status: "indisponible",
    surface: "unavailable",
    reason: "Aucun service d'annonce ou de planification n'est disponible.",
  },
  {
    key: "progress",
    href: "/admin/progress",
    label: "Progression",
    icon: "trophy",
    priority: "P2",
    status: "partiel",
    surface: "progression",
    reason: "Les barèmes sont du code testé ; les événements saisonniers ne sont pas implémentés.",
  },
  {
    key: "compliance",
    href: "/admin/compliance",
    label: "Conformité",
    icon: "file",
    priority: "P1",
    status: "indisponible",
    surface: "unavailable",
    reason: "Aucun flux de demandes ou registre de traitements n'est instrumenté.",
  },
  {
    key: "platform",
    href: "/admin/platform",
    label: "Plateforme",
    icon: "server",
    priority: "P1",
    status: "partiel",
    surface: "backend",
    reason: "Les jobs, sauvegardes et limites ne sont pas observables depuis l'application.",
  },
  {
    key: "team",
    href: "/admin/team",
    label: "Équipe",
    icon: "groups",
    priority: "P1",
    status: "partiel",
    surface: "team",
    reason: "Liste réelle des comptes portant is_admin ; les rôles granulaires et l'approbation à deux ne sont pas modélisés.",
  },
] as const satisfies readonly {
  key: string;
  href: string;
  label: string;
  icon: IconName;
  priority: string;
  status: AdminModuleStatus;
  surface: AdminModuleSurface;
  reason: string;
}[];

export type AdminModuleKey = (typeof ADMIN_MODULES)[number]["key"];
