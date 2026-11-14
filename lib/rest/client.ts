/**
 * Client HTTP maison — remplace `@supabase/supabase-js` sans changer les
 * appelants.
 *
 * Deux surfaces seulement :
 *
 *  · `from(table)` construit une requête PostgREST-like et l'envoie à
 *    `/api/rest/<table>`, qui l'exécute sur PostgreSQL avec l'identité de
 *    la session (`withUser`) ou sans identité (`withAnon`).
 *  · `auth` parle aux routes `/api/auth/*`, qui posent un cookie de
 *    session HTTP-only. Le navigateur ne voit jamais le jeton.
 *
 * Le but n'est pas de réimplémenter Supabase : c'est de garder le code
 * applicatif tel quel le temps de retirer la dépendance, puis de laisser
 * les écrans migrer vers des services explicites.
 */

export type Row = Record<string, unknown>;

export interface PostgrestError {
  name: string;
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

/** Charge utile d'un événement temps réel, sans `any` : chaque appelant
 * vérifie les champs qu'il consomme. */
export interface RealtimePayload<T = DynamicRow> {
  new: T;
  old: T;
  eventType?: string;
  [key: string]: unknown;
}

/**
 * Ligne non typée par l'appelant. Le client reste une passerelle de
 * compatibilité : les écrans qui connaissent leur schéma passent leur type
 * (`from<Post>`), les autres reçoivent cette ligne permissive. La dérogation
 * est isolée ici au lieu de couvrir tout le fichier.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DynamicRow = any;

function pgError(message: string, code?: string): PostgrestError {
  return { name: "PostgrestError", message, code };
}

export interface QueryResult<T = DynamicRow> {
  data: T | null;
  error: PostgrestError | null;
  count: number | null;
}

export interface AuthUser {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
}

export interface AuthSession {
  user: AuthUser;
  expires_at?: number;
}

type AuthEvent = "INITIAL_SESSION" | "SIGNED_IN" | "SIGNED_OUT" | "USER_UPDATED";
type AuthListener = (event: AuthEvent, session: AuthSession | null) => void;

const authListeners = new Set<AuthListener>();

function notifyAuth(event: AuthEvent, session: AuthSession | null): void {
  for (const listener of authListeners) listener(event, session);
}

function siteBase(): string {
  if (typeof window !== "undefined") return window.location.origin;
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  return vercel ? `https://${vercel.replace(/\/+$/, "")}` : "http://localhost:3000";
}

function apiUrl(path: string): string {
  return `${siteBase()}${path}`;
}

function encodeValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "null";
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") return String(value);
  const text = String(value);
  return /[",()]/.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text;
}

function encodeArray(value: unknown): string {
  const items = Array.isArray(value) ? value : [value];
  return `{${items.map((item) => encodeValue(item)).join(",")}}`;
}

async function parseError(response: Response): Promise<PostgrestError> {
  try {
    const body = (await response.json()) as Partial<PostgrestError> & {
      error?: string;
    };
    return {
      name: "PostgrestError",
      message: body.message ?? body.error ?? `HTTP ${response.status}`,
      code: body.code,
      details: body.details ?? null,
      hint: body.hint ?? null,
    };
  } catch {
    return pgError(`HTTP ${response.status}`, String(response.status));
  }
}

function contentRangeCount(header: string | null): number | null {
  if (!header) return null;
  const slash = header.lastIndexOf("/");
  if (slash === -1) return null;
  const raw = header.slice(slash + 1).trim();
  if (!raw || raw === "*") return null;
  const value = Number(raw);
  return Number.isInteger(value) ? value : null;
}

type SingleMode = "single" | "maybeSingle" | null;

export class RestQueryBuilder<T = DynamicRow> implements PromiseLike<QueryResult<T>> {
  private method: "GET" | "HEAD" | "POST" | "PATCH" | "DELETE" = "GET";
  private selectSpec: string | null = null;
  private filters: string[] = [];
  private orderParts: string[] = [];
  private limitValue: number | null = null;
  private offsetValue: number | null = null;
  private singleMode: SingleMode = null;
  private countMode = false;
  private headOnly = false;
  private returning = false;
  private payload: unknown = undefined;
  private onConflict: string | null = null;
  private ignoreDuplicates = false;
  private mergeDuplicates = false;

  constructor(readonly table: string) {}

  select(
    columns = "*",
    options: { count?: "exact" | "planned" | "estimated"; head?: boolean } = {},
  ): this {
    this.selectSpec = columns;
    if (this.method === "GET" || this.method === "HEAD") {
      if (options.head) {
        this.method = "HEAD";
        this.headOnly = true;
      }
      if (options.count) this.countMode = true;
    } else {
      this.returning = true;
    }
    return this;
  }

  insert(values: unknown): this {
    this.method = "POST";
    this.payload = values;
    return this;
  }

  update(values: unknown): this {
    this.method = "PATCH";
    this.payload = values;
    return this;
  }

  upsert(
    values: unknown,
    options: { onConflict?: string; ignoreDuplicates?: boolean } = {},
  ): this {
    this.method = "POST";
    this.payload = values;
    this.onConflict = options.onConflict ?? null;
    this.ignoreDuplicates = options.ignoreDuplicates === true;
    this.mergeDuplicates = !this.ignoreDuplicates;
    return this;
  }

  delete(): this {
    this.method = "DELETE";
    return this;
  }

  private filter(column: string, operator: string, value: unknown): this {
    this.filters.push(`${column}=${operator}.${encodeValue(value)}`);
    return this;
  }

  eq(column: string, value: unknown): this {
    return this.filter(column, "eq", value);
  }

  neq(column: string, value: unknown): this {
    return this.filter(column, "neq", value);
  }

  gt(column: string, value: unknown): this {
    return this.filter(column, "gt", value);
  }

  gte(column: string, value: unknown): this {
    return this.filter(column, "gte", value);
  }

  lt(column: string, value: unknown): this {
    return this.filter(column, "lt", value);
  }

  lte(column: string, value: unknown): this {
    return this.filter(column, "lte", value);
  }

  like(column: string, value: string): this {
    return this.filter(column, "like", value);
  }

  ilike(column: string, value: string): this {
    return this.filter(column, "ilike", value);
  }

  is(column: string, value: null | boolean): this {
    this.filters.push(`${column}=is.${value === null ? "null" : value}`);
    return this;
  }

  in(column: string, values: readonly unknown[]): this {
    if (values.length === 0) {
      this.filters.push(`${column}=in.()`);
      return this;
    }
    this.filters.push(
      `${column}=in.(${values.map((value) => encodeValue(value)).join(",")})`,
    );
    return this;
  }

  contains(column: string, value: unknown): this {
    this.filters.push(`${column}=cs.${encodeArray(value)}`);
    return this;
  }

  containedBy(column: string, value: unknown): this {
    this.filters.push(`${column}=cd.${encodeArray(value)}`);
    return this;
  }

  overlaps(column: string, value: unknown): this {
    this.filters.push(`${column}=ov.${encodeArray(value)}`);
    return this;
  }

  isDistinct(column: string, value: unknown): this {
    return this.filter(column, "isdistinct", value);
  }

  or(expression: string): this {
    this.filters.push(`or=(${expression})`);
    return this;
  }

  not(column: string, operator: string, value: unknown): this {
    this.filters.push(`${column}=not.${operator}.${encodeValue(value)}`);
    return this;
  }

  match(criteria: Row): this {
    for (const [column, value] of Object.entries(criteria)) this.eq(column, value);
    return this;
  }

  order(
    column: string,
    options: { ascending?: boolean; nullsFirst?: boolean } = {},
  ): this {
    const direction = options.ascending === false ? "desc" : "asc";
    const nulls =
      options.nullsFirst === undefined
        ? ""
        : `.${options.nullsFirst ? "nullsfirst" : "nullslast"}`;
    this.orderParts.push(`${column}.${direction}${nulls}`);
    return this;
  }

  limit(value: number): this {
    this.limitValue = value;
    return this;
  }

  range(from: number, to: number): this {
    this.limitValue = Math.max(0, to - from + 1);
    this.offsetValue = Math.max(0, from);
    return this;
  }

  single(): this {
    this.singleMode = "single";
    return this;
  }

  maybeSingle(): this {
    this.singleMode = "maybeSingle";
    return this;
  }

  private url(): string {
    const params = new URLSearchParams();
    if (this.selectSpec) params.set("select", this.selectSpec);
    for (const filter of this.filters) {
      const separator = filter.indexOf("=");
      const key = filter.slice(0, separator);
      const value = filter.slice(separator + 1);
      params.append(key, value);
    }
    if (this.orderParts.length > 0) params.set("order", this.orderParts.join(","));
    if (this.limitValue !== null) params.set("limit", String(this.limitValue));
    if (this.offsetValue !== null) params.set("offset", String(this.offsetValue));
    if (this.onConflict) params.set("on_conflict", this.onConflict);
    const query = params.toString();
    const path = this.table.split("/").map(encodeURIComponent).join("/");
    return apiUrl(`/api/rest/${path}${query ? `?${query}` : ""}`);
  }

  private headers(): HeadersInit {
    const headers: Record<string, string> = { Accept: "application/json" };
    const prefer: string[] = [];
    if (this.countMode) prefer.push("count=exact");
    if (this.returning) prefer.push("return=representation");
    if (this.ignoreDuplicates) prefer.push("resolution=ignore-duplicates");
    if (this.mergeDuplicates) prefer.push("resolution=merge-duplicates");
    if (prefer.length > 0) headers.Prefer = prefer.join(",");
    if (this.singleMode === "single") {
      headers.Accept = "application/vnd.pgrst.object+json";
    }
    if (this.payload !== undefined) headers["Content-Type"] = "application/json";
    return headers;
  }

  async run(): Promise<QueryResult<T>> {
    let response: Response;
    try {
      response = await fetch(this.url(), {
        method: this.method,
        headers: this.headers(),
        body: this.payload === undefined ? undefined : JSON.stringify(this.payload),
        credentials: "same-origin",
        cache: "no-store",
      });
    } catch (error) {
      return {
        data: null,
        error: pgError(
          error instanceof Error ? error.message : "Réseau indisponible",
          "NETWORK",
        ),
        count: null,
      };
    }

    const count = contentRangeCount(response.headers.get("Content-Range"));

    if (!response.ok) {
      return { data: null, error: await parseError(response), count };
    }

    if (this.method === "HEAD" || response.status === 204) {
      return { data: null, error: null, count };
    }

    let body: unknown = null;
    if (response.status !== 205) {
      const text = await response.text();
      body = text ? JSON.parse(text) : null;
    }

    if (this.singleMode === "maybeSingle") {
      const rows = Array.isArray(body) ? (body as T[]) : body ? [body as T] : [];
      return { data: rows[0] ?? null, error: null, count };
    }

    return { data: body as T, error: null, count };
  }

  then<TResult1 = QueryResult<T>, TResult2 = never>(
    onfulfilled?:
      | ((value: QueryResult<T>) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected);
  }
}

interface StoredChannelHandler {
  kind: "broadcast" | "postgres_changes";
  event: string;
  table: string | null;
  filter: string | null;
  callback: (payload: RealtimePayload<DynamicRow>) => void;
}

interface SnapshotRow {
  json: string;
  row: Record<string, unknown>;
}

/**
 * Intervalle de polling des changements PostgreSQL.
 *
 * Le serveur est serverless : pas de WebSocket durable. On interroge donc la
 * même gateway REST que les écrans, avec la session et la RLS, et on ne
 * diffuse que les différences. Un canal sans `postgres_changes` ne paie rien.
 */
const POSTGRES_POLL_MS = 2_500;

/** Colonnes minimales pour les tables dont les charges utiles sont lourdes. */
const POLL_COLUMNS: Record<string, string> = {
  git_files: "id,path,branch,updated_by,updated_at",
  notifications: "id,recipient_id,created_at,read_at",
  project_sessions: "id,project_id,updated_at",
};

class LocalChannel {
  private handlers: StoredChannelHandler[] = [];
  private broadcastChannel: BroadcastChannel | null = null;
  private subscribed = false;
  private pollers = new Map<string, ReturnType<typeof setInterval>>();
  private snapshots = new Map<string, Map<string, SnapshotRow>>();
  private initialized = new Set<string>();

