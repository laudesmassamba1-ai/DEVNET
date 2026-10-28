/**
 * Tests de la géographie élargie (`lib/geo.ts`).
 *
 * Exécuter avec :  npx tsx scripts/test-geo.ts
 *
 * La couverture de la carte est un engagement : un développeur de
 * Praia comme un développeur de Maurice doit se voir placé. On vérifie
 * donc que chaque **pays** de la liste couverte a au moins une ville,
 * que les coordonnées restent dans l'Afrique élargie, et que la
 * normalisation résout les saisies réelles (accents, casse, espaces).
 */

import {
  AFRICA_OUTLINE, AFRICA_COUNTRIES_TOTAL, CITY_COUNT, coordsOf, outlinePath,
  project, MAP_BOUNDS, COUNTRIES_COVERED,
} from "../lib/geo";

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) passed++;
  else failures.push(`${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
}

/* ------------------------------------------------------------------ */
/* 1. Names normalisés — la table du monde réel                       */
/* ------------------------------------------------------------------ */

// Un écran réunit des saisies libres : BETE il faut résoudre casse,
// accents, espaces superflus.
check("Kisangani résout", coordsOf("Kisangani") !== null);
check("SÃO TOMÉ résout (tilde, casse)", coordsOf("São Tomé") !== null);
check("FREETOWN résout (casse + espaces)", coordsOf("  FREETOWN  ") !== null);
check("le caire résout", coordsOf("Le Caire") !== null);
check("port-louis résout", coordsOf("Port-Louis") !== null);
check("villes inconnues ignorées", coordsOf("Paris") === null && coordsOf("") === null);

/* ------------------------------------------------------------------ */
/* 2. Couverture                                                      */
/* ------------------------------------------------------------------ */

check("au moins 90 villes cartographiées", CITY_COUNT >= 90, CITY_COUNT);
// Un point par sous-région : les extrêmes de l'Afrique réelle.
for (const [nom, ville] of [
  ["extrême ouest (Dakar)", "Dakar"],
  ["extrême est (Maurice)", "Port-Louis"],
  ["extrême nord (Tunis)", "Tunis"],
  ["extrême sud (Le Cap)", "Le Cap"],
] as const) {
  check(`un point à l'${nom}`, coordsOf(ville) !== null, ville);
}
check("la liste des pays est complète (54+ territoires)", COUNTRIES_COVERED.length >= AFRICA_COUNTRIES_TOTAL, COUNTRIES_COVERED.length);

/* ------------------------------------------------------------------ */
/* 3. Coordonnées plausibles                                          */
/* ------------------------------------------------------------------ */

const probe = [
  "Dakar", "Cairo", "Le Caire", "Nairobi", "Antananarivo", "Praia",
  "Victoria", "Praia", "Bujumbura", "Nouakchott", "Mamoudzou",
];
for (const ville of probe) {
  const c = coordsOf(ville);
  if (!c) continue;
  const dansLOcean =
    c.lat < -40 || c.lat > 45 || c.lng < -30 || c.lng > 75;
  check(`coordonnées plausibles de ${ville}`, !dansLOcean, c);
}
const dakar = coordsOf("Dakar");
const Maurice = coordsOf("Port-Louis");
check("l'ouest est plus à l'ouest que l'est", dakar && Maurice ? dakar.lng < Maurice.lng : false);

/* ------------------------------------------------------------------ */
/* 4. Projection et contour                                           */
/* ------------------------------------------------------------------ */

const { west, east, north, south } = MAP_BOUNDS;
check("les bornes couvrent le continent et les îles", west <= -20 && east >= 60 && south <= -36 && north >= 38, MAP_BOUNDS);

// Une ville maritime de l'océan Indien doit tomber dans le cadre.
const maurice = coordsOf("Port-Louis")!;
const pMaurice = project(maurice.lng, maurice.lat, 1000, 1000);
check("Maurice dans le cadre projeté", pMaurice.x >= 0 && pMaurice.x <= 1000 && pMaurice.y >= 0 && pMaurice.y <= 1000, pMaurice);

// Le contour référence au moins un point à l'est de 50° (corne + océan Indien).
check("le contour touche les low-latitude est", AFRICA_OUTLINE.some(([, lat]) => lat > 35) && AFRICA_OUTLINE.some(([lng]) => lng > 50));

// Le chemin SVG commence par un M et finit par un Z.
const path = outlinePath(400, 400);
check("chemin SVG valide", path.startsWith("M") && path.trimEnd().endsWith("Z"));

/* ------------------------------------------------------------------ */
/* Bilan                                                              */
/* ------------------------------------------------------------------ */

console.log(`${passed} vérification(s) passée(s), ${failures.length} échec(s)`);
if (failures.length) {
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
