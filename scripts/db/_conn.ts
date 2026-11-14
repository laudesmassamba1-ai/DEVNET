import { Client } from "pg";
import { resolvePostgresConnection } from "../../platform/infrastructure/postgres/tls";
import { loadEnvFiles } from "./lib";
async function main() {
  loadEnvFiles();
  const c = resolvePostgresConnection(process.env.DATABASE_URL!);
  const cl = new Client({ connectionString: c.connectionString, ssl: c.ssl });
  await cl.connect();
  const r = await cl.query(`select application_name, client_addr::text, state,
      now() - backend_start as age
    from pg_stat_activity
    where datname = current_database() and pid <> pg_backend_pid()
    order by backend_start desc limit 12`);
  console.log("application_name | client_addr | state | age");
  for (const x of r.rows) console.log(` ${String(x.application_name||"(vide)").padEnd(16)} | ${String(x.client_addr||"local").padEnd(16)} | ${String(x.state).padEnd(10)} | ${x.age}`);
  const web = r.rows.filter((x:any)=>x.application_name==="devnet-web").length;
  console.log("\nconnexions 'devnet-web' (l'application) :", web);
  await cl.end();
}
main().catch((e)=>{console.error("ERREUR:",e.message);process.exit(1);});
