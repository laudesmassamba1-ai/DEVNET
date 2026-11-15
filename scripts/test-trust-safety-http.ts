/**
 * Trust & Safety — parcours HTTP de bout en bout.
 *
 * Exécuter avec : `npm run test:trust-safety-http`.
 *
 * Ce test ne simule ni les routes, ni les cookies, ni le pool : il démarre
 * Next, ouvre de vraies sessions en base, puis attaque les routes avec
 * `fetch`. Il prouve trois choses qu'un test unitaire ne peut pas prouver :
 *
 *  1. une session absente reçoit 401, un compte ordinaire 403 ;
 *  2. les paramètres de protection sont écrits puis relus par HTTP ;
 *  3. une décision de dossier passe par l'API et laisse une sanction en base.
 *
 * Il vérifie aussi que les deux cibles ajoutées par la 076 — story et
 * message privé — traversent la RLS et ouvrent un dossier, car ce sont
 * exactement les cibles des boutons « Signaler » de l'interface.
 *
 * La cible doit être **locale** : le script refuse un hôte distant. Il ne
 * touche jamais la base servie.
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
import A11yAudit from "../lib/a11y/audit";
import { Client } from "pg";
import { hashPassword } from "../modules/auth/application/password";

const DATABASE_URL =
  process.env.TS_DATABASE_URL ?? "postgresql://postgres:test@localhost:55443/devnet";
const PORT = Number(process.env.TS_HTTP_PORT ?? 3111);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = "mot-de-passe-http-ts-2026";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`✓ ${name}`);
    return;
  }
  failures.push(`${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
  console.error(`✗ ${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertLocalTarget(): void {
  const url = new URL(DATABASE_URL);
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error("ce test écrit des lignes : il exige une base locale");
  }
}

async function owner<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 5_000,
    application_name: "devnet-test-http",
  });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/** Identité posée avant `set local role`, sinon `auth.uid()` est masqué par la RLS. */
async function asUser<T>(userId: string, run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 5_000,
    application_name: "devnet-test-http-user",
  });
  await client.connect();
  try {
    await client.query("begin");
    await client.query(
      `select set_config('request.jwt.claim.role', 'authenticated', true),
              set_config('request.jwt.claim.sub', $1, true)`,
      [userId],
    );
    await client.query("set local role authenticated");
    const value = await run(client);
    await client.query("commit");
    return value;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

type HttpResult = {
  status: number;
  json: Record<string, unknown> | null;
  text: string;
  cacheControl: string | null;
};

async function call(
  path: string,
  options: { token?: string; method?: string; body?: unknown; raw?: string } = {},
): Promise<HttpResult> {
  const headers: Record<string, string> = {};
  if (options.token) headers.cookie = `devnet_session=${options.token}`;
  if (options.body !== undefined || options.raw !== undefined) {
    headers["content-type"] = "application/json";
  }
  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? "GET",
    headers,
    body:
      options.raw !== undefined
        ? options.raw
        : options.body !== undefined
          ? JSON.stringify(options.body)
          : undefined,
    redirect: "manual",
  });
  const text = await response.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    json = null;
  }
  return {
    status: response.status,
    json,
    text,
    cacheControl: response.headers.get("cache-control"),
  };
}

