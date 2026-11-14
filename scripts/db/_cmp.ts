import { Client } from "pg";
import { resolvePostgresConnection } from "../../platform/infrastructure/postgres/tls";
import { loadEnvFiles } from "./lib";
async function main() {
  loadEnvFiles();
  const c = resolvePostgresConnection(process.env.DATABASE_URL!);
  const cl = new Client({connectionString:c.connectionString, ssl:c.ssl});
  await cl.connect();
  const off = await cl.query(`select n.nspname, c.relname, t.tgname from pg_trigger t
    join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where not t.tgisinternal and t.tgenabled='D' order by 1,2,3`);
  console.log("triggers désactivés restants:", off.rows.length);
  for (const r of off.rows) console.log("  ", r.nspname+"."+r.relname, r.tgname);
  const counts = await cl.query(`select
    (select count(*)::int from users) users,
    (select count(*)::int from auth.users) auth_users,
    (select count(*)::int from posts) posts,
    (select count(*)::int from stories) stories,
    (select count(*)::int from projects) projects,
    (select count(*)::int from git_commits) commits,
    (select count(*)::int from schema_migrations) migrations`);
  console.log("compteurs:", JSON.stringify(counts.rows[0]));
  await cl.end();
}
main().catch((e)=>{console.error("ERREUR:",e.message);process.exit(1);});
