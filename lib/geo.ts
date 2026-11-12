/**
 * Géographie de l'accueil.
 *
 * Deux écrans ont besoin de savoir **d'où** vient un développeur : la carte
 * publique (fonctionnalité 1) et le profil (fonctionnalité 3). On ne stocke
 * que du texte — ville, pays — et les coordonnées se **déduisent** de la
 * ville par la table ci-dessous. Une ville inconnue ne place personne au
 * hasard : elle est ignorée. Mieux vaut un point de moins qu'un point faux.
 *
 * Le tracé de l'Afrique est un **contour**, pas une frontière : une
 * quarantaine de points sur la côte, projetés en équirectangulaire. Il sert
 * de fond, jamais de carte politique.
 */

import { api } from "@/lib/api/client";

export interface MapPoint {
  id: string;
  prenom: string;
  pseudo: string;
  avatar_color: string | null;
  ville: string;
  pays: string;
  lat: number;
  lng: number;
  proofs: number;
  languages: string[];
}

/** Coordonnées des villes que la démo et les profils utilisent. */
const CITIES: Record<string, { lat: number; lng: number }> = {
  abidjan: { lat: 5.36, lng: -4.008 },
  yamoussoukro: { lat: 6.827, lng: -5.289 },
  bouaké: { lat: 7.69, lng: -5.03 },
  dakar: { lat: 14.7167, lng: -17.4677 },
  "saint-louis": { lat: 16.0179, lng: -16.4896 },
  lagos: { lat: 6.5244, lng: 3.3792 },
  abuja: { lat: 9.0765, lng: 7.3986 },
  kano: { lat: 12.0022, lng: 8.592 },
  casablanca: { lat: 33.5731, lng: -7.5898 },
  rabat: { lat: 34.0209, lng: -6.8416 },
  marrakech: { lat: 31.6295, lng: -7.9811 },
  nairobi: { lat: -1.2921, lng: 36.8219 },
  mombasa: { lat: -4.0435, lng: 39.6682 },
  accra: { lat: 5.6037, lng: -0.187 },
  kumasi: { lat: 6.6885, lng: -1.6244 },
  johannesburg: { lat: -26.2041, lng: 28.0473 },
  "le caire": { lat: 30.0444, lng: 31.2357 },
  alexandrie: { lat: 31.2001, lng: 29.9187 },
  tunis: { lat: 36.8065, lng: 10.1815 },
  alger: { lat: 36.7538, lng: 3.0588 },
  oran: { lat: 35.6971, lng: -0.6308 },
  tripoli: { lat: 32.8872, lng: 13.1913 },
  khartoum: { lat: 15.5007, lng: 32.5599 },
  "addis-abeba": { lat: 9.032, lng: 38.7469 },
  kampala: { lat: 0.3476, lng: 32.5825 },
  kigali: { lat: -1.9441, lng: 30.0619 },
  "dar es salaam": { lat: -6.7924, lng: 39.2083 },
  kinshasa: { lat: -4.4419, lng: 15.2663 },
  brazzaville: { lat: -4.2634, lng: 15.2429 },
  luanda: { lat: -8.839, lng: 13.2894 },
  maputo: { lat: -25.9692, lng: 32.5732 },
  harare: { lat: -17.8252, lng: 31.0335 },
  lusaka: { lat: -15.3875, lng: 28.3228 },
  gaborone: { lat: -24.6282, lng: 25.9231 },
  windhoek: { lat: -22.5609, lng: 17.0658 },
  "le cap": { lat: -33.9249, lng: 18.4241 },
  bamako: { lat: 12.6392, lng: -8.0029 },
  ouagadougou: { lat: 12.3714, lng: -1.5197 },
  niamey: { lat: 13.5116, lng: 2.1254 },
  conakry: { lat: 9.6412, lng: -13.5784 },
  cotonou: { lat: 6.3703, lng: 2.3912 },
  lomé: { lat: 6.1256, lng: 1.2254 },
  douala: { lat: 4.0511, lng: 9.7679 },
  yaoundé: { lat: 3.848, lng: 11.5021 },
  mamoudzou: { lat: -12.7806, lng: 45.2278 },
  antananarivo: { lat: -18.8792, lng: 47.5079 },

  /* ---- Élargissement : toute l'Afrique, pays et îles inclus ---- */

  // Maghreb
  tanger: { lat: 35.7797, lng: -5.8137 },
  fes: { lat: 34.0331, lng: -5.0003 },
  annaba: { lat: 36.9, lng: 7.7667 },
  sousse: { lat: 35.8254, lng: 10.637 },

  // Égypte et vallée du Nil
  gizeh: { lat: 30.0131, lng: 31.2089 },
  assouan: { lat: 24.0889, lng: 32.8998 },
  juba: { lat: 4.8594, lng: 31.5713 },

  // Corne de l'Afrique
  djibouti: { lat: 11.5721, lng: 43.1456 },
  asmara: { lat: 15.3229, lng: 38.9251 },
  hargeisa: { lat: 9.56, lng: 44.065 },
  mogadiscio: { lat: 2.0469, lng: 45.3182 },

  // Afrique de l'Est et grands lacs
  bujumbura: { lat: -3.3822, lng: 29.3614 },
  dodoma: { lat: -6.163, lng: 35.7516 },
  nakuru: { lat: -0.3031, lng: 36.08 },
  arusha: { lat: -3.3869, lng: 36.683 },
  lilongwe: { lat: -13.9626, lng: 33.7741 },

  // Bassin du Congo
  lubumbashi: { lat: -11.6876, lng: 27.5026 },
  goma: { lat: -1.6585, lng: 29.2204 },
  kisangani: { lat: 0.5236, lng: 25.1906 },
  bangui: { lat: 4.3947, lng: 18.5582 },
  ndjamena: { lat: 12.1348, lng: 15.0557 },
  libreville: { lat: 0.4162, lng: 9.4673 },
  malabo: { lat: 3.7504, lng: 8.7833 },

  // Afrique de l'Ouest, au-delà des capitales connues
  timbuktu: { lat: 16.7666, lng: -3.0026 },
  Segou: { lat: 13.4318, lng: -6.2158 },
  bobo: { lat: 11.1771, lng: -4.2979 },
  tamale: { lat: 9.4008, lng: -0.8393 },
  "benin-city": { lat: 6.335, lng: 5.6037 },
  ibadan: { lat: 7.3775, lng: 3.947 },
  "port-harcourt": { lat: 4.8156, lng: 7.0498 },
  enugu: { lat: 6.4489, lng: 7.5166 },
  kalabougou: { lat: 12.6, lng: -8.0333 },
  "nouakchott": { lat: 18.0793, lng: -15.9652 },
  banjul: { lat: 13.4549, lng: -16.579 },
  bissau: { lat: 11.8817, lng: -15.6178 },
  freetown: { lat: 8.4657, lng: -13.2317 },
  monrovia: { lat: 6.3005, lng: -10.7969 },
  "saint-louis-du-senegal": { lat: 16.0333, lng: -16.5 },
  "pointe-noire": { lat: -4.7761, lng: 11.8635 },

  // Au-delà du Zambèze
  blantyre: { lat: -15.7861, lng: 35.0058 },
  ndola: { lat: -12.9708, lng: 28.6339 },
  bulawayo: { lat: -20.1325, lng: 28.6265 },
  beira: { lat: -19.8436, lng: 34.8389 },
  "east-london": { lat: -33.013, lng: 27.9134 },
  durban: { lat: -29.8587, lng: 31.0218 },
  pretoria: { lat: -25.7461, lng: 28.1881 },
  soweto: { lat: -26.2678, lng: 27.8585 },

  // Îles de l'océan Indien et Atlantique
  "victoria": { lat: -4.6196, lng: 55.4513 },
  "port-louis": { lat: -20.1609, lng: 57.5012 },
  "saint-denis-reunion": { lat: -20.8789, lng: 55.4481 },
  moroni: { lat: -11.6455, lng: 43.2556 },
  praia: { lat: 14.933, lng: -23.5133 },
  "sao tome": { lat: 0.3365, lng: 6.7273 },
};

