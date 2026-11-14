import { Client } from "pg";
import { readFileSync } from "node:fs";
import { resolvePostgresConnection } from "../../platform/infrastructure/postgres/tls";
async function main() {
  const line = readFileSync(".env.remote-source","utf8").split(/\r?\n/).find(l=>l.startsWith("DATABASE_URL="))!;
  const url = line.slice(13).replace(/^"|"$/g,"").trim();
  const c = resolvePostgresConnection(url);
  const cl = new Client({ connectionString: c.connectionString, ssl: c.ssl });
  await cl.connect();
  const r = await cl.query(`select application_name, client_addr::text, state, now()-backend_start age
    from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid()
    order by backend_start desc limit 12`);
  console.log("=== NEON : connexions ===");
  for (const x of r.rows) console.log(` ${String(x.application_name||"(vide)").padEnd(16)} | ${String(x.client_addr||"local").padEnd(18)} | ${String(x.state).padEnd(10)} | ${x.age}`);
  console.log("\nconnexions 'devnet-web' sur NEON :", r.rows.filter((x:any)=>x.application_name==="devnet-web").length);
  await cl.end();
}
main().catch((e)=>{console.error("ERREUR:",e.message);process.exit(1);});
