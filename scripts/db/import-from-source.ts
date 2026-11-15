/**
 * Import des données d'une base source vers la base cible.
 *
 *   npx tsx scripts/db/import-from-source.ts --dry-run
 *   npx tsx scripts/db/import-from-source.ts --apply --confirm=devnet
 *
 * Ce script ne touche **jamais** au schéma : il ne copie que des lignes.
 * Les migrations restent la seule source de vérité pour la structure.
 *
 * Garanties :
 *  - simulation par défaut (`--apply` pour écrire) ;
 *  - cible distante exige `--confirm=<nom_de_la_base>` ;
 *  - une seule transaction : en cas d'échec, rien n'est conservé ;
 *  - les déclencheurs applicatifs sont désactivés pendant le chargement
 *    (`devnet_u` n'est pas superutilisateur, `session_replication_role` lui
 *    est refusé) : les données viennent d'une base déjà cohérente, et les
 *    contrôles de propriété de média rejetteraient des lignes légitimes ;
 *  - les tables sont chargées dans l'ordre de leurs clés étrangères, donc
 *    l'intégrité référentielle tient sans désactiver les contraintes ;
 *  - colonnes calculées à l'intersection des deux schémas : une colonne
 *    ajoutée par une migration récente côté cible prend sa valeur par défaut ;
 *  - `schema_migrations` n'est jamais copiée : la cible garde son propre
 *    historique, plus récent que celui de la source.
 */
import { Client } from "pg";
import { readFileSync } from "node:fs";
import { resolvePostgresConnection } from "../../platform/infrastructure/postgres/tls";
import { loadEnvFiles } from "./lib";

/** Tables dont le contenu appartient à la cible, jamais à la source. */
const NEVER_COPY = new Set(["schema_migrations"]);

/**
 * Tables hors `public` à copier avant lui.
 *
 * `public.users.id` référence `auth.users(id)` : la couche de compatibilité
 * Supabase fait de `auth.users` le parent de tous les comptes. Copier
 * `public.users` sans son parent viole la clé étrangère.
 */
const EXTRA_TABLES: { schema: string; table: string }[] = [{ schema: "auth", table: "users" }];

interface Options {
  apply: boolean;
  confirm: string | null;
  sourceFile: string;
}

function parseArgs(argv: string[]): Options {
  const apply = argv.includes("--apply");
  const confirmArg = argv.find((a) => a.startsWith("--confirm="));
  const sourceArg = argv.find((a) => a.startsWith("--source="));
  return {
    apply,
    confirm: confirmArg ? confirmArg.slice("--confirm=".length) : null,
    sourceFile: sourceArg ? sourceArg.slice("--source=".length) : ".env.remote-source",
  };
}

function urlFromEnvFile(file: string): string {
  const line = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith("DATABASE_URL="));
  if (!line) throw new Error(`DATABASE_URL absente de ${file}`);
  return line.slice("DATABASE_URL=".length).replace(/^"|"$/g, "").trim();
}

async function connect(url: string): Promise<Client> {
  const config = resolvePostgresConnection(url);
  const client = new Client({ connectionString: config.connectionString, ssl: config.ssl });
  await client.connect();
  await client.query("set search_path to public");
  return client;
}

/** Hôte masqué : jamais l'URL complète dans une sortie. */
function maskHost(url: string): string {
  const host = new URL(url).hostname;
  const [first, ...rest] = host.split(".");
  return `${first.slice(0, 4)}***${rest.length ? "." + rest.join(".") : ""}`;
}

async function listTables(client: Client): Promise<string[]> {
  const { rows } = await client.query<{ table_name: string }>(
    `select table_name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'
     order by table_name`,
  );
  return rows.map((r) => r.table_name);
}

async function listColumns(client: Client, table: string, schema = "public"): Promise<string[]> {
  const { rows } = await client.query<{ column_name: string }>(
    `select column_name from information_schema.columns
     where table_schema = $1 and table_name = $2
     order by ordinal_position`,
    [schema, table],
  );
  return rows.map((r) => r.column_name);
}

async function countRows(client: Client, table: string, schema = "public"): Promise<number> {
  const { rows } = await client.query<{ n: number }>(
    `select count(*)::int n from "${schema}"."${table}"`,
  );
  return rows[0].n;
}

/**
 * Ordre de chargement : les tables sans dépendance d'abord. On le déduit des
 * clés étrangères plutôt que de le coder en dur, pour qu'une nouvelle table
 * n'oblige pas à modifier ce script.
 */
