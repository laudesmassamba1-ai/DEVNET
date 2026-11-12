/**
 * Vérifie les garde-fous de l'exécuteur de migrations, sans base de données.
 *
 * Ce qui est testé ici est ce qui protège l'historique : le filtrage des
 * fichiers (un `seed.sql` ou un dump ne doit jamais être rejoué comme une
 * migration), l'ordre, la stabilité des sommes de contrôle et les deux
 * refus — dérive d'une migration appliquée, effacement d'une base distante.
 *
 * Ce test ne se connecte pas à une base. L'application réelle des migrations
 * doit être vérifiée séparément sur le conteneur PostgreSQL 18.3 local, puis sur
 * la cible distante après vérification de ses droits et confirmation.
 */
import { assertSafeTarget, GuardError, maskHost, parseEndpoint, readTarget } from "./guard";
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
  const migrations = await listMigrations("db/migrations");
  const names = migrations.map((migration) => migration.name);

  check("61 migrations retenues", migrations.length === 61, `${migrations.length} trouvées`);
  check("première = 001_schema.sql", names[0] === "001_schema.sql", names[0]);
  check(
    "dernière = 061_password_reset.sql",
    names[names.length - 1] === "061_password_reset.sql",
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

function throwsGuard(label: string, run: () => void, expectedFragment: string): void {
  try {
    run();
    check(label, false, "aucune erreur levée");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check(label, error instanceof GuardError && message.includes(expectedFragment), message);
  }
}

function verifyGuard(): void {
  check("cible par défaut = local", readTarget({}) === "local");
  check("cible remote acceptée", readTarget({ DB_TARGET: "remote" }) === "remote");
  throwsGuard("cible inconnue refusée", () => readTarget({ DB_TARGET: "production" }), "DB_TARGET invalide");

  const endpoint = parseEndpoint("postgres://user@db.devnet.test:5432/devnet");
  check("hôte extrait", endpoint.host === "db.devnet.test");
  check("base extraite", endpoint.database === "devnet");
  check("hôte masqué", maskHost(endpoint.host) !== endpoint.host && maskHost(endpoint.host).includes("***"));
  check(
    "description sans URL",
    !JSON.stringify(endpoint).includes("postgres"),
  );

  const databaseUrl = "postgres://user@db.devnet.test:5432/devnet";
  check(
    "écriture locale acceptée",
    assertSafeTarget({ databaseUrl: "postgres://devnet@127.0.0.1:5433/devnet", target: "local", operation: "migrate" }).includes("base=devnet"),
  );
  throwsGuard(
    "écriture distante sans confirmation refusée",
    () => assertSafeTarget({ databaseUrl, target: "remote", operation: "migrate" }),
    "CONFIRM_REMOTE=devnet",
  );
  throwsGuard(
    "confirmation distante erronée refusée",
    () => assertSafeTarget({ databaseUrl, target: "remote", operation: "migrate", confirmRemote: "autre" }),
    "ne correspond pas",
  );
  check(
    "écriture distante confirmée acceptée",
    assertSafeTarget({ databaseUrl, target: "remote", operation: "migrate", confirmRemote: "devnet" }).includes("cible=remote"),
  );
  throwsGuard(
    "reset distant refusé",
    () => assertSafeTarget({ databaseUrl, target: "remote", operation: "reset", confirmRemote: "devnet" }),
    "jamais autorisé",
  );
  check(
    "lecture distante sans confirmation acceptée",
    assertSafeTarget({ databaseUrl, target: "remote", operation: "read" }).includes("cible=remote"),
  );
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
  verifyGuard();
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