function key(city: string): string {
  return city
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Le point d'une ville, ou `null` si on ne la connaît pas. */
export function coordsOf(city: string): { lat: number; lng: number } | null {
  return CITIES[key(city)] ?? null;
}

/** Le nombre de villes cartographiées — la couverture de la plateforme. */
export const CITY_COUNT = Object.keys(CITIES).length;

/**
 * Les pays couverts par la table des villes. La valeur sert à l'écran
 * « l'Afrique de DevNet » : afficher la couverture honnête de la carte
 * plutôt qu'un compte approximatif de drapeaux choisis à la main.
 */
export const COUNTRIES_COVERED = [
  "Afrique du Sud", "Algérie", "Angola", "Bénin", "Botswana", "Burundi",
  "Cameroun", "Cap-Vert", "Centrafrique", "Comores", "Congo-Brazzaville",
  "Congo-Kinshasa", "Côte d'Ivoire", "Djibouti", "Égypte", "Érythrée",
  "Eswatini", "Éthiopie", "Gabon", "Gambie", "Ghana", "Guinée",
  "Guinée-Bissau", "Guinée équatoriale", "Kenya", "Lesotho", "Liberia",
  "Libye", "Madagascar", "Malawi", "Mali", "Maroc", "Maurice", "Mauritanie",
  "Mayotte", "Mozambique", "Namibie", "Niger", "Nigeria", "Ouganda",
  "Réunion", "Rwanda", "Sao Tomé-et-Principe", "Sénégal", "Seychelles",
  "Sierra Leone", "Somalie", "Soudan", "Soudan du Sud", "Tanzanie", "Tchad",
  "Togo", "Tunisie", "Zambie", "Zimbabwe",
] as const;

/** Le nombre de pays visés par la plateforme — les 54 de l'Union africaine. */
export const AFRICA_COUNTRIES_TOTAL = 54;

/* ── Projection ─────────────────────────────────────────────────────── */

/** Fenêtre géographique de la carte (un peu plus large que l'Afrique). */
export const MAP_BOUNDS = { west: -28, east: 62, north: 39, south: -38 };

/**
 * Projette un couple longitude/latitude vers une case de la carte.
 *
 * Équirectangulaire — les méridiens restent verticaux. Sur une fenêtre
 * couvrant l'Afrique entière, la distorsion est faible, et la carte n'a
 * pas à être un instrument de navigation : elle situe, elle ne mesure pas.
 */
export function project(
  lng: number,
  lat: number,
  width: number,
  height: number,
): { x: number; y: number } {
  const { west, east, north, south } = MAP_BOUNDS;
  return {
    x: ((lng - west) / (east - west)) * width,
    y: ((north - lat) / (north - south)) * height,
  };
}

/**
 * Contour de l'Afrique, dans le sens des aiguilles d'une montre depuis
 * Gibraltar. Chaque point est `[longitude, latitude]`.
 */
export const AFRICA_OUTLINE: [number, number][] = [
  [-5.9, 35.8], [-1.0, 35.9], [3.0, 37.0], [9.0, 37.3], [11.1, 33.5],
  [15.0, 32.4], [20.0, 32.8], [25.0, 32.0], [29.9, 31.2], [32.5, 31.3],
  [34.2, 31.3], [34.9, 29.5], [35.6, 27.0], [37.2, 22.0], [38.6, 18.0],
  [43.0, 12.7], [47.9, 11.0], [51.3, 11.8], [51.0, 10.4], [49.0, 6.5],
  [44.0, 1.5], [41.7, -1.5], [40.1, -6.0], [39.3, -6.8], [40.4, -10.5],
  [40.5, -15.5], [35.5, -19.0], [35.5, -24.0], [32.0, -26.0], [26.0, -33.9],
  [20.0, -34.8], [18.4, -34.0], [17.0, -30.0], [14.5, -22.5], [11.7, -17.5],
  [13.3, -8.8], [12.0, -6.0], [9.3, -0.6], [9.5, 4.0], [6.0, 4.3],
  [3.4, 6.4], [-0.2, 5.6], [-4.0, 5.2], [-7.5, 4.4], [-11.4, 6.9],
  [-13.6, 9.6], [-16.0, 12.4], [-17.5, 14.7], [-16.0, 19.5], [-13.0, 23.0],
  [-11.0, 28.0], [-9.8, 31.5], [-6.0, 35.8],
];

/** Convertit le contour en chemin SVG pour la taille voulue. */
export function outlinePath(width: number, height: number): string {
  return (
    AFRICA_OUTLINE.map(([lng, lat], i) => {
      const { x, y } = project(lng, lat, width, height);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(" ") + " Z"
  );
}

/* ── Données ────────────────────────────────────────────────────────── */

/**
 * Charge les points de la carte : un par développeur qui a des preuves,
 * placé à sa ville.
 *
 * On lit les preuves **et** les auteurs en une fois. Un visiteur non
 * connecté doit pouvoir voir la carte : les preuves sont publiques
 * (migration 024), et le regroupement se fait ici plutôt qu'en base pour
 * ne pas dépendre d'une fonction `auth`.
 */
export async function loadMapPoints(): Promise<MapPoint[]> {
  const sb = api;
  const [usersRes, proofsRes] = await Promise.all([
    sb.from("users").select("id, prenom, pseudo, avatar_color, ville, pays").limit(500),
    sb.from("proofs").select("user_id, language").limit(2000),
  ]);

  const users = (usersRes.data as {
    id: string;
    prenom: string;
    pseudo: string;
    avatar_color: string | null;
    ville: string;
    pays: string;
  }[]) ?? [];
  const proofs = (proofsRes.data as { user_id: string; language: string }[]) ?? [];

  const byUser = new Map<string, { count: number; languages: Set<string> }>();
  for (const p of proofs) {
    const entry = byUser.get(p.user_id) ?? { count: 0, languages: new Set<string>() };
    entry.count += 1;
    if (p.language) entry.languages.add(p.language);
    byUser.set(p.user_id, entry);
  }

  const out: MapPoint[] = [];
  for (const u of users) {
    const stat = byUser.get(u.id);
    if (!stat || stat.count === 0) continue;
    const spot = coordsOf(u.ville);
    if (!spot) continue;
    out.push({
      id: u.id,
      prenom: u.prenom,
      pseudo: u.pseudo,
      avatar_color: u.avatar_color,
      ville: u.ville,
      pays: u.pays,
      lat: spot.lat,
      lng: spot.lng,
      proofs: stat.count,
      languages: [...stat.languages].sort(),
    });
  }

  return out.sort((a, b) => b.proofs - a.proofs);
}
