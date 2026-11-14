import { Client } from "pg";
import { resolvePostgresConnection } from "../../platform/infrastructure/postgres/tls";
import { loadEnvFiles } from "./lib";
async function main() {
  loadEnvFiles();
  const c = resolvePostgresConnection(process.env.DATABASE_URL!);
  const cl = new Client({ connectionString: c.connectionString, ssl: c.ssl });
  await cl.connect();
  const cols = await cl.query(`select column_name, data_type from information_schema.columns
    where table_schema='public' and table_name='sessions' order by ordinal_position`);
  console.log("colonnes sessions:", cols.rows.map((r:any)=>r.column_name+":"+r.data_type).join(", "));
  const n = await cl.query("select count(*)::int n from sessions");
  console.log("sessions actives:", n.rows[0].n);
  const cred = await cl.query(`select column_name from information_schema.columns
    where table_schema='public' and table_name='user_credentials' order by ordinal_position`);
  console.log("colonnes user_credentials:", cred.rows.map((r:any)=>r.column_name).join(", "));
  const alg = await cl.query("select left(password_hash, 7) prefix, count(*)::int n from user_credentials group by 1");
  console.log("algorithmes de hachage:", JSON.stringify(alg.rows));
  await cl.end();
}
main().catch((e)=>{console.error("ERREUR:",e.message);process.exit(1);});