/** Arrête le groupe Next, y compris le `next-server` détaché par `npx`. */
async function stopServer(child: ChildProcess | null): Promise<void> {
  if (!child?.pid) return;
  const signal = (name: NodeJS.Signals) => {
    try {
      process.kill(-child.pid!, name);
    } catch {
      child.kill(name);
    }
  };
  signal("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  // Un SIGTERM peut laisser Turbopack en vie ; le verrou de Next ferait
  // alors échouer la passe suivante avec un serveur fantôme.
  signal("SIGKILL");
}

async function waitForServer(child: ChildProcess, logs: () => string): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Next s'est arrêté (${child.exitCode}).\n${logs().slice(-1800)}`);
    }
    try {
      const response = await fetch(`${BASE}/login`, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // Le serveur n'écoute pas encore : on réessaie.
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  throw new Error(`Next ne répond pas sur ${BASE}.\n${logs().slice(-1800)}`);
}

type Seeded = {
  admin: string;
  member: string;
  author: string;
  reviewer: string;
  tokens: { admin: string; member: string; author: string; reviewer: string };
  post: string;
  caseId: string;
};

async function seed(): Promise<Seeded> {
  const ids = {
    admin: randomUUID(),
    member: randomUUID(),
    author: randomUUID(),
    reviewer: randomUUID(),
    post: randomUUID(),
    conversation: `ts-http-${randomUUID()}`,
  };
  const tokens = {
    admin: randomBytes(32).toString("base64url"),
    member: randomBytes(32).toString("base64url"),
    author: randomBytes(32).toString("base64url"),
    reviewer: randomBytes(32).toString("base64url"),
  };
  const suffix = ids.admin.slice(0, 8);

  const caseId = await owner(async (client) => {
    const users: [string, string, string, boolean, keyof typeof tokens][] = [
      [ids.admin, "Admin HTTP", `ts_http_admin_${suffix}`, true, "admin"],
      [ids.member, "Membre HTTP", `ts_http_member_${suffix}`, false, "member"],
      [ids.author, "Auteur HTTP", `ts_http_author_${suffix}`, false, "author"],
      // Un second administrateur : l'auteur d'une sanction ne peut pas
      // réviser son propre recours. Sans lui, le test ne prouverait que
      // le refus, jamais le parcours complet.
      [ids.reviewer, "Révision HTTP", `ts_http_reviewer_${suffix}`, true, "reviewer"],
    ];
    for (const [id, prenom, pseudo, admin, tokenKey] of users) {
      await client.query(
        `insert into auth.users (id, email)
         values ($1, $2)
         on conflict (id) do nothing`,
        [id, `${pseudo}@test.local`],
      );
      await client.query(
        `insert into public.users (id, prenom, pseudo, email, is_admin)
         values ($1, $2, $3, $4, $5)
         on conflict (id) do update
           set prenom = excluded.prenom,
               pseudo = excluded.pseudo,
               email = excluded.email,
               is_admin = excluded.is_admin`,
        [id, prenom, pseudo, `${pseudo}@test.local`, admin],
      );
      // Une empreinte réelle permet aussi de vérifier la connexion HTTP.
      await client.query(
        `insert into public.user_credentials (user_id, password_hash)
         values ($1, $2)
         on conflict (user_id) do update set password_hash = excluded.password_hash`,
        [id, await hashPassword(PASSWORD)],
      );
      await client.query(
        `insert into public.sessions (user_id, token_hash, expires_at, user_agent)
         values ($1, $2, now() + interval '1 hour', 'test-http')`,
        [id, sha256(tokens[tokenKey])],
      );
    }

    await client.query(
      `insert into public.posts (id, text, author_type, author_id)
       values ($1, 'contenu de test HTTP', 'user', $2)`,
      [ids.post, ids.author],
    );

    // Le dossier naît du signalement, comme en production : le trigger de
    // la 076 doit le relier à la cible et à son auteur.
    await client.query(
      `insert into public.reports (reporter_id, post_id, reason, details)
       values ($1, $2, 'harassment', 'test HTTP réel')`,
      [ids.member, ids.post],
    );
    // `RETURNING` est évalué avant le trigger AFTER : on relit la ligne.
    const opened = await client.query<{ case_id: string | null }>(
      `select case_id from public.reports where post_id = $1 and reporter_id = $2`,
      [ids.post, ids.member],
    );
    const linked = opened.rows[0]?.case_id;
    if (!linked) throw new Error("le signalement n'a pas ouvert de dossier");
    return linked;
  });

  return {
    admin: ids.admin,
    member: ids.member,
    author: ids.author,
    reviewer: ids.reviewer,
    tokens,
    post: ids.post,
    caseId,
  };
}

/**
 * Signalements story et message privé, sous la vraie RLS.
 *
 * C'est le chaînon que les boutons de l'interface utilisent : la ligne
 * `reports` est insérée avec l'identité de l'auteur du signalement, et le
 * trigger doit ouvrir un dossier sur la cible et son auteur réel.
 */
async function verifyReportTargets(seeded: Seeded): Promise<void> {
  const story = randomUUID();
  const conversation = `ts-http-${randomUUID()}`;
  const dm = randomUUID();

  await owner(async (client) => {
    await client.query(
      `insert into public.stories (id, author_id, caption, media_url, expires_at, audience)
       values ($1, $2, 'story de test HTTP', '', now() + interval '1 day', 'public')`,
      [story, seeded.author],
    );
    await client.query(
      `insert into public.conversations (id, participants)
       values ($1, array[$2::uuid, $3::uuid])`,
      [conversation, seeded.author, seeded.member],
    );
    await client.query(
      `insert into public.conversation_members (conversation_id, user_id)
       values ($1, $2), ($1, $3)
       on conflict (conversation_id, user_id) do nothing`,
      [conversation, seeded.author, seeded.member],
    );
    await client.query(
      `insert into public.direct_messages (id, conversation_id, author_id, author_name, text)
       values ($1, $2, $3, 'Auteur HTTP', 'message privé de test HTTP')`,
      [dm, conversation, seeded.author],
    );
  });

  await asUser(seeded.member, (client) =>
    client.query(
      `insert into public.reports (reporter_id, story_id, reason, details)
       values ($1, $2, 'harassment', 'test HTTP story')`,
      [seeded.member, story],
    ),
  );
  await asUser(seeded.member, (client) =>
    client.query(
      `insert into public.reports (reporter_id, direct_message_id, reason, details)
       values ($1, $2, 'spam', 'test HTTP message privé')`,
      [seeded.member, dm],
    ),
  );

  const rows = await owner(async (client) => {
    const result = await client.query<{
      target_type: string;
      case_id: string | null;
      content_author_id: string | null;
    }>(
      `select r.target_type, r.case_id, c.content_author_id
         from public.reports r
         join public.moderation_cases c on c.id = r.case_id
        where (r.story_id = $1 or r.direct_message_id = $2)
        order by r.target_type`,
      [story, dm],
    );
    return result.rows;
  });

  const storyRow = rows.find((row) => row.target_type === "story");
  const dmRow = rows.find((row) => row.target_type === "direct_message");
  check("report story : cible déduite et dossier ouvert", Boolean(storyRow?.case_id), storyRow);
  check("report story : auteur réel du dossier", storyRow?.content_author_id === seeded.author);
  check("report message privé : cible déduite et dossier ouvert", Boolean(dmRow?.case_id), dmRow);
  check(
    "report message privé : auteur réel du dossier",
    dmRow?.content_author_id === seeded.author,
  );
}

async function verifySettings(token: string): Promise<void> {
  const anonymous = await call("/api/protection/settings");
  check("settings : sans session → 401", anonymous.status === 401, anonymous.status);

  const initial = await call("/api/protection/settings", { token });
  check("settings : session valide → 200", initial.status === 200, initial.text);
  check("settings : cache interdit", initial.cacheControl === "no-store", initial.cacheControl);
  const first = initial.json?.settings as { who_can_message?: string } | undefined;
  check("settings : lecture par défaut", first?.who_can_message === "everyone", first);

  const patch = await call("/api/protection/settings", {
    token,
    method: "PATCH",
    body: {
      who_can_message: "followers",
      who_can_comment: "nobody",
      who_can_mention: "everyone",
      filter_offensive: false,
      hide_sensitive_media: true,
      blocked_words: ["spoiler", "gore"],
    },
  });
  check("settings : écriture → 200", patch.status === 200, patch.text);

  const reread = await call("/api/protection/settings", { token });
  const saved = reread.json?.settings as
    | {
        who_can_message?: string;
        who_can_comment?: string;
        filter_offensive?: boolean;
        hide_sensitive_media?: boolean;
        blocked_words?: string[];
      }
    | undefined;
  check(
    "settings : valeurs persistées",
    saved?.who_can_message === "followers" &&
      saved?.who_can_comment === "nobody" &&
      saved?.filter_offensive === false &&
      saved?.hide_sensitive_media === true &&
      // La RPC trie les mots : l'ordre de saisie n'est pas un contrat.
      saved?.blocked_words?.slice().sort().join(",") === "gore,spoiler",
    saved,
  );

  const tooMany = await call("/api/protection/settings", {
    token,
    method: "PATCH",
    body: { blocked_words: Array.from({ length: 101 }, (_, index) => `mot-${index}`) },
  });
  check("settings : 101 mots refusés", tooMany.status === 400, tooMany.text);

  const malformed = await call("/api/protection/settings", {
    token,
    method: "PATCH",
    raw: "{",
  });
  check("settings : corps illisible → 400", malformed.status === 400, malformed.status);
}

async function verifyCases(seeded: Seeded): Promise<{ sanctionId: string }> {
  const anonymous = await call("/api/admin/cases?view=overview");
  check("cases : sans session → 401", anonymous.status === 401, anonymous.status);

  const member = await call("/api/admin/cases?view=overview", { token: seeded.tokens.member });
  check("cases : compte ordinaire → 403", member.status === 403, member.status);

  const overview = await call("/api/admin/cases?view=overview", { token: seeded.tokens.admin });
  check("cases : modérateur → overview 200", overview.status === 200, overview.text);
  const data = overview.json?.overview as
    | { policy?: { version?: string }; counts?: { open?: number } }
    | undefined;
  check("cases : politique active lue", data?.policy?.version === "2026.11.1", data?.policy);
  check("cases : compteur de dossiers", (data?.counts?.open ?? 0) >= 1, data?.counts);

  const list = await call("/api/admin/cases?status=all", { token: seeded.tokens.admin });
  const cases = (list.json?.cases ?? []) as { id?: string }[];
  check(
    "cases : le dossier de test est listé",
    list.status === 200 && cases.some((row) => row.id === seeded.caseId),
    list.text,
  );

  const detail = await call(`/api/admin/cases/${seeded.caseId}`, { token: seeded.tokens.admin });
  check("cases : détail → 200", detail.status === 200, detail.text);
  const detailCase = detail.json?.case as { id?: string; target_id?: string } | undefined;
  check("cases : détail porte la cible", detailCase?.target_id === seeded.post, detailCase);

  const memberDecision = await call(`/api/admin/cases/${seeded.caseId}`, {
    token: seeded.tokens.member,
    method: "PATCH",
    body: { action: "decide", decision: "warning", reasonCode: "harassment" },
  });
  check("cases : décision ordinaire → 403", memberDecision.status === 403, memberDecision.status);

  const note = await call(`/api/admin/cases/${seeded.caseId}`, {
    token: seeded.tokens.admin,
    method: "PATCH",
    body: { action: "assign", assigneeId: "me" },
  });
  check("cases : assignation → 200", note.status === 200, note.text);

  const noted = await call(`/api/admin/cases/${seeded.caseId}`, {
    token: seeded.tokens.admin,
    method: "PATCH",
    body: { action: "note", note: "vérifié par le test HTTP réel" },
  });
  check("cases : note interne → 200", noted.status === 200, noted.text);

  const bad = await call(`/api/admin/cases/${seeded.caseId}`, {
    token: seeded.tokens.admin,
    method: "PATCH",
    body: { action: "decide", decision: "inconnue", reasonCode: "harassment" },
  });
  check("cases : décision inconnue → 400", bad.status === 400, bad.text);

  const decided = await call(`/api/admin/cases/${seeded.caseId}`, {
    token: seeded.tokens.admin,
    method: "PATCH",
    body: {
      action: "decide",
      decision: "warning",
      reasonCode: "harassment",
      note: "décision du test HTTP",
      removeContent: false,
    },
  });
  check("cases : décision → 200", decided.status === 200, decided.text);
  const result = decided.json as
    | { ok?: boolean; removed?: boolean; sanctionId?: string | null }
    | null;
  check("cases : décision sans suppression", result?.ok === true && result?.removed === false, result);
  check("cases : sanction créée", typeof result?.sanctionId === "string", result);

  const after = await call(`/api/admin/cases/${seeded.caseId}`, { token: seeded.tokens.admin });
  const closed = after.json?.case as
    | { status?: string; last_decision?: string; assigned_to?: string; internal_note?: string }
    | undefined;
  check("cases : dossier actionné", closed?.status === "actioned", closed);
  check("cases : décision conservée", closed?.last_decision === "warning", closed);
  check(
    "cases : assignation et note conservées",
    closed?.assigned_to === seeded.admin &&
      Boolean(closed?.internal_note?.includes("test HTTP réel")),
    closed,
  );

  const persisted = await owner(async (client) => {
    const sanction = await client.query<{ kind: string; user_id: string }>(
      "select kind, user_id from public.user_sanctions where id = $1",
      [result?.sanctionId],
    );
    const reportStatus = await client.query<{ status: string }>(
      "select status from public.reports where case_id = $1",
      [seeded.caseId],
    );
    return { sanction: sanction.rows[0], reportStatus: reportStatus.rows[0]?.status };
  });
  check("cases : sanction warning en base", persisted.sanction?.kind === "warning", persisted);
  check("cases : signalement classé résolu", persisted.reportStatus === "resolved", persisted);

  if (typeof result?.sanctionId !== "string") {
    throw new Error("la décision doit renvoyer une sanction");
  }
  return { sanctionId: result.sanctionId };
}

type NotificationRow = {
  id: string;
  kind: string;
  sanction_id: string | null;
  recipient_id: string;
  actor_id: string | null;
};

/**
 * Notifications de décision et de recours, lues par le client REST réel.
 *
 * On ne lit pas seulement la table : le destinataire doit voir la ligne
 * sous RLS, un autre compte ne doit pas la voir, et le recours doit
 * produire sa notification après revue. La sanction a été prise sur
 * `seeded.author`, pas sur le compte qui a signalé.
 */
async function verifyNotifications(seeded: Seeded, sanctionId: string): Promise<string> {
  const select = "select=id,kind,sanction_id,recipient_id,actor_id";
  const moderationUrl =
    `/api/rest/notifications?${select}&kind=eq.moderation&sanction_id=eq.${sanctionId}`;

  const own = await call(moderationUrl, { token: seeded.tokens.author });
  const ownRows = (own.json as unknown as NotificationRow[] | null) ?? [];
  check(
    "notifications : l'auteur sanctionné voit la décision moderation",
    own.status === 200 && ownRows.length === 1 && ownRows[0]?.actor_id === seeded.admin,
    { status: own.status, rows: ownRows, body: own.text },
  );

  const other = await call(moderationUrl, { token: seeded.tokens.member });
  const otherRows = (other.json as unknown as NotificationRow[] | null) ?? [];
  check(
    "notifications : un autre compte ne voit pas la décision",
    other.status === 200 && otherRows.length === 0,
    { status: other.status, rows: otherRows, body: other.text },
  );

  const submitted = await call("/api/sanctions/appeal", {
    token: seeded.tokens.author,
    method: "POST",
    body: {
      sanctionId,
      message: "Le test HTTP conteste cette décision pour vérifier la notification.",
    },
  });
  const appealId = (submitted.json as { appealId?: string } | null)?.appealId;
  check("notifications : recours déposé par l'auteur", submitted.status === 200, submitted.text);
  check("notifications : identifiant de recours renvoyé", typeof appealId === "string", submitted.text);
  if (typeof appealId !== "string") throw new Error("le recours doit renvoyer un identifiant");

  const pending = await call("/api/admin/appeals?status=pending", {
    token: seeded.tokens.reviewer,
  });
  const appeals = (pending.json?.appeals ?? []) as { id?: string }[];
  check(
    "notifications : recours visible par un autre modérateur",
    pending.status === 200 && appeals.some((row) => row.id === appealId),
    pending.text,
  );

  return appealId;
}

/** Revue du recours par un modérateur distinct, puis notification `appeal`. */
async function verifyAppealReview(
  seeded: Seeded,
  appealId: string,
  sanctionId: string,
): Promise<void> {
  const reviewed = await call("/api/admin/appeals", {
    token: seeded.tokens.reviewer,
    method: "PATCH",
    body: { id: appealId, decision: "upheld", note: "revue du test HTTP" },
  });
  check("notifications : recours examiné par la modération", reviewed.status === 200, reviewed.text);

  const notice = await call(
    `/api/rest/notifications?select=id,kind,sanction_id,recipient_id,actor_id`
      + `&kind=eq.appeal&sanction_id=eq.${sanctionId}`,
    { token: seeded.tokens.author },
  );
  const rows = (notice.json as unknown as NotificationRow[] | null) ?? [];
  check(
    "notifications : l'auteur voit la décision de recours",
    notice.status === 200 && rows.length === 1 && rows[0]?.actor_id === seeded.reviewer,
    { status: notice.status, rows, body: notice.text },
  );
}

/**
 * Revue navigateur réelle des trois écrans, en desktop et en mobile.
 *
 * Le test attend le titre rendu, ouvre le détail d'un dossier, contrôle
 * qu'il n'y a qu'un formulaire de protection, mesure le débordement
 * horizontal et passe le contrôle d'accessibilité interne sur chaque écran.
 * Les captures restent dans
 * `docs/engineering/evidence/trust-safety/` comme preuve datée.
 */
async function verifyVisual(seeded: Seeded): Promise<void> {
  const dir = "docs/engineering/evidence/trust-safety";
  await mkdir(dir, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  try {
    for (const view of [
      { name: "desktop", width: 1440, height: 1000 },
      { name: "mobile", width: 390, height: 844 },
    ]) {
      const admin = await browser.newContext({
        baseURL: BASE,
        viewport: { width: view.width, height: view.height },
      });
      await admin.addCookies([
        { name: "devnet_session", value: seeded.tokens.admin, url: BASE, httpOnly: true, sameSite: "Lax" },
      ]);
      // La visite guidée est mémorisée par compte : elle intercepte tous
      // les clics tant que la clé du compte n'est pas acquittée.
      await admin.addInitScript((ids) => {
        localStorage.setItem("devnet.tour.v1", "done");
        for (const id of ids) localStorage.setItem(`devnet.tour.v1:${id}`, "done");
      }, [seeded.admin, seeded.author]);
      const page = await admin.newPage();
      page.setDefaultTimeout(120_000);
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));

      async function review(
        screen: string,
        ready: () => Promise<unknown>,
        after?: () => Promise<void>,
      ): Promise<void> {
        const response = await page.goto(`${BASE}${screen}`, { waitUntil: "domcontentloaded" });
        try {
          await ready();
        } catch (error) {
          console.error(
            `[visuel] ${screen} status=${response?.status()} url=${page.url()}`,
            (await page.locator("body").innerText().catch(() => "")).slice(0, 500),
          );
          throw error;
        }
        // Le compte de test est neuf : la visite guidée s'ouvre au-dessus
        // de la page et intercepte tous les clics. On la ferme comme un
        // utilisateur le ferait, avant d'interagir avec l'écran.
        const tour = page.getByRole("dialog", { name: "Prise en main de DevNet" });
        if (await tour.count()) {
          const quit = tour.getByRole("button", { name: "Quitter" });
          if (await quit.count()) await quit.click();
          await tour.waitFor({ state: "detached" }).catch(() => undefined);
        }

        if (after) await after();
        await page.waitForTimeout(250);

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth + 1,
        );
        check(`navigateur ${view.name} ${screen} : pas de débordement horizontal`, !overflow);

        const audit = await new A11yAudit({ page })
          .withTags(["wcag2a", "wcag2aa"])
          .analyze();
        const serious = audit.violations.filter(
          (violation) => violation.impact === "critical" || violation.impact === "serious",
        );
        check(
          `navigateur ${view.name} ${screen} : aucune violation d'accessibilité sérieuse`,
          serious.length === 0,
          serious.map((violation) => `${violation.id} (${violation.impact})`),
        );

        await page.screenshot({
          path: `${dir}/${screen.replaceAll("/", "-").replace(/^-/, "")}-${view.name}.png`,
          fullPage: true,
        });
      }

      await review(
        "/admin/cases",
        () => page.getByRole("heading", { name: "Dossiers de modération" }).waitFor(),
        async () => {
          // La décision précédente a classé le dossier : le filtre initial
          // « ouverts » ne le montre plus. On ouvre « tous » avant de cliquer.
          await page.getByRole("tab", { name: "tous" }).click();
          const queue = page
            .locator("section")
            .filter({ has: page.getByRole("heading", { name: "File de décision" }) })
            .locator("ul > li > button");
          await queue.first().waitFor({ timeout: 30_000 });
          check(`navigateur ${view.name} cases : file de décision non vide`, (await queue.count()) > 0);
          await queue.first().click();
          await page.locator("#case-detail").waitFor();
        },
      );
      await review(
        "/admin/policy",
        () => page.getByRole("heading", { name: "Politique active" }).waitFor(),
        async () => {
          await page.getByRole("button", { name: /Publier cette version/ }).waitFor();
          await page.getByRole("heading", { name: "Versions" }).waitFor();
        },
      );
      await review(
        "/admin/sanctions",
        () => page.getByRole("heading", { name: "Sanctions et recours" }).waitFor(),
        async () => {
          await page.getByRole("tab", { name: /recours/i }).click();
          await page.getByRole("heading", { name: "Recours en attente" }).waitFor();
        },
      );
      await admin.close();

      const sanctioned = await browser.newContext({
        baseURL: BASE,
        viewport: { width: view.width, height: view.height },
      });
      await sanctioned.addCookies([
        { name: "devnet_session", value: seeded.tokens.author, url: BASE, httpOnly: true, sameSite: "Lax" },
      ]);
      await sanctioned.addInitScript((ids) => {
        localStorage.setItem("devnet.tour.v1", "done");
        for (const id of ids) localStorage.setItem(`devnet.tour.v1:${id}`, "done");
      }, [seeded.admin, seeded.author]);
      const protection = await sanctioned.newPage();
      protection.setDefaultTimeout(120_000);
      await protection.goto(`${BASE}/settings/protection`, { waitUntil: "domcontentloaded" });
      await protection.getByRole("heading", { name: "Protection", exact: true }).waitFor();
      const protectionTour = protection.getByRole("dialog", {
        name: "Prise en main de DevNet",
      });
      if (await protectionTour.count()) {
        const quit = protectionTour.getByRole("button", { name: "Quitter" });
        if (await quit.count()) await quit.click();
        await protectionTour.waitFor({ state: "detached" }).catch(() => undefined);
      }
      await protection.locator("#safety-settings").waitFor();
      const settingsForms = await protection.locator("#safety-settings").count();
      check(
        `navigateur ${view.name} protection : un seul formulaire de réglages`,
        settingsForms === 1,
        settingsForms,
      );
      const overflow = await protection.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      check(`navigateur ${view.name} protection : pas de débordement horizontal`, !overflow);
      const audit = await new A11yAudit({ page: protection })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      const serious = audit.violations.filter(
        (violation) => violation.impact === "critical" || violation.impact === "serious",
      );
      check(
        `navigateur ${view.name} protection : aucune violation d'accessibilité sérieuse`,
        serious.length === 0,
        serious.map((violation) => `${violation.id} (${violation.impact})`),
      );
      await protection.screenshot({
        path: `${dir}/settings-protection-${view.name}.png`,
        fullPage: true,
      });
      await sanctioned.close();

      check(
        `navigateur ${view.name} : aucune erreur JavaScript de page`,
        pageErrors.length === 0,
        pageErrors,
      );
    }
  } finally {
    await browser.close();
  }
}


