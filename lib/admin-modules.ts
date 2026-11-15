import type { IconName } from "@/components/Icon";

export type AdminModuleSurface =
  | "accounts"
  | "backend"
  | "content"
  | "data"
  | "dashboard"
  | "progression"
  | "team"
  | "incidents"
  | "communications"
  | "compliance"
  | "unavailable";

export type AdminModuleStatus = "indisponible" | "partiel" | "complet";

export const ADMIN_MODULES = [
  {
    key: "radar",
    href: "/admin/radar",
    label: "Radar",
    icon: "target",
    priority: "P0",
    status: "complet",
    surface: "backend",
    reason: "Disponibilité des deux bases, bascule, sentinelles exécutables et signaux de sécurité récents.",
  },
  {
    key: "accounts",
    href: "/admin",
    label: "Comptes",
    icon: "profile",
    priority: "P0",
    status: "complet",
    surface: "accounts",
    reason: "Annuaire, rôles, vérifications, ouverture de compte ; sessions et audit dans le module Sécurité.",
  },
  {
    key: "content",
    href: "/admin/content",
    label: "Contenu",
    icon: "file",
    priority: "P0",
    status: "complet",
    surface: "content",
    reason: "File globale des signalements, classement et suppression du contenu signalé.",
  },
  {
    key: "moderation",
    href: "/admin/moderation",
    label: "Modération",
    icon: "eye",
    priority: "P0",
    status: "complet",
    surface: "content",
    reason:
      "File de relecture (texte, image, heuristique, sentinelle), termes administrables et empreintes de médias bannies. Confirmer ne supprime rien : le module Contenu reste le seul chemin d'effacement.",
  },
  {
    key: "cases",
    href: "/admin/cases",
    label: "Dossiers",
    icon: "flag",
    priority: "P0",
    status: "complet",
    surface: "content",
    reason:
      "Centre de décision humaine : politiques versionnées, constats par moteur, preuves conservées, assignation, notes internes, décision motivée et levée de sanction. Aucun contenu complet n'est affiché.",
  },
  {
    key: "policy",
    href: "/admin/policy",
    label: "Politique",
    icon: "file",
    priority: "P0",
    status: "complet",
    surface: "content",
    reason:
      "Politique versionnée : gravité et décision automatique par catégorie, seuils de revue et de retenue. Publier crée une version, ne réécrit jamais l'ancienne. Suppression et bannissement automatiques restent hors de portée.",
  },
  {
    key: "sanctions",
    href: "/admin/sanctions",
    label: "Sanctions",
    icon: "lock",
    priority: "P0",
    status: "complet",
    surface: "accounts",
    reason:
      "Sanctions graduées (avertissement, restriction, suspension, bannissement), historique et recours. Un recours est révisé par un modérateur différent de l'auteur de la sanction, contrainte tenue par la base.",
  },
  {
    key: "data",
    href: "/admin/data",
    label: "Données",
    icon: "server",
    priority: "P1",
    status: "complet",
    surface: "data",
    reason: "Base active, secours, volumes par table, tables vides et sauvegardes hors site vérifiées en lecture seule.",
  },
  {
    key: "security",
    href: "/admin/security",
    label: "Sécurité",
    icon: "lock",
    priority: "P0",
    status: "complet",
    surface: "backend",
    reason: "Sessions, révocation, signaux de sécurité, état de la chaîne d'audit et volume de la file de modération. La double authentification n'est pas instrumentée.",
  },
  {
    key: "audit",
    href: "/admin/audit",
    label: "Audit",
    icon: "file",
    priority: "P0",
    status: "complet",
    surface: "data",
    reason: "Journal append-only avec chaîne de hachage vérifiée depuis la console (migration 073). Une rupture est signalée avec la ligne fautive.",
  },
  {
    key: "incidents",
    href: "/admin/incidents",
    label: "Incidents",
    icon: "flag",
    priority: "P1",
    status: "complet",
    surface: "incidents",
    reason: "Registre d'incidents : ouverture, surveillance, clôture, journalisés.",
  },
  {
    key: "settings",
    href: "/admin/settings",
    label: "Paramètres",
    icon: "settings",
    priority: "P1",
    status: "complet",
    surface: "progression",
    reason: "Drapeaux, maintenance et inscriptions persistés, journalisés et vérifiés à chaque soumission.",
  },
  {
    key: "dependencies",
    href: "/admin/dependencies",
    label: "Dépendances",
    icon: "layers",
    priority: "P1",
    status: "complet",
    surface: "backend",
    reason: "Registre des ports, adaptateurs actifs, orphelins, plugins et services configurés.",
  },
  {
    key: "analytics",
    href: "/admin/analytics",
    label: "Analytique",
    icon: "chart",
    priority: "P1",
    status: "complet",
    surface: "dashboard",
    reason: "Volumes, séries quotidiennes, cohorts d'inscription et rétention D1/D7 calculées sur les sessions.",
  },
  {
    key: "communications",
    href: "/admin/communications",
    label: "Communications",
    icon: "messages",
    priority: "P2",
    status: "complet",
    surface: "communications",
    reason: "Publication et retrait d'annonces, avec historique conservé.",
  },
  {
    key: "progress",
    href: "/admin/progress",
    label: "Progression",
    icon: "trophy",
    priority: "P2",
    status: "complet",
    surface: "progression",
    reason: "Barèmes XP, paliers, badges et quêtes sont du code testé et lus ici ; aucun événement saisonnier n'est promis.",
  },
  {
    key: "compliance",
    href: "/admin/compliance",
    label: "Conformité",
    icon: "file",
    priority: "P1",
    status: "partiel",
    surface: "compliance",
    reason: "File de demandes (export, suppression), suivi, décision et trace ; l'exécution reste manuelle et documentée, jamais un bouton qui efface sans retour.",
  },
  {
    key: "platform",
    href: "/admin/platform",
    label: "Plateforme",
    icon: "server",
    priority: "P1",
    status: "complet",
    surface: "backend",
    reason: "Jobs avec preuve mesurable, boîte d'envoi, stories, limites lues sur le serveur et secrets de tâches.",
  },
  {
    key: "team",
    href: "/admin/team",
    label: "Équipe",
    icon: "groups",
    priority: "P1",
    status: "complet",
    surface: "team",
    reason: "Liste réelle des comptes portant is_admin, avec leur activité ; la promotion et le retrait se font dans Comptes, avec confirmation et journal.",
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

/**
 * Statut d'un module, élargi à l'union complète.
 *
 * La liste est `as const` pour que les clés restent un type littéral (le
 * routeur en dépend). Effet de bord : chaque `status` est narrowé à
 * `"complet"`, et une comparaison à `"partiel"` devient une erreur TypeScript
 * alors qu'elle est légitime sur le type public. Cette fonction est le seul
 * endroit où l'élargissement est fait, plutôt que dans chaque écran.
 */
export function adminModuleStatus(module: {
  status: AdminModuleStatus;
}): AdminModuleStatus {
  return module.status;
}
