import { LEVELS, levelFor } from "@/lib/gamification";

export type Perk = {
  id: string;
  level: number;
  title: string;
  description: string;
  icon: string;
  accent: string;
};

const PERKS: Perk[] = [
  { id: "p1", level: 1, title: "Identité affirmée", description: "Accès au profil public et aux publications.", icon: "user", accent: "ember" },
  { id: "p2", level: 2, title: "Filtrage express", description: "Meilleur repérage sur le fil et dans les interactions.", icon: "eye", accent: "sage" },
  { id: "p3", level: 3, title: "Code mis en avant", description: "Posts avec code plus visibles et mieux distingués.", icon: "code", accent: "teal" },
  { id: "p4", level: 4, title: "Réputation bâtie", description: "Reconnaissance accrue dans les discussions.", icon: "branch", accent: "slate" },
  { id: "p5", level: 5, title: "Atelier renforcé", description: "Outils de publication étoffés pour tes contributions.", icon: "package", accent: "amber" },
  { id: "p6", level: 6, title: "Pédagogue distingué", description: "Ta parole pèse plus dans les échanges.", icon: "groups", accent: "gold" },
  { id: "p7", level: 7, title: "Voix architecte", description: "Accès à des espaces de réflexion et visibilité renforcée.", icon: "layers", accent: "violet" },
  { id: "p8", level: 8, title: "Bouclier de confiance", description: "Protection et priorisation sur le signalement/fiabilité.", icon: "lock", accent: "ruby" },
  { id: "p9", level: 9, title: "Ambassadeur", description: "Influence élargie et mise en avant dans l'annuaire.", icon: "globe", accent: "cyan" },
  { id: "p10", level: 10, title: "Légende", description: "Statut exceptionnel, aura premium sur tout le réseau.", icon: "trophy", accent: "legend" },
];

export function perksForXp(xp: number): { level: number; unlocked: Perk[]; next?: Perk } {
  const lv = levelFor(xp).level;
  const unlocked = PERKS.filter((p) => p.level <= lv);
  const next = PERKS.find((p) => p.level === lv + 1);
  return { level: lv, unlocked, next };
}

export function allPerks(): Perk[] {
  return PERKS;
}

export { LEVELS };