/**
 * Éditeur de politique : lecture par la modération, publication par les
 * rôles owner/admin, version active réellement changée.
 *
 * Ce test tourne en dernier parce qu'il modifie la politique active. Le
 * nettoyage remet `2026.11.1`, sinon une exécution interrompue laisserait
 * la base de test sur une politique inventée.
 */
async function verifyPolicy(seeded: Seeded): Promise<void> {
  const anonymous = await call("/api/admin/policy");
  check("policy : sans session → 401", anonymous.status === 401, anonymous.status);

  const member = await call("/api/admin/policy", { token: seeded.tokens.member });
  check("policy : compte ordinaire → 403", member.status === 403, member.status);

  const read = await call("/api/admin/policy", { token: seeded.tokens.admin });
  const before = read.json?.active as { version?: string } | null;
  check("policy : administrateur lit la politique active", read.status === 200 && !!before?.version, read.status);

  const memberWrite = await call("/api/admin/policy", {
    token: seeded.tokens.member,
    method: "POST",
    body: { version: "2026.99.76" },
  });
  check("policy : compte ordinaire ne publie pas → 403", memberWrite.status === 403, memberWrite.status);

  const invalid = await call("/api/admin/policy", {
    token: seeded.tokens.admin,
    method: "POST",
    body: { version: "vNext" },
  });
  check("policy : version invalide refusée → 400", invalid.status === 400, invalid.status);

  const thresholds = await call("/api/admin/policy", {
    token: seeded.tokens.admin,
    method: "POST",
    body: {
      version: "2026.99.77",
      thresholds: { hold_at: 0.4, review_at: 0.7, escalate_reports: 99 },
    },
  });
  check("policy : seuils incohérents refusés → 400", thresholds.status === 400, thresholds.status);

  const published = await call("/api/admin/policy", {
    token: seeded.tokens.admin,
    method: "POST",
    body: {
      version: "2026.99.77",
      notes: "publication de test HTTP",
      categories: {
        insult: { severity: "warning", auto: "review" },
        hate: { severity: "critical", auto: "block" },
      },
      thresholds: { hold_at: 0.9, review_at: 0.5, escalate_reports: 4, auto_remove: true, auto_ban: true },
    },
  });
  check("policy : administrateur publie une version → 200", published.status === 200, published.status);
  check(
    "policy : publication journalisée",
    (published.json?.audit as { ok?: boolean } | undefined)?.ok === true,
    published.json?.audit,
  );

  const after = await call("/api/admin/policy", { token: seeded.tokens.admin });
  const active = after.json?.active as
    | { version?: string; thresholds?: { holdAt?: number; autoRemove?: boolean; autoBan?: boolean } }
    | null;
  check("policy : la nouvelle version devient active", active?.version === "2026.99.77", active?.version);
  check("policy : seuil de retenue conservé", active?.thresholds?.holdAt === 0.9, active?.thresholds);
  check(
    "policy : autoRemove et autoBan restent faux malgré la requête",
    active?.thresholds?.autoRemove === false && active?.thresholds?.autoBan === false,
    active?.thresholds,
  );

  const audit = await owner((client) =>
    client.query<{ count: string }>(
      `select count(*)::text as count from public.admin_audit_log
        where action = 'moderation.policy.publish' and target_id = '2026.99.77'`,
    ),
  );
  // Le journal est append-only : une exécution précédente peut déjà avoir
  // laissé sa trace, donc on exige au moins une ligne, jamais exactement une.
  check("policy : une ligne d'audit porte la version", Number(audit.rows[0]?.count ?? 0) >= 1);
}

