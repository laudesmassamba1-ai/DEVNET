import { loadRestSchema, type RestForeignKey, type RestTable } from "./schema";

export type RestRow = Record<string, unknown>;
export type RestQuery = <T extends RestRow = RestRow>(
  sql: string,
  values?: unknown[],
) => Promise<T[]>;

export interface RestInput {
  table: string;
  method: string;
  searchParams: URLSearchParams;
  body: unknown;
  prefer: string;
  accept: string;
  query: RestQuery;
}

export interface RestOutput {
  rows: RestRow[] | null;
  count: number | null;
  single: boolean;
}

export class RestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: string | null = null,
  ) {
    super(message);
    this.name = "RestError";
  }
}

const RESERVED = new Set([
  "select",
  "order",
  "limit",
  "offset",
  "on_conflict",
  "columns",
  "or",
  "and",
  "not",
]);

const EMBED_RE =
  /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)(?:!([A-Za-z_][A-Za-z0-9_]*))?\s*\(([^)]*)\)/g;

function quote(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function splitTopLevel(input: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char === '"' && input[i - 1] !== "\\") quoted = !quoted;
    if (!quoted) {
      if (char === "(" || char === "{") depth += 1;
      else if (char === ")" || char === "}") depth -= 1;
      else if (char === separator && depth === 0) {
        parts.push(current.trim());
        current = "";
        continue;
      }
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function decodeValue(raw: string): string | null {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (value === "null") return null;
  return value;
}

function decodeArray(raw: string): unknown[] {
  const value = raw.trim();
  if (!value.startsWith("{") || !value.endsWith("}")) return [decodeValue(value)];
  const inner = value.slice(1, -1);
  if (!inner.trim()) return [];
  return splitTopLevel(inner, ",").map(decodeValue);
}

function requireTable(schemaTables: Map<string, RestTable>, name: string): RestTable {
  const table = schemaTables.get(name);
  if (!table) throw new RestError(404, "42P01", `relation "public.${name}" does not exist`);
  return table;
}

function requireColumn(table: RestTable, name: string): string {
  if (!table.columns.has(name)) {
    throw new RestError(400, "42703", `column "${name}" does not exist on "${table.name}"`);
  }
  return name;
}

interface Embed {
  alias: string;
  table: string;
  constraint: string | null;
  columns: string[] | null;
}

interface Selection {
  base: string[];
  embeds: Embed[];
  allColumns: boolean;
}

function parseSelection(input: string | null): Selection {
  if (!input) return { base: [], embeds: [], allColumns: true };
  const embeds: Embed[] = [];
  const rest = input.replace(EMBED_RE, (_m, alias: string, table: string, constraint: string, columns: string) => {
    embeds.push({
      alias,
      table,
      constraint: constraint || null,
      columns: columns.trim() ? columns.split(",").map((c) => c.trim()).filter(Boolean) : null,
    });
    return "";
  });

  const base: string[] = [];
  let allColumns = false;
  for (const part of rest.split(",")) {
    const value = part.trim();
    if (!value) continue;
    if (value === "*") allColumns = true;
    else base.push(value);
  }
  return { base, embeds, allColumns };
}

function findForeignKey(
  schemaForeignKeys: RestForeignKey[],
  sourceTable: string,
  targetTable: string,
  constraint: string | null,
): RestForeignKey {
  const matches = schemaForeignKeys.filter((fk) => {
    if (fk.sourceTable !== sourceTable || fk.targetTable !== targetTable) return false;
    return constraint ? fk.name === constraint : true;
  });
  if (matches.length === 0) {
    throw new RestError(
      400,
      "PGRST200",
      `no relationship found between "${sourceTable}" and "${targetTable}"`,
    );
  }
  if (!constraint && matches.length > 1) {
    throw new RestError(
      400,
      "PGRST201",
      `more than one relationship found between "${sourceTable}" and "${targetTable}"`,
    );
  }
  return matches[0];
}

function baseColumnExpression(table: RestTable, item: string): string {
  const colon = item.indexOf(":");
  const source = colon === -1 ? item : item.slice(colon + 1).trim();
  const alias = colon === -1 ? source : item.slice(0, colon).trim();
  requireColumn(table, source);
  return alias === source
    ? `b.${quote(source)}`
    : `b.${quote(source)} as ${quote(alias)}`;
}

function embedParts(
  schemaTables: Map<string, RestTable>,
  schemaForeignKeys: RestForeignKey[],
  sourceTable: RestTable,
  embed: Embed,
): { select: string; join: string } {
  const target = requireTable(schemaTables, embed.table);
  const fk = findForeignKey(schemaForeignKeys, sourceTable.name, target.name, embed.constraint);
  const columns = embed.columns ?? [...target.columns.keys()];
  for (const column of columns) requireColumn(target, column);
  const object = columns
    .map((column) => `'${column.replace(/'/g, "''")}', r.${quote(column)}`)
    .join(", ");
  const join = fk.sourceColumns
    .map((source, index) => `r.${quote(fk.targetColumns[index])} = b.${quote(source)}`)
    .join(" and ");
  const alias = `${embed.alias}_embed`;
  return {
    select: `${quote(alias)}.${quote(embed.alias)}`,
    join:
      `left join lateral (` +
      `select jsonb_build_object(${object}) as ${quote(embed.alias)} ` +
      `from public.${quote(target.name)} r where ${join} limit 1` +
      `) ${quote(alias)} on true`,
  };
}

function selectSql(
  schemaTables: Map<string, RestTable>,
  schemaForeignKeys: RestForeignKey[],
  table: RestTable,
  selection: Selection,
): { select: string; joins: string } {
  const parts: string[] = [];
  if (selection.allColumns) parts.push("b.*");
  for (const item of selection.base) parts.push(baseColumnExpression(table, item));
  const joins: string[] = [];
  for (const embed of selection.embeds) {
    const part = embedParts(schemaTables, schemaForeignKeys, table, embed);
    parts.push(part.select);
    joins.push(part.join);
  }
  return {
    select: parts.length > 0 ? parts.join(", ") : "b.*",
    joins: joins.join(" "),
  };
}

interface FilterContext {
  table: RestTable;
  values: unknown[];
  clauses: string[];
}

function addValue(context: FilterContext, value: unknown): string {
  context.values.push(value);
  return `$${context.values.length}`;
}

function filterClause(
  context: FilterContext,
  column: string,
  operator: string,
  value: string,
): string {
  requireColumn(context.table, column);
  const ref = `b.${quote(column)}`;
  switch (operator) {
    case "eq":
      if (value === "null") return `${ref} is null`;
      return `${ref} = ${addValue(context, decodeValue(value))}`;
    case "neq":
      if (value === "null") return `${ref} is not null`;
      return `${ref} <> ${addValue(context, decodeValue(value))}`;
    case "gt":
      return `${ref} > ${addValue(context, decodeValue(value))}`;
    case "gte":
      return `${ref} >= ${addValue(context, decodeValue(value))}`;
    case "lt":
      return `${ref} < ${addValue(context, decodeValue(value))}`;
    case "lte":
      return `${ref} <= ${addValue(context, decodeValue(value))}`;
    case "like":
      return `${ref} like ${addValue(context, decodeValue(value))}`;
    case "ilike":
      return `${ref} ilike ${addValue(context, decodeValue(value))}`;
    case "is": {
      const lowered = value.toLowerCase();
      if (lowered === "null") return `${ref} is null`;
      if (lowered === "true") return `${ref} is true`;
      if (lowered === "false") return `${ref} is false`;
      throw new RestError(400, "PGRST100", `invalid is filter: ${value}`);
    }
    case "in": {
      const inner = value.trim().replace(/^\(/, "").replace(/\)$/, "");
      const items = splitTopLevel(inner, ",").map(decodeValue);
      if (items.length === 0) return "false";
      const placeholders = items.map((item) => addValue(context, item));
      return `${ref} in (${placeholders.join(", ")})`;
    }
    case "isdistinct":
      return `${ref} is distinct from ${addValue(context, decodeValue(value))}`;
    case "contains":
    case "cs":
      return `${ref} @> ${addValue(context, decodeArray(value))}`;
    case "containedBy":
    case "cd":
      return `${ref} <@ ${addValue(context, decodeArray(value))}`;
    case "overlaps":
    case "ov":
      return `${ref} && ${addValue(context, decodeArray(value))}`;
    default:
      throw new RestError(400, "PGRST100", `unsupported operator "${operator}"`);
  }
}

function groupClause(context: FilterContext, expression: string, joiner: "and" | "or"): string {
  const inner = expression.trim().replace(/^\(/, "").replace(/\)$/, "");
  const items = splitTopLevel(inner, ",");
  const clauses: string[] = [];
  for (const item of items) {
    let value = item.trim();
    let negate = false;
    if (value.startsWith("not.")) {
      negate = true;
      value = value.slice(4);
    }
    if (value.startsWith("and(")) {
      const clause = groupClause(context, value.slice(4, -1), "and");
      clauses.push(negate ? `not (${clause})` : clause);
      continue;
    }
    if (value.startsWith("or(")) {
      const clause = groupClause(context, value.slice(3, -1), "or");
      clauses.push(negate ? `not (${clause})` : clause);
      continue;
    }
    const first = value.indexOf(".");
    const second = value.indexOf(".", first + 1);
    if (first === -1 || second === -1) {
      throw new RestError(400, "PGRST100", `invalid filter "${item}"`);
    }
    let column = value.slice(0, first);
    let operator = value.slice(first + 1, second);
    const rest = value.slice(second + 1);
    let itemNegate = negate;
    if (column === "not") {
      itemNegate = true;
      const next = operator.indexOf(".");
      if (next === -1) throw new RestError(400, "PGRST100", `invalid filter "${item}"`);
      column = operator.slice(0, next);
      operator = operator.slice(next + 1);
    }
    if (operator.startsWith("not.")) {
      itemNegate = true;
      operator = operator.slice(4);
    }
    const clause = filterClause(context, column, operator, rest);
    clauses.push(itemNegate ? `not (${clause})` : clause);
  }
  if (clauses.length === 0) return "true";
  return clauses.join(` ${joiner} `);
}

function whereSql(context: FilterContext, searchParams: URLSearchParams): string {
  for (const [key, value] of searchParams.entries()) {
    if (RESERVED.has(key)) continue;
    if (key.startsWith("__")) continue;
    let negate = false;
    let operator = value;
    if (operator.startsWith("not.")) {
      negate = true;
      operator = operator.slice(4);
    }
    const dot = operator.indexOf(".");
    if (dot === -1) throw new RestError(400, "PGRST100", `invalid filter "${key}=${value}"`);
    let op = operator.slice(0, dot);
    const rest = operator.slice(dot + 1);
    if (op === "not") {
      negate = true;
      const next = rest.indexOf(".");
      op = rest.slice(0, next);
      const clause = filterClause(context, key, op, rest.slice(next + 1));
      context.clauses.push(negate ? `not (${clause})` : clause);
      continue;
    }
    const clause = filterClause(context, key, op, rest);
    context.clauses.push(negate ? `not (${clause})` : clause);
  }

  const or = searchParams.get("or");
  if (or) context.clauses.push(`(${groupClause(context, or, "or")})`);
  const and = searchParams.get("and");
  if (and) context.clauses.push(`(${groupClause(context, and, "and")})`);
  const not = searchParams.get("not");
  if (not) context.clauses.push(`not (${groupClause(context, not, "and")})`);

  return context.clauses.length > 0 ? `where ${context.clauses.join(" and ")}` : "";
}

function orderSql(table: RestTable, searchParams: URLSearchParams): string {
  const order = searchParams.get("order");
  if (!order) return "";
  const parts: string[] = [];
  for (const item of splitTopLevel(order, ",")) {
    const segments = item.split(".");
    const column = segments[0];
    requireColumn(table, column);
    const direction = segments.includes("desc") ? "desc" : "asc";
    const nulls = segments.includes("nullsfirst")
      ? " nulls first"
      : segments.includes("nullslast")
        ? " nulls last"
        : "";
    parts.push(`b.${quote(column)} ${direction}${nulls}`);
  }
  return parts.length > 0 ? `order by ${parts.join(", ")}` : "";
}

function limitSql(searchParams: URLSearchParams): string {
  const rawLimit = searchParams.get("limit");
  const rawOffset = searchParams.get("offset");
  const parts: string[] = [];
  if (rawLimit !== null) {
    const limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 0) throw new RestError(400, "PGRST100", "invalid limit");
    parts.push(`limit ${Math.min(limit, 5_000)}`);
  }
  if (rawOffset !== null) {
    const offset = Number(rawOffset);
    if (!Number.isInteger(offset) || offset < 0) throw new RestError(400, "PGRST100", "invalid offset");
    parts.push(`offset ${offset}`);
  }
  return parts.join(" ");
}

function wantsRepresentation(prefer: string): boolean {
  return prefer.split(",").map((part) => part.trim()).includes("return=representation");
}

function wantsCount(prefer: string): boolean {
  return prefer.split(",").map((part) => part.trim()).includes("count=exact");
}

function isSingle(accept: string): boolean {
  return accept.includes("vnd.pgrst.object+json");
}

function mapError(error: unknown): RestError {
  if (error instanceof RestError) return error;
  const pg = error as { code?: string; message?: string; detail?: string };
  const code = pg.code ?? "PGRST500";
  const message = pg.message ?? "requête impossible";
  if (code === "42501") return new RestError(403, code, message, pg.detail ?? null);
  if (["23505", "23503"].includes(code)) return new RestError(409, code, message, pg.detail ?? null);
  if (["23514", "22P02", "22001", "42703", "42804"].includes(code)) {
    return new RestError(400, code, message, pg.detail ?? null);
  }
  if (code === "42P01") return new RestError(404, code, message, pg.detail ?? null);
  if (code === "53300" || code.startsWith("08")) {
    return new RestError(503, code, "base de données indisponible");
  }
  return new RestError(500, code, message, pg.detail ?? null);
}

async function readRows(query: RestQuery, sql: string, values: unknown[]): Promise<RestRow[]> {
  try {
    return await query<RestRow>(sql, values);
  } catch (error) {
    throw mapError(error);
  }
}

async function countRows(
  query: RestQuery,
  table: RestTable,
  where: string,
  values: unknown[],
): Promise<number> {
  const rows = await readRows(
    query,
    `select count(*)::int as n from public.${quote(table.name)} b ${where}`,
    values,
  );
  return Number(rows[0]?.n ?? 0);
}

function assertWritable(table: RestTable): void {
  if (!["r", "p"].includes(table.kind)) {
    throw new RestError(405, "PGRST105", `relation "${table.name}" is read-only`);
  }
}

function bodyRows(body: unknown): RestRow[] {
  if (Array.isArray(body)) {
    if (body.length === 0) throw new RestError(400, "PGRST102", "empty insert payload");
    if (!body.every((row) => row && typeof row === "object" && !Array.isArray(row))) {
      throw new RestError(400, "PGRST102", "insert payload must contain objects");
    }
    return body as RestRow[];
  }
  if (body && typeof body === "object") return [body as RestRow];
  throw new RestError(400, "PGRST102", "request body must be a JSON object");
}

function mutationColumns(table: RestTable, rows: RestRow[]): string[] {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  for (const column of columns) requireColumn(table, column);
  if (columns.length === 0) throw new RestError(400, "PGRST102", "no columns to write");
  return columns;
}

function onConflictColumns(table: RestTable, searchParams: URLSearchParams): string[] {
  const raw = searchParams.get("on_conflict");
  if (raw) {
    const columns = raw.split(",").map((c) => c.trim()).filter(Boolean);
    for (const column of columns) requireColumn(table, column);
    return columns;
  }
  if (table.primaryKey.length > 0) return table.primaryKey;
  throw new RestError(400, "PGRST102", `no primary key on "${table.name}" for upsert`);
}

function mutationRepresentationSql(
  schemaTables: Map<string, RestTable>,
  schemaForeignKeys: RestForeignKey[],
  table: RestTable,
  selection: Selection,
  mutationSql: string,
): string {
  const selectionSql = selectSql(schemaTables, schemaForeignKeys, table, selection);
  return (
    `with mutated as (${mutationSql} returning b.*) ` +
    `select ${selectionSql.select} from mutated b ${selectionSql.joins}`
  ).trim();
}

export async function executeRest(input: RestInput): Promise<RestOutput> {
  const schema = await loadRestSchema();
  const table = requireTable(schema.tables, input.table);
  const method = input.method.toUpperCase();
  const selection = parseSelection(input.searchParams.get("select"));
  const filter: FilterContext = { table, values: [], clauses: [] };
  const where = whereSql(filter, input.searchParams);
  const countWanted = wantsCount(input.prefer);

  try {
    if (method === "GET" || method === "HEAD") {
      const selectionSql = selectSql(schema.tables, schema.foreignKeys, table, selection);
      const sql =
        `select ${selectionSql.select} from public.${quote(table.name)} b ` +
        `${selectionSql.joins} ${where} ${orderSql(table, input.searchParams)} ` +
        `${limitSql(input.searchParams)}`.trim();
      const rows = await readRows(input.query, sql, filter.values);
      const count = countWanted ? await countRows(input.query, table, where, filter.values) : null;
      return { rows: method === "HEAD" ? null : rows, count, single: isSingle(input.accept) };
    }

    assertWritable(table);

    if (method === "POST") {
      const rows = bodyRows(input.body);
      const columns = mutationColumns(table, rows);
      const values: unknown[] = [];
      const tuples = rows.map((row) => {
        const tuple = columns.map((column) => {
          values.push(row[column] ?? null);
          return `$${values.length}`;
        });
        return `(${tuple.join(", ")})`;
      });
      const ignore = input.prefer.includes("resolution=ignore-duplicates");
      const merge = input.prefer.includes("resolution=merge-duplicates");
      const conflict = ignore || merge ? onConflictColumns(table, input.searchParams) : null;
      let conflictSql = "";
      if (ignore && conflict) {
        conflictSql = ` on conflict (${conflict.map(quote).join(", ")}) do nothing`;
      } else if (conflict) {
        const updates = columns
          .filter((column) => !conflict.includes(column))
          .map((column) => `${quote(column)} = excluded.${quote(column)}`);
        conflictSql = ` on conflict (${conflict.map(quote).join(", ")}) ${
          updates.length > 0 ? `do update set ${updates.join(", ")}` : "do nothing"
        }`;
      }
      const mutationSql =
        `insert into public.${quote(table.name)} as b (${columns.map(quote).join(", ")}) ` +
        `values ${tuples.join(", ")}${conflictSql}`.trim();
      const sql = wantsRepresentation(input.prefer)
        ? mutationRepresentationSql(schema.tables, schema.foreignKeys, table, selection, mutationSql)
        : mutationSql;
      const inserted = wantsRepresentation(input.prefer)
        ? await readRows(input.query, sql, values)
        : null;
      if (!wantsRepresentation(input.prefer)) await readRows(input.query, sql, values);
      return { rows: inserted, count: null, single: isSingle(input.accept) };
    }

    if (method === "PATCH" || method === "PUT") {
      const [patch] = bodyRows(input.body);
      const columns = mutationColumns(table, [patch]);
      const values = [...filter.values];
      const set = columns.map((column) => {
        values.push(patch[column] ?? null);
        return `${quote(column)} = $${values.length}`;
      });
      const mutationSql =
        `update public.${quote(table.name)} as b set ${set.join(", ")} ${where}`.trim();
      const sql = wantsRepresentation(input.prefer)
        ? mutationRepresentationSql(schema.tables, schema.foreignKeys, table, selection, mutationSql)
        : mutationSql;
      const updated = wantsRepresentation(input.prefer)
        ? await readRows(input.query, sql, values)
        : null;
      if (!wantsRepresentation(input.prefer)) await readRows(input.query, sql, values);
      return { rows: updated, count: null, single: isSingle(input.accept) };
    }

    if (method === "DELETE") {
      const mutationSql = `delete from public.${quote(table.name)} as b ${where}`.trim();
      const sql = wantsRepresentation(input.prefer)
        ? mutationRepresentationSql(schema.tables, schema.foreignKeys, table, selection, mutationSql)
        : mutationSql;
      const deleted = wantsRepresentation(input.prefer)
        ? await readRows(input.query, sql, filter.values)
        : null;
      if (!wantsRepresentation(input.prefer)) await readRows(input.query, sql, filter.values);
      return { rows: deleted, count: null, single: isSingle(input.accept) };
    }

    throw new RestError(405, "PGRST105", `method ${method} not allowed`);
  } catch (error) {
    throw mapError(error);
  }
}

export async function executeRpc(
  name: string,
  body: unknown,
  query: RestQuery,
): Promise<RestOutput> {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new RestError(400, "PGRST202", "nom de fonction invalide");
  }
  if (name !== "admin_search_accounts") {
    throw new RestError(404, "PGRST202", `function public.${name} does not exist`);
  }
  const args = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const term = typeof args.term === "string" ? args.term : "";
  try {
    const rows = await query<RestRow>(
      "select * from public.admin_search_accounts($1)",
      [term],
    );
    return { rows, count: null, single: false };
  } catch (error) {
    throw mapError(error);
  }
}
