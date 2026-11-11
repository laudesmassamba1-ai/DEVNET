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
  if (adminModule.surface === "unavailable") {
    assert.equal(
      adminModule.status,
      "indisponible",
      `${adminModule.key} ne doit pas sembler actif.`,
    );
  }
  if (["backend", "data", "dashboard", "progression"].includes(adminModule.surface)) {
    assert.equal(
      adminModule.status,
      "partiel",
      `${adminModule.key} doit signaler la couverture limitée de sa surface.`,
    );
  }
}

for (const key of ["settings", "analytics", "data", "progress", "platform"] as const) {
  const adminModule = ADMIN_MODULES.find((item) => item.key === key);
  assert.equal(adminModule?.status, "partiel", `${key} doit signaler sa couverture partielle.`);
}

console.log(`✓ ${ADMIN_MODULES.length} modules admin ont une route et un statut vérifiés.`);