  constructor(private readonly name: string) {}

  on<T = DynamicRow>(
    kind: "broadcast" | "postgres_changes",
    filter:
      | {
          event?: string;
          schema?: string;
          table?: string;
          filter?: string;
        }
      | string,
    callback: (payload: RealtimePayload<T>) => void,
  ): this {
    const options = typeof filter === "string" ? null : filter;
    this.handlers.push({
      kind,
      event: typeof filter === "string" ? filter : (filter.event ?? "*"),
      table: options?.table ?? null,
      filter: options?.filter ?? null,
      callback: callback as (payload: RealtimePayload<DynamicRow>) => void,
    });
    return this;
  }

  subscribe(callback?: (status: string) => void): this {
    this.subscribed = true;
    if (this.handlers.some((handler) => handler.kind === "broadcast")) {
      if (typeof BroadcastChannel !== "undefined") {
        try {
          this.broadcastChannel = new BroadcastChannel(`devnet:${this.name}`);
          this.broadcastChannel.onmessage = (message) => {
            const data = message.data as { event?: string; payload?: unknown } | null;
            if (!data?.event) return;
            for (const handler of this.handlers) {
              if (handler.kind === "broadcast" && handler.event === data.event) {
                // Un broadcast ne porte pas de ligne `new`/`old` ; le
                // contrat temps réel les réserve aux changements PostgreSQL.
                handler.callback(
                  { payload: data.payload } as unknown as RealtimePayload<DynamicRow>,
                );
              }
            }
          };
        } catch {
          this.broadcastChannel = null;
        }
      }
    }

    for (const handler of this.handlers) {
      if (handler.kind !== "postgres_changes" || !handler.table) continue;
      const key = `${handler.table}|${handler.filter ?? ""}`;
      if (this.pollers.has(key)) continue;
      this.snapshots.set(key, new Map());
      void this.poll(key, handler.table, handler.filter);
      this.pollers.set(
        key,
        setInterval(() => void this.poll(key, handler.table!, handler.filter), POSTGRES_POLL_MS),
      );
    }

    callback?.("SUBSCRIBED");
    return this;
  }

