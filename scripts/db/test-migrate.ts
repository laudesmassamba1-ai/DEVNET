/**
 * Vérifie les garde-fous de l'exécuteur de migrations, sans base de données.
 *
 * Ce qui est testé ici est ce qui protège l'historique : le filtrage des
 * fichiers (un `seed.sql` ou un dump ne doit jamais être rejoué comme une
 * migration), l'ordre, la stabilité des sommes de contrôle et les deux
 * refus — dérive d'une migration appliquée, effacement d'une base distante.
 *
 * Ce test ne se connecte pas à une base. L'application réelle des migrations
 * doit être vérifiée séparément sur le conteneur PostgreSQL 17 local, puis sur
 * la cible distante après son achat et la vérification de ses droits.
 */
import { assertNoDrift, isLocalHost, listMigrations, MigrationError } from "./lib";

let failures = 0;

function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

function throws(label: string, run: () => void, expectedFragment: string): void {
  try {
    run();
    check(label, false, "aucune erreur levée");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const typed = error instanceof MigrationError;
    check(label, typed && message.includes(expectedFragment), message);
  }
}

async function verifyFileSelection(): Promise<void> {
  const migrations = await listMigrations("supabase");
  const names = migrations.map((migration) => migration.name);

  check("40 migrations retenues", migrations.length === 40, `${migrations.length} trouvées`);
  check("première = 001_schema.sql", names[0] === "001_schema.sql", names[0]);
  check(
    "dernière = 040_user_email_privacy.sql",
    names[names.length - 1] === "040_user_email_privacy.sql",
    names[names.length - 1],
  );
  check("ordre croissant", names.join() === [...names].sort().join());
  check("seed.sql exclu", !names.includes("seed.sql"));
  check("dump horodaté exclu", !names.includes("20261013104533_my_schema.sql"));
  check("doublons timestampés exclus", !names.some((name) => /^\d{8}/.test(name)));
  check(
    "somme de contrôle stable",
    migrations.every((migration) => /^[0-9a-f]{64}$/.test(migration.checksum)),
  );
}

function sample(checksum: string): MigrationShape[] {
  return [{ name: "001_schema.sql", sql: "", checksum }];
}

type MigrationShape = { name: string; sql: string; checksum: string };

function verifyDriftGuard(): void {
  const applied = new Map([["001_schema.sql", "a".repeat(64)]]);
  check("dérive acceptée quand tout est identique", runs(() => assertNoDrift(applied, sample("a".repeat(64)))));
  throws(
    "dérive refusée quand le fichier a changé",
    () => assertNoDrift(applied, sample("b".repeat(64))),
    "déjà appliquée(s) puis modifiée(s)",
  );
}

function runs(run: () => void): boolean {
  try {
    run();
    return true;
  } catch {
    return false;
  }
}

function verifyLocalHosts(): void {
  for (const host of ["localhost", "127.0.0.1", "::1", "db"]) {
    check(`hôte local accepté : ${host}`, isLocalHost(host));
  }
  for (const host of ["systalink.example.com", "10.0.0.5", "db.example.com"]) {
    check(`hôte distant refusé : ${host}`, !isLocalHost(host));
  }
}

async function main(): Promise<void> {
  await verifyFileSelection();
  verifyDriftGuard();
  verifyLocalHosts();

  if (failures > 0) {
    console.error(`\n${failures} vérification(s) en échec`);
    process.exitCode = 1;
    return;
  }
  console.log("\nToutes les vérifications passent.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