async function cleanup(seeded: Seeded): Promise<void> {
  await owner(async (client) => {
    await client.query(
      `delete from public.moderation_policy_versions where version = '2026.99.77'`,
    ).catch(() => undefined);
    await client.query(
      `update public.moderation_policy_versions set active = true where version = '2026.11.1'`,
    ).catch(() => undefined);
    await client.query(
      `delete from public.reports
        where reporter_id = any($1::uuid[])
           or case_id in (select id from public.moderation_cases where content_author_id = any($1::uuid[]))`,
      [[seeded.admin, seeded.member, seeded.author, seeded.reviewer]],
    ).catch(() => undefined);
    await client.query(
      `delete from public.moderation_case_events where case_id = $1`,
      [seeded.caseId],
    ).catch(() => undefined);
    await client.query(
      `delete from public.moderation_evidence where case_id = $1`,
      [seeded.caseId],
    ).catch(() => undefined);
    await client.query(
      `delete from public.user_sanctions where user_id = any($1::uuid[]) or issued_by = any($1::uuid[])`,
      [[seeded.admin, seeded.member, seeded.author, seeded.reviewer]],
    ).catch(() => undefined);
    await client.query(
      `delete from public.notifications where recipient_id = any($1::uuid[]) or actor_id = any($1::uuid[])`,
      [[seeded.admin, seeded.member, seeded.author, seeded.reviewer]],
    ).catch(() => undefined);
    await client.query(
      `delete from public.moderation_cases where content_author_id = any($1::uuid[]) or id = $2`,
      [[seeded.admin, seeded.member, seeded.author, seeded.reviewer], seeded.caseId],
    ).catch(() => undefined);
    await client.query(
      `delete from public.direct_messages
        where conversation_id like 'ts-http-%'`,
    ).catch(() => undefined);
    await client.query(
      `delete from public.conversation_members
        where conversation_id like 'ts-http-%'`,
    ).catch(() => undefined);
    await client.query(`delete from public.conversations where id like 'ts-http-%'`).catch(
      () => undefined,
    );
    await client.query(
      `delete from public.reports where story_id in (select id from public.stories where caption = 'story de test HTTP')`,
    ).catch(() => undefined);
    await client.query(`delete from public.stories where caption = 'story de test HTTP'`).catch(
      () => undefined,
    );
    await client.query(`delete from public.posts where id = $1`, [seeded.post]).catch(
      () => undefined,
    );
    await client.query(
      `delete from public.sessions where user_id = any($1::uuid[])`,
      [[seeded.admin, seeded.member, seeded.author, seeded.reviewer]],
    ).catch(() => undefined);
    await client.query(
      `delete from auth.users where id = any($1::uuid[])`,
      [[seeded.admin, seeded.member, seeded.author, seeded.reviewer]],
    ).catch(() => undefined);
  });
}

