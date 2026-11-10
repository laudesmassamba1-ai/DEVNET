import { getPostgresPool } from "@/platform/infrastructure/postgres/pool";

export interface RestColumn {
  name: string;
  type: string;
  udt: string;
  notNull: boolean;
  attnum: number;
}

export interface RestTable {
  name: string;
  kind: string;
  columns: Map<string, RestColumn>;
  primaryKey: string[];
}

export interface RestForeignKey {
  name: string;
  sourceTable: string;
  targetTable: string;
  sourceColumns: string[];
  targetColumns: string[];
}

export interface RestSchema {
  tables: Map<string, RestTable>;
  foreignKeys: RestForeignKey[];
}

interface ColumnRow {
  table_name: string;
  relkind: string;
  attname: string;
  type: string;
  udt: string;
  attnotnull: boolean;
  attnum: number;
}

interface KeyRow {
  table_name: string;
  attname: string;
}

interface ForeignKeyRow {
  conname: string;
  source_table: string;
  target_table: string;
  conkey: number[];
  confkey: number[];
}

const SCHEMA_TTL_MS = 60_000;
let cached: { schema: RestSchema; at: number } | null = null;

function byAttnum(table: RestTable): Map<number, string> {
  const result = new Map<number, string>();
  for (const column of table.columns.values()) result.set(column.attnum, column.name);
  return result;
}

export async function loadRestSchema(): Promise<RestSchema> {
  if (cached && Date.now() - cached.at < SCHEMA_TTL_MS) return cached.schema;

  const pool = getPostgresPool();
  const [columnResult, keyResult, foreignKeyResult] = await Promise.all([
    pool.query<ColumnRow>(
      `select c.relname as table_name,
              c.relkind::text as relkind,
              a.attname,
              format_type(a.atttypid, a.atttypmod) as type,
              t.typname as udt,
              a.attnotnull,
              a.attnum
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
         join pg_type t on t.oid = a.atttypid
        where n.nspname = 'public'
          and c.relkind in ('r', 'v', 'm', 'p')
          and not c.relispartition
        order by c.relname, a.attnum`,
    ),
    pool.query<KeyRow>(
      `select c.relname as table_name, a.attname
         from pg_constraint con
         join pg_class c on c.oid = con.conrelid
         join pg_namespace n on n.oid = c.relnamespace
         cross join lateral unnest(con.conkey) with ordinality as k(attnum, ord)
         join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
        where n.nspname = 'public'
          and con.contype = 'p'
        order by c.relname, k.ord`,
    ),
    pool.query<ForeignKeyRow>(
      `select con.conname,
              c.relname as source_table,
              t.relname as target_table,
              con.conkey,
              con.confkey
         from pg_constraint con
         join pg_class c on c.oid = con.conrelid
         join pg_class t on t.oid = con.confrelid
         join pg_namespace n on n.oid = c.relnamespace
         join pg_namespace tn on tn.oid = t.relnamespace
        where n.nspname = 'public'
          and tn.nspname = 'public'
          and con.contype = 'f'`,
    ),
  ]);

  const tables = new Map<string, RestTable>();
  for (const row of columnResult.rows) {
    let table = tables.get(row.table_name);
    if (!table) {
      table = {
        name: row.table_name,
        kind: row.relkind,
        columns: new Map(),
        primaryKey: [],
      };
      tables.set(row.table_name, table);
    }
    table.columns.set(row.attname, {
      name: row.attname,
      type: row.type,
      udt: row.udt,
      notNull: row.attnotnull,
      attnum: row.attnum,
    });
  }

  for (const row of keyResult.rows) {
    tables.get(row.table_name)?.primaryKey.push(row.attname);
  }

  const foreignKeys: RestForeignKey[] = [];
  for (const row of foreignKeyResult.rows) {
    const source = tables.get(row.source_table);
    const target = tables.get(row.target_table);
    if (!source || !target) continue;
    const sourceNames = byAttnum(source);
    const targetNames = byAttnum(target);
    const sourceColumns = row.conkey.map((n) => sourceNames.get(n)).filter(Boolean) as string[];
    const targetColumns = row.confkey.map((n) => targetNames.get(n)).filter(Boolean) as string[];
    if (sourceColumns.length !== targetColumns.length || sourceColumns.length === 0) continue;
    foreignKeys.push({
      name: row.conname,
      sourceTable: source.name,
      targetTable: target.name,
      sourceColumns,
      targetColumns,
    });
  }

  const schema = { tables, foreignKeys };
  cached = { schema, at: Date.now() };
  return schema;
}

export function clearRestSchemaCache(): void {
  cached = null;
}