  private async poll(
    key: string,
    table: string,
    filter: string | null,
  ): Promise<void> {
    if (!this.subscribed) return;

    const params = new URLSearchParams({ select: POLL_COLUMNS[table] ?? "*" });
    if (filter) {
      const separator = filter.indexOf("=");
      if (separator === -1) return;
      params.append(filter.slice(0, separator), filter.slice(separator + 1));
    }

    let rows: Array<Record<string, unknown>>;
    try {
      const response = await fetch(
        apiUrl(`/api/rest/${table.split("/").map(encodeURIComponent).join("/")}?${params}`),
        { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } },
      );
      if (!response.ok) return;
      const body = (await response.json()) as unknown;
      if (!Array.isArray(body)) return;
      rows = body as Array<Record<string, unknown>>;
    } catch {
      return;
    }

    const previous = this.snapshots.get(key) ?? new Map<string, SnapshotRow>();
    const next = new Map<string, SnapshotRow>();
    for (const row of rows) {
      const rawId = row.id;
      const rowKey = rawId === undefined || rawId === null ? JSON.stringify(row) : String(rawId);
      next.set(rowKey, { json: JSON.stringify(row), row });
    }

    const first = !this.initialized.has(key);
    if (!first) {
      for (const [rowKey, current] of next) {
        const before = previous.get(rowKey);
        if (!before) {
          this.emit(key, table, "INSERT", current.row, {});
        } else if (before.json !== current.json) {
          this.emit(key, table, "UPDATE", current.row, before.row);
        }
      }
      for (const [rowKey, before] of previous) {
        if (!next.has(rowKey)) this.emit(key, table, "DELETE", {}, before.row);
      }
    }

