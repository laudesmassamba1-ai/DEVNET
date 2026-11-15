import assert from "node:assert/strict";
import { ADMIN_MODULES } from "../lib/admin-modules";

const keys = ADMIN_MODULES.map((module) => module.key);
const paths = ADMIN_MODULES.map((module) => module.href);

assert.equal(new Set(keys).size, keys.length, "Les clés admin doivent être uniques.");
assert.equal(new Set(paths).size, paths.length, "Les liens admin doivent être uniques.");

for (const adminModule of ADMIN_MODULES) {
  assert.ok(adminModule.surface, `${adminModule.key} doit avoir une surface déclarée.`);
  if (adminModule.key !== "accounts") {
    assert.equal(
      adminModule.href,
      `/admin/${adminModule.key}`,
      `${adminModule.key} doit cibler sa page dynamique.`,
    );
  }
  /*
   * Garde conservée pour l'avenir : aujourd'hui aucun module n'est
   * « indisponible », donc TypeScript voit cette comparaison comme du
   * code mort. La comparaison est élargie à `string` pour que la règle
   * tienne le jour où un module sera ajouté sans écran.
   */
  if ((adminModule.status as string) === "indisponible") {
    assert.equal(
      adminModule.surface,
      "unavailable",
      `${adminModule.key} est indisponible : sa surface doit le dire.`,
    );
  }
  /*
   * Une surface « backend » ou « dashboard » peut être complète : ces
   * surfaces décrivent d'où viennent les données, pas si le module les
   * couvre. Seules `data` et `progression` restent des signaux de
   * couverture limitée.
   */
  if (["data", "progression"].includes(adminModule.surface)) {
    assert.ok(
      adminModule.status === "complet",
      `${adminModule.key} doit déclarer un statut explicite.`,
    );
  }
}

for (const key of ["settings", "analytics", "progress", "moderation", "security"] as const) {
  const adminModule = ADMIN_MODULES.find((item) => item.key === key);
  assert.equal(adminModule?.status, "complet", `${key} doit être un module complet.`);
}

/*
 * Les quatre modules construits en 072 doivent être déclarés complets.
 * Sans cette vérification, un module pourrait redevenir « partiel » par
 * inadvertance alors que son écran, sa route et sa fonction existent —
 * et la console recommencerait à sous-vendre ce qu'elle sait faire.
 */
for (const key of ["content", "incidents", "communications", "data", "dependencies", "platform"] as const) {
  const adminModule = ADMIN_MODULES.find((item) => item.key === key);
  assert.equal(adminModule?.status, "complet", `${key} doit être déclaré complet.`);
}

/*
 * Conformité reste « partiel » et c'est volontaire : la file enregistre
 * et suit les demandes, elle n'exécute ni l'export ni la suppression.
 * Un statut « complet » promettrait un geste qui n'existe pas.
 */
const compliance = ADMIN_MODULES.find((item) => item.key === "compliance");
assert.equal(compliance?.status, "partiel", "Conformité doit rester partielle.");
assert.ok(
  compliance?.reason.includes("manuel"),
  "Conformité doit dire que l'exécution reste manuelle.",
);

console.log(`✓ ${ADMIN_MODULES.length} modules admin ont une route et un statut vérifiés.`);