async function main(): Promise<void> {
  assertLocalTarget();
  console.log(`Base locale : ${new URL(DATABASE_URL).hostname} (port masqué)`);

  const seeded = await seed();
  let child: ChildProcess | null = null;
  let logs = "";
  const logTail = () =>
    logs.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://***").slice(-1800);

  try {
    child = spawn("npx", ["next", "dev", "-p", String(PORT)], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL,
        NEXT_PUBLIC_FORCE_DEMO: "false",
        NEXT_DIST_DIR: `.next-http-test-${PORT}`,
        NODE_ENV: "development",
      },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      logs += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      logs += chunk.toString();
    });

    await waitForServer(child, logTail);
    console.log("Next écoute : parcours HTTP en cours.");

    // La connexion par mot de passe passe par la même route que le navigateur.
    const signed = await fetch(`${BASE}/api/auth/sign-in`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `ts_http_admin_${seeded.admin.slice(0, 8)}@test.local`, password: PASSWORD }),
    });
    check("auth : connexion HTTP par mot de passe → 200", signed.status === 200, signed.status);
    check(
      "auth : cookie de session posé",
      (signed.headers.get("set-cookie") ?? "").includes("devnet_session="),
    );

    await verifySettings(seeded.tokens.member);
    const { sanctionId } = await verifyCases(seeded);
    const appealId = await verifyNotifications(seeded, sanctionId);
    await verifyReportTargets(seeded);
    await verifyVisual(seeded);
    await verifyAppealReview(seeded, appealId, sanctionId);
    await verifyPolicy(seeded);
  } finally {
    await stopServer(child);
    await cleanup(seeded).catch((error: unknown) => {
      console.error("Nettoyage partiel :", error instanceof Error ? error.message : error);
    });
  }

  if (failures.length > 0) {
    console.error(`\n✗ Trust & Safety HTTP : ${failures.length} échec(s), ${passed} réussite(s).`);
    for (const failure of failures) console.error(`  · ${failure}`);
    process.exitCode = 1;
    return;
  }
  assert.ok(passed > 0);
  console.log(`\n✓ Trust & Safety HTTP : ${passed} vérifications sur les vraies routes.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