    this.snapshots.set(key, next);
    this.initialized.add(key);
  }

  private emit(
    key: string,
    table: string,
    eventType: "INSERT" | "UPDATE" | "DELETE",
    next: Record<string, unknown>,
    old: Record<string, unknown>,
  ): void {
    const handlerTable = key.slice(0, key.indexOf("|"));
    for (const handler of this.handlers) {
      if (handler.kind !== "postgres_changes" || handler.table !== handlerTable) continue;
      if (handler.event !== "*" && handler.event !== eventType) continue;
      handler.callback({
        eventType,
        schema: "public",
        table,
        new: next,
        old,
        commit_timestamp: new Date().toISOString(),
      });
    }
  }

  send(message: { type: string; event: string; payload?: unknown }): Promise<"ok"> {
    if (message.type === "broadcast" && this.broadcastChannel) {
      this.broadcastChannel.postMessage({
        event: message.event,
        payload: message.payload,
      });
    }
    return Promise.resolve("ok");
  }

  unsubscribe(): this {
    this.subscribed = false;
    this.broadcastChannel?.close();
    this.broadcastChannel = null;
    for (const timer of this.pollers.values()) clearInterval(timer);
    this.pollers.clear();
    this.snapshots.clear();
    this.initialized.clear();
    this.handlers = [];
    return this;
  }

