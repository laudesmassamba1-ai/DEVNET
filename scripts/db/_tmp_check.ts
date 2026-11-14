import { Client } from "pg";
import { readdir } from "node:fs/promises";
import { resolvePostgresConnection } from "../../platform/infrastructure/postgres/tls";
import { loadEnvFileFor } from "./lib";

async function main() {
  loadEnvFileFor("remote");
  const conn = resolvePostgresConnection(process.env.DATABASE_URL!);
  const c = new Client({ connectionString: conn.connectionString, ssl: conn.ssl });
  await c.connect();
  const applied = (await c.query("select name from schema_migrations order by name")).rows.map((r: any) => r.name);
  const files = (await readdir("db/migrations")).filter((f) => f.endsWith(".sql")).sort();
  const appliedSet = new Set(applied);
  const fileSet = new Set(files);
  console.log("appliquées:", applied.length, "| fichiers:", files.length);
  console.log("\n== appliquées mais absentes du disque ==");
  console.log(applied.filter((n) => !fileSet.has(n)).join("\n") || "(aucune)");
  console.log("\n== sur disque mais non appliquées ==");
  console.log(files.filter((n) => !appliedSet.has(n)).join("\n") || "(aucune)");
  await c.end();
}
main().catch((e) => { console.error("ERREUR:", e.message); process.exit(1); });