async function loadOrder(client: Client, tables: string[]): Promise<string[]> {
  const { rows } = await client.query<{ child: string; parent: string }>(
    `select distinct tc.table_name as child, ccu.table_name as parent
     from information_schema.table_constraints tc
     join information_schema.constraint_column_usage ccu
       on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
     where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
       and tc.table_name <> ccu.table_name`,
  );
  const parents = new Map<string, Set<string>>();
  for (const t of tables) parents.set(t, new Set());
  for (const { child, parent } of rows) {
    if (parents.has(child) && parents.has(parent)) parents.get(child)!.add(parent);
  }

  const ordered: string[] = [];
  const done = new Set<string>();
  let guard = 0;
  while (ordered.length < tables.length && guard++ < tables.length + 5) {
    for (const t of tables) {
      if (done.has(t)) continue;
      const deps = parents.get(t)!;
      if ([...deps].every((d) => done.has(d) || d === t)) {
        ordered.push(t);
        done.add(t);
      }
    }
  }
  // Cycle de clés étrangères : le reste part à la fin, la transaction étant
  // en mode replica, l'ordre n'a plus d'importance pour l'intégrité.
  for (const t of tables) if (!done.has(t)) ordered.push(t);
  return ordered;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  // `.env.local` porte la cible ; le fichier source est lu explicitement.
  loadEnvFiles();
  const sourceUrl = urlFromEnvFile(opts.sourceFile);
  const targetUrl = process.env.DATABASE_URL?.trim();
  if (!targetUrl) throw new Error("DATABASE_URL de la cible absent de l'environnement.");

  const source = await connect(sourceUrl);
  const target = await connect(targetUrl);

  const targetDb = (await target.query<{ d: string }>("select current_database() d")).rows[0].d;
  console.log(`Source : ${maskHost(sourceUrl)}`);
  console.log(`Cible  : ${maskHost(targetUrl)} base=${targetDb}`);
  console.log(`Mode   : ${opts.apply ? "APPLICATION" : "simulation (aucune écriture)"}`);
  console.log("");

  if (opts.apply && targetDb !== opts.confirm) {
    throw new Error(
      `Refus : --confirm=${opts.confirm ?? "(absent)"} ne correspond pas à la base cible « ${targetDb} ».`,
    );
  }

  const sourceTables = new Set(await listTables(source));
  const targetTables = await listTables(target);
  const tables = targetTables.filter((t) => sourceTables.has(t) && !NEVER_COPY.has(t));
  const skipped = targetTables.filter((t) => !sourceTables.has(t) || NEVER_COPY.has(t));

  const order = await loadOrder(target, tables);

  const plan: { table: string; source: number; target: number; columns: number }[] = [];
  for (const t of order) {
    const sourceCols = await listColumns(source, t);
    const targetCols = await listColumns(target, t);
    const shared = sourceCols.filter((c) => targetCols.includes(c));
    plan.push({
      table: t,
      source: await countRows(source, t),
      target: await countRows(target, t),
      columns: shared.length,
    });
  }

  console.log("TABLE".padEnd(26), "SOURCE".padStart(7), "CIBLE".padStart(7), "COLS".padStart(5));
  let totalSource = 0;
  let totalTarget = 0;
  for (const p of plan) {
    totalSource += p.source;
    totalTarget += p.target;
    const flag = p.source !== p.target ? "  ←" : "";
    console.log(p.table.padEnd(26), String(p.source).padStart(7), String(p.target).padStart(7), String(p.columns).padStart(5) + flag);
  }
  console.log("".padEnd(26), String(totalSource).padStart(7), String(totalTarget).padStart(7));
  if (skipped.length) console.log(`\nNon copiées : ${skipped.join(", ")}`);

  if (!opts.apply) {
    console.log("\nSimulation terminée. Relancer avec --apply --confirm=" + targetDb + " pour écrire.");
    await source.end();
    await target.end();
    return;
  }

  console.log("\nChargement…");
  await target.query("begin");
  try {
    // Désactivation des déclencheurs applicatifs, table par table : le rôle
    // applicatif en est propriétaire, il peut le faire sans superutilisateur.
    for (const t of tables) {
      await target.query(`alter table "${t}" disable trigger user`);
    }
    /* `auth.users` porte `on_auth_user_created`, qui insère une ligne dans
       `public.users` à chaque insertion : sans le couper, la copie de
       `auth.users` recréerait les comptes que `public.users` s'apprête à
       insérer, et la clé primaire entrerait en collision. */
    for (const extra of EXTRA_TABLES) {
      await target.query(
        `alter table "${extra.schema}"."${extra.table}" disable trigger user`,
      );
    }

    await target.query(
      `truncate table ${tables.map((t) => `"${t}"`).join(", ")} restart identity cascade`,
    );
    // Le parent de `public.users` : vidé après ses enfants, rechargé avant eux.
    for (const extra of EXTRA_TABLES) {
      await target.query(`truncate table "${extra.schema}"."${extra.table}" cascade`);
    }

    // Tables hors `public` d'abord : `public.users` en dépend.
    for (const extra of EXTRA_TABLES) {
      const sourceCols = await listColumns(source, extra.table, extra.schema);
      const targetCols = await listColumns(target, extra.table, extra.schema);
      const shared = sourceCols.filter((c) => targetCols.includes(c));
      if (!shared.length) continue;
      const colList = shared.map((c) => `"${c}"`).join(", ");
      const { rows } = await source.query(
        `select ${colList} from "${extra.schema}"."${extra.table}"`,
      );
      const jsonCols = new Set(
        (
          await source.query<{ column_name: string }>(
            `select column_name from information_schema.columns
             where table_schema = $1 and table_name = $2 and data_type in ('json', 'jsonb')`,
            [extra.schema, extra.table],
          )
        ).rows.map((r) => r.column_name),
      );
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
        const values: unknown[] = [];
        const tuples = batch.map((row) => {
          const placeholders = shared.map((c) => {
            const raw = (row as Record<string, unknown>)[c];
            values.push(jsonCols.has(c) && raw !== null && typeof raw === "object" ? JSON.stringify(raw) : raw);
            return `$${values.length}`;
          });
          return `(${placeholders.join(", ")})`;
        });
        if (tuples.length) {
          await target.query(
            `insert into "${extra.schema}"."${extra.table}" (${colList}) values ${tuples.join(", ")}`,
            values,
          );
        }
      }
      process.stdout.write(`  ${extra.schema}.${extra.table}: ${rows.length}\n`);
    }

    for (const p of plan) {
      if (p.source === 0) continue;
      const sourceCols = await listColumns(source, p.table);
      const targetCols = await listColumns(target, p.table);
      const shared = sourceCols.filter((c) => targetCols.includes(c));
      const colList = shared.map((c) => `"${c}"`).join(", ");

      const { rows } = await source.query(`select ${colList} from "${p.table}"`);
      if (!rows.length) continue;

      /* `pg` désérialise déjà les colonnes `json`/`jsonb` en objets JS : les
         renvoyer tels quels les ferait passer pour des tableaux de valeurs
         (`[object Object]`) et PostgreSQL refuserait le type. On les
         re-sérialise avant l'envoi. */
      const jsonCols = new Set(
        (
          await source.query<{ column_name: string }>(
            `select column_name from information_schema.columns
             where table_schema = 'public' and table_name = $1
               and data_type in ('json', 'jsonb')`,
            [p.table],
          )
        ).rows.map((r) => r.column_name),
      );

      // Insertion par lots : une seule requête par paquet de 500 lignes,
      // pour éviter 1 aller-retour par ligne sur une base distante.
      const BATCH = 500;
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        const values: unknown[] = [];
        const tuples = batch.map((row) => {
          const placeholders = shared.map((c) => {
            const raw = (row as Record<string, unknown>)[c];
            const value =
              jsonCols.has(c) && raw !== null && typeof raw === "object"
                ? JSON.stringify(raw)
                : raw;
            values.push(value);
            return `$${values.length}`;
          });
          return `(${placeholders.join(", ")})`;
        });
        await target.query(
          `insert into "${p.table}" (${colList}) values ${tuples.join(", ")}`,
          values,
        );
      }
      process.stdout.write(`  ${p.table}: ${rows.length}\n`);
    }

    /* Aucune séquence à réaligner : toutes les clés primaires sont des UUID
       générés côté application. Le bloc de `setval` qui vivait ici échouait
       sur une jointure vide et annulait la transaction entière. */

    for (const t of tables) {
      await target.query(`alter table "${t}" enable trigger user`);
    }
    for (const extra of EXTRA_TABLES) {
      await target.query(
        `alter table "${extra.schema}"."${extra.table}" enable trigger user`,
      );
    }

    await target.query("commit");
  } catch (error) {
    await target.query("rollback");
    throw error;
  }

  console.log("\nVérification après import :");
  let ok = true;
  for (const p of plan) {
    const now = await countRows(target, p.table);
    const match = now === p.source;
    if (!match) ok = false;
    if (!match) console.log(`  ÉCART ${p.table}: attendu ${p.source}, obtenu ${now}`);
  }
  console.log(ok ? "  Toutes les tables correspondent à la source." : "  Des écarts subsistent.");

  await source.end();
  await target.end();
  if (!ok) process.exitCode = 1;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nÉCHEC : ${message}`);
  process.exit(1);
});