  isSubscribed(): boolean {
    return this.subscribed;
  }
}

const channels = new Map<string, LocalChannel>();

async function authSession(): Promise<{
  data: { session: AuthSession | null };
  error: PostgrestError | null;
}> {
  try {
    const response = await fetch(apiUrl("/api/auth/session"), {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) {
      return { data: { session: null }, error: await parseError(response) };
    }
    const body = (await response.json()) as {
      user?: AuthUser | null;
      expiresAt?: string;
    };
    if (!body.user) return { data: { session: null }, error: null };
    return {
      data: {
        session: {
          user: body.user,
          expires_at: body.expiresAt ? Math.floor(Date.parse(body.expiresAt) / 1000) : undefined,
        },
      },
      error: null,
    };
  } catch (error) {
    return {
      data: { session: null },
      error: pgError(
        error instanceof Error ? error.message : "Session indisponible",
        "NETWORK",
      ),
    };
  }
}

function localSession(user: AuthUser, expiresAt?: string): AuthSession {
  return {
    user,
    expires_at: expiresAt ? Math.floor(Date.parse(expiresAt) / 1000) : undefined,
  };
}

export interface RestAuth {
  getSession(): Promise<{
    data: { session: AuthSession | null };
    error: PostgrestError | null;
  }>;
  getUser(): Promise<{
    data: { user: AuthUser | null };
    error: PostgrestError | null;
  }>;
  signInWithPassword(input: {
    email: string;
    password: string;
  }): Promise<{
    data: { user: AuthUser | null; session: AuthSession | null };
    error: PostgrestError | null;
  }>;
  signUp(input: {
    email: string;
    password: string;
    options?: { data?: Record<string, unknown>; emailRedirectTo?: string };
  }): Promise<{
    data: { user: AuthUser | null; session: AuthSession | null };
    error: PostgrestError | null;
  }>;
  signOut(): Promise<{ error: PostgrestError | null }>;
  updateUser(input: {
    password?: string;
    currentPassword?: string;
    data?: Record<string, unknown>;
  }): Promise<{
    data: { user: AuthUser | null };
    error: PostgrestError | null;
  }>;
  resetPasswordForEmail(
    email: string,
    options?: { redirectTo?: string },
  ): Promise<{ data: Record<string, never>; error: PostgrestError | null }>;
  exchangeCodeForSession(code: string): Promise<{
    data: { user: AuthUser | null; session: AuthSession | null };
    error: PostgrestError | null;
  }>;
  verifyOtp(params: {
    token_hash?: string;
    type?: string;
    email?: string;
  }): Promise<{
    data: { user: AuthUser | null; session: AuthSession | null };
    error: PostgrestError | null;
  }>;
  resend(params: {
    type: string;
    email: string;
    options?: { emailRedirectTo?: string };
  }): Promise<{ data: Record<string, never>; error: PostgrestError | null }>;
  onAuthStateChange(
    callback: (event: AuthEvent, session: AuthSession | null) => void,
  ): { data: { subscription: { unsubscribe: () => void } } };
}

export const restAuth: RestAuth = {
  getSession: authSession,

  async getUser() {
    const { data, error } = await authSession();
    return { data: { user: data.session?.user ?? null }, error };
  },

  async signInWithPassword({ email, password }) {
    try {
      const response = await fetch(apiUrl("/api/auth/sign-in"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) {
        return { data: { user: null, session: null }, error: await parseError(response) };
      }
      const body = (await response.json()) as {
        user?: AuthUser;
        expiresAt?: string;
      };
      if (!body.user) {
        return {
          data: { user: null, session: null },
          error: pgError("Identifiants invalides.", "invalid-credentials"),
        };
      }
      const session = localSession(body.user, body.expiresAt);
      notifyAuth("SIGNED_IN", session);
      return { data: { user: body.user, session }, error: null };
    } catch (error) {
      return {
        data: { user: null, session: null },
        error: pgError(
          error instanceof Error ? error.message : "Connexion impossible",
          "NETWORK",
        ),
      };
    }
  },

  async signUp({ email, password, options }) {
    try {
      const response = await fetch(apiUrl("/api/auth/sign-up"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email, password, metadata: options?.data ?? {} }),
      });
      if (!response.ok) {
        return { data: { user: null, session: null }, error: await parseError(response) };
      }
      const body = (await response.json()) as {
        user?: AuthUser;
        expiresAt?: string;
      };
      if (!body.user) {
        return {
          data: { user: null, session: null },
          error: pgError("Inscription refusée.", "sign-up-failed"),
        };
      }
      const session = localSession(body.user, body.expiresAt);
      notifyAuth("SIGNED_IN", session);
      return { data: { user: body.user, session }, error: null };
    } catch (error) {
      return {
        data: { user: null, session: null },
        error: pgError(
          error instanceof Error ? error.message : "Inscription impossible",
          "NETWORK",
        ),
      };
    }
  },

  async signOut() {
    try {
      const response = await fetch(apiUrl("/api/auth/sign-out"), {
        method: "POST",
        credentials: "same-origin",
      });
      notifyAuth("SIGNED_OUT", null);
      if (!response.ok) return { error: await parseError(response) };
      return { error: null };
    } catch (error) {
      notifyAuth("SIGNED_OUT", null);
      return {
        error: pgError(
          error instanceof Error ? error.message : "Déconnexion impossible",
          "NETWORK",
        ),
      };
    }
  },

  async updateUser({ password, currentPassword }) {
    if (!password) {
      const { data, error } = await authSession();
      return { data: { user: data.session?.user ?? null }, error };
    }
    try {
      const response = await fetch(apiUrl("/api/auth/password"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ newPassword: password, currentPassword }),
      });
      if (!response.ok) {
        return { data: { user: null }, error: await parseError(response) };
      }
      const { data } = await authSession();
      const user = data.session?.user ?? null;
      notifyAuth("USER_UPDATED", data.session);
      return { data: { user }, error: null };
    } catch (error) {
      return {
        data: { user: null },
        error: pgError(
          error instanceof Error ? error.message : "Mise à jour impossible",
          "NETWORK",
        ),
      };
    }
  },

  async resetPasswordForEmail(email, _options) {
    try {
      const response = await fetch(apiUrl("/api/auth/password/forgot"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email }),
      });
      if (!response.ok) {
        return { data: {}, error: await parseError(response) };
      }
      return { data: {}, error: null };
    } catch (error) {
      return {
        data: {},
        error: pgError(
          error instanceof Error ? error.message : "Envoi impossible",
          "NETWORK",
        ),
      };
    }
  },

  async exchangeCodeForSession(_code) {
    const { data, error } = await authSession();
    if (!data.session) {
      return {
        data: { user: null, session: null },
        error: error ?? pgError("Lien invalide ou expiré.", "invalid-token"),
      };
    }
    notifyAuth("SIGNED_IN", data.session);
    return { data: { user: data.session.user, session: data.session }, error: null };
  },

  async verifyOtp(_params) {
    const { data, error } = await authSession();
    if (!data.session) {
      return {
        data: { user: null, session: null },
        error: error ?? pgError("Lien invalide ou expiré.", "invalid-token"),
      };
    }
    notifyAuth("SIGNED_IN", data.session);
    return { data: { user: data.session.user, session: data.session }, error: null };
  },

  async resend(_params) {
    return { data: {}, error: null };
  },

  onAuthStateChange(callback) {
    authListeners.add(callback);
    return {
      data: {
        subscription: {
          unsubscribe: () => authListeners.delete(callback),
        },
      },
    };
  },
};

export interface RestClient {
  from<T = DynamicRow>(table: string): RestQueryBuilder<T>;
  rpc<T = DynamicRow>(name: string, args?: Record<string, unknown>): RestQueryBuilder<T>;
  auth: RestAuth;
  channel(name: string): LocalChannel;
  removeChannel(channel: LocalChannel): Promise<void>;
}

export const restClient: RestClient = {
  from<T = DynamicRow>(table: string): RestQueryBuilder<T> {
    return new RestQueryBuilder<T>(table);
  },

  rpc<T = DynamicRow>(name: string, args: Record<string, unknown> = {}): RestQueryBuilder<T> {
    const builder = new RestQueryBuilder<T>(`rpc/${name}`);
    builder.insert(args);
    return builder;
  },

  auth: restAuth,

  channel(name: string): LocalChannel {
    const existing = channels.get(name);
    if (existing) return existing;
    const channel = new LocalChannel(name);
    channels.set(name, channel);
    return channel;
  },

  async removeChannel(channel: LocalChannel): Promise<void> {
    channel.unsubscribe();
  },
};
