/**
 * Trust & Safety — test d'intégration sur un vrai PostgreSQL.
 *
 * Ce test ne simule ni la RLS ni les triggers : il crée quatre comptes, se
 * met réellement dans la peau de chacun (`set local role authenticated` +
 * `request.jwt.claim.sub`), et vérifie les propriétés qui comptent :
 *
 *  1. un blocage n'est lisible que par son auteur (et la modération) ;
 *  2. un compte ordinaire ne peut pas sanctionner ;
 *  3. une suspension active refuse les publications ;
 *  4. un recours ne peut pas être révisé par l'auteur de la sanction ;
 *  5. un autre modérateur peut l'annuler, ce qui lève la sanction ;
 *  6. la chaîne d'audit reste valide après toutes ces actions.
 *
 * Prérequis : une base PostgreSQL 15 migrée (`db:migrate --apply`).
 * Usage :
 *   TS_DATABASE_URL=postgresql://postgres:test@localhost:55443/devnet \
 *     npx tsx scripts/test-trust-safety.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

const URL =
  process.env.TS_DATABASE_URL ?? "postgresql://postgres:test@localhost:55443/devnet";

let checks = 0;

function ok(condition: unknown, label: string): void {
  assert.ok(condition, label);
  checks += 1;
  console.log(`✓ ${label}`);
}

async function owner<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: URL, connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/** Exécute sous l'identité d'un compte, dans une transaction annulée en cas d'erreur. */
async function as<T>(userId: string, run: (client: Client) => Promise<T>): Promise<T> {
  return owner(async (client) => {
    await client.query("begin");
    try {
      await client.query("set local role authenticated");
      await client.query(
        `select set_config('request.jwt.claim.role', 'authenticated', true),
                set_config('request.jwt.claim.sub', $1, true)`,
        [userId],
      );
      const value = await run(client);
      await client.query("commit");
      return value;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }
  });
}

async function expectError(run: Promise<unknown>, pattern: RegExp, label: string): Promise<void> {
  try {
    await run;
    assert.fail(`${label} : aucune erreur levée`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert.match(message, pattern, `${label} : erreur inattendue (${message})`);
    checks += 1;
    console.log(`✓ ${label}`);
  }
}

async function main(): Promise<void> {
  const ids = {
    a: randomUUID(),
    b: randomUUID(),
    admin: randomUUID(),
    lead: randomUUID(),
  };

  /*
   * `public.users.id` référence `auth.users` : on sème d'abord l'identité,
   * puis le profil. Le trigger `on_auth_user_created` peut avoir créé une
   * ligne vide ; l'upsert la complète au lieu d'échouer sur la clé.
   */
  await owner(async (client) => {
    /* Pseudos suffixés : le test doit pouvoir tourner plusieurs fois sur la
       même base sans collision sur l'index unique de `users.pseudo`. */
    const rows: [string, string, string, string, boolean][] = [
      [ids.a, "Alice", `ts_alice_${ids.a.slice(0, 8)}`, `alice-${ids.a}@test.local`, false],
      [ids.b, "Bob", `ts_bob_${ids.b.slice(0, 8)}`, `bob-${ids.b}@test.local`, false],
      [ids.admin, "Admin", `ts_admin_${ids.admin.slice(0, 8)}`, `admin-${ids.admin}@test.local`, true],
      [ids.lead, "Lead", `ts_lead_${ids.lead.slice(0, 8)}`, `lead-${ids.lead}@test.local`, false],
    ];
    for (const [id, prenom, pseudo, email, isAdmin] of rows) {
      await client.query(
        "insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing",
        [id, email],
      );
      await client.query(
        `insert into public.users (id, prenom, pseudo, email, is_admin)
         values ($1, $2, $3, $4, $5)
         on conflict (id) do update
           set prenom = excluded.prenom,
               pseudo = excluded.pseudo,
               email = excluded.email,
               is_admin = excluded.is_admin`,
        [id, prenom, pseudo, email, isAdmin],
      );
    }
  });
  console.log("✓ 0. quatre comptes créés (dont un administrateur)");

  // ── 1. Blocage, sourdine et RLS ────────────────────────────
  await as(ids.a, (client) => client.query("select public.block_user($1)", [ids.b]));
  await as(ids.a, (client) => client.query("select public.mute_user($1)", [ids.b]));

  const mine = await as(ids.a, async (client) => {
    const blocks = await client.query<{ n: number }>(
      "select count(*)::int as n from public.user_blocks",
    );
    const mutes = await client.query<{ n: number }>(
      "select count(*)::int as n from public.user_mutes",
    );
    return { blocks: blocks.rows[0].n, mutes: mutes.rows[0].n };
  });
  ok(mine.blocks === 1 && mine.mutes === 1, "1. Alice voit son blocage et sa sourdine");

  const seenByBob = await as(ids.b, async (client) => {
    const blocks = await client.query<{ n: number }>(
      "select count(*)::int as n from public.user_blocks",
    );
    return blocks.rows[0].n;
  });
  ok(seenByBob === 0, "2. Bob ne peut pas lire le blocage d'Alice (RLS)");

  await as(ids.a, (client) => client.query("select public.unblock_user($1)", [ids.b]));
  await as(ids.a, (client) => client.query("select public.unmute_user($1)", [ids.b]));
  const afterUndo = await as(ids.a, async (client) => {
    const blocks = await client.query<{ n: number }>(
      "select count(*)::int as n from public.user_blocks",
    );
    const mutes = await client.query<{ n: number }>(
      "select count(*)::int as n from public.user_mutes",
    );
    return { blocks: blocks.rows[0].n, mutes: mutes.rows[0].n };
  });
  ok(afterUndo.blocks === 0 && afterUndo.mutes === 0, "3. déblocage et sourdine réversible");

  // ── 2. Permissions de sanction ─────────────────────────────
  ok(
    (await as(ids.b, async (client) => {
      const r = await client.query<{ ok: boolean }>(
        "select public.can_sanction() as ok",
      );
      return r.rows[0].ok;
    })) === false,
    "4. un compte ordinaire n'a pas le droit de sanctionner",
  );

  await expectError(
    as(ids.b, (client) =>
      client.query("select public.issue_sanction($1, 'warning', 'spam', 'test')", [ids.a]),
    ),
    /réservé à la modération/,
    "5. l'appel direct à issue_sanction est refusé",
  );

  // ── 3. Sanction et effet sur la publication ────────────────
  const sanctionId = await as(ids.admin, async (client) => {
    const r = await client.query<{ id: string }>(
      "select public.issue_sanction($1, 'suspend', 'harassment', 'test intégration', 3) as id",
      [ids.b],
    );
    return r.rows[0].id;
  });
  ok(Boolean(sanctionId), "6. l'administrateur prononce une suspension de 3 jours");

  const sanctionRow = await owner(async (client) => {
    const r = await client.query<{ ends_at: string | null; status: string }>(
      "select ends_at, status from public.user_sanctions where id = $1",
      [sanctionId],
    );
    return r.rows[0];
  });
  ok(Boolean(sanctionRow?.ends_at) && sanctionRow?.status === "active", "7. la suspension porte sa fin");

  await expectError(
    as(ids.b, (client) =>
      client.query(
        "insert into public.posts (id, text, author_type, author_id) values (gen_random_uuid(), 'test', 'user', $1)",
        [ids.b],
      ),
    ),
    /suspendu[^:]*: publication refusée/,
    "8. une suspension active refuse la publication",
  );

  // ── 4. Recours et séparation des rôles ─────────────────────
  const appealId = await as(ids.b, async (client) => {
    const r = await client.query<{ id: string }>(
      "select public.submit_appeal($1, 'Je conteste cette décision, elle repose sur une erreur.') as id",
      [sanctionId],
    );
    return r.rows[0].id;
  });
  ok(Boolean(appealId), "9. Bob dépose un recours");

  await expectError(
    as(ids.admin, (client) =>
      client.query("select public.review_appeal($1, 'upheld', 'je confirme')", [appealId]),
    ),
    /auteur de la sanction/,
    "10. l'auteur de la sanction ne peut pas réviser son propre recours",
  );

  await as(ids.admin, (client) =>
    client.query("select public.set_moderation_role($1, 'lead_moderator')", [ids.lead]),
  );
  await as(ids.lead, (client) =>
    client.query(
      "select public.review_appeal($1, 'overturned', 'recours fondé : erreur de cible')",
      [appealId],
    ),
  );
  const lifted = await owner(async (client) => {
    const r = await client.query<{ status: string; lifted_by: string | null }>(
      "select status, lifted_by from public.user_sanctions where id = $1",
      [sanctionId],
    );
    return r.rows[0];
  });
  ok(lifted?.status === "lifted" && lifted?.lifted_by === ids.lead, "11. l'annulation lève la sanction et la trace");

  await as(ids.b, (client) =>
    client.query(
      "insert into public.posts (id, text, author_type, author_id) values (gen_random_uuid(), 'après recours', 'user', $1)",
      [ids.b],
    ),
  );
  ok(true, "12. Bob peut de nouveau publier après l'annulation");

  // ── 5. Chaîne d'audit ──────────────────────────────────────
  const chain = await as(ids.admin, async (client) => {
    const r = await client.query<{ v: { ok: boolean; brokenAt: string | null } }>(
      "select public.verify_admin_audit_chain() as v",
    );
    return r.rows[0].v;
  });
  ok(chain.ok === true, `13. chaîne d'audit valide (${chain.brokenAt ?? "aucune rupture"})`);

  // ── 6. Policy Engine et moteurs purs ───────────────────────
  const policy = await import("../lib/trust-safety/policy");
  const secrets = await import("../lib/trust-safety/engines/secrets");
  const links = await import("../lib/trust-safety/engines/link");

  ok(policy.decide([]).decision === "allow", "14. aucun constat : publication autorisée");
  const minor = policy.decide([
    {
      engine: "text",
      category: "minor_safety",
      severity: "critical",
      score: 0.95,
      explanationCode: "test.minor",
    },
  ]);
  ok(minor.decision === "hold" && minor.priority === "urgent", "15. protection des mineurs : retenue immédiate");
  ok(minor.recommendedSanction?.kind === "suspend", "16. la politique recommande une suspension, sans l'appliquer");
  ok(policy.decide([
    { engine: "text", category: "insult", severity: "warning", score: 0.65, explanationCode: "test.insult" },
  ]).decision === "hold", "17. une insulte connue est retenue avant publication");

  const secretFindings = secrets.inspectSecrets("ma clé AKIA1234567890ABCDEF ne doit pas sortir");
  ok(secretFindings.length === 1 && secretFindings[0].severity === "critical", "18. un jeton AWS est détecté");
  ok(!JSON.stringify(secretFindings[0].evidence).includes("AKIA"), "19. le constat ne recopie jamais le secret");

  const linkFindings = links.inspectLinks("https://paypal.com.evil.test/connexion");
  ok(
    linkFindings.findings.some((finding) => finding.explanationCode === "link.brand_subdomain"),
    "20. une marque en sous-domaine étranger est signalée",
  );
  ok(
    links.inspectLinks("https://example.test/article").findings.every(
      (finding) => finding.severity !== "critical",
    ),
    "21. un lien ordinaire ne déclenche pas de blocage",
  );

  // ── 7. Dossier créé par un signalement réel ────────────────
  const reportedPost = randomUUID();
  await as(ids.a, (client) =>
    client.query(
      "insert into public.posts (id, text, author_type, author_id) values ($1, 'contenu signalé', 'user', $2)",
      [reportedPost, ids.a],
    ),
  );
  await as(ids.b, (client) =>
    client.query(
      `insert into public.reports (reporter_id, post_id, reason)
       values ($1, $2, 'harassment')`,
      [ids.b, reportedPost],
    ),
  );
  const linked = await owner(async (client) => {
    const r = await client.query<{ id: string; target_type: string; case_id: string | null }>(
      `select r.id, r.target_type, r.case_id
         from public.reports r where r.post_id = $1`,
      [reportedPost],
    );
    return r.rows[0];
  });
  ok(linked?.target_type === "post" && Boolean(linked.case_id), "22. un signalement ouvre un dossier");

  const caseRow = await owner(async (client) => {
    const r = await client.query<{ id: string; status: string; content_author_id: string | null }>(
      "select id, status, content_author_id from public.moderation_cases where id = $1",
      [linked.case_id],
    );
    return r.rows[0];
  });
  ok(
    caseRow?.status === "open" && caseRow.content_author_id === ids.a,
    "23. le dossier porte la cible et son auteur",
  );

  // ── 8. Décision humaine : preuve puis suppression ──────────
  process.env.DATABASE_URL = URL;
  const { decideCase } = await import("../lib/trust-safety/cases");
  const decision = await decideCase(ids.admin, linked.case_id!, {
    action: "warning",
    reasonCode: "harassment",
    note: "contenu haineux confirmé",
    removeContent: true,
  });
  ok(decision.removed === true && Boolean(decision.sanctionId), "24. une décision humaine retire et sanctionne");

  const afterRemoval = await owner(async (client) => {
    const post = await client.query<{ n: number }>(
      "select count(*)::int as n from public.posts where id = $1",
      [reportedPost],
    );
    const evidence = await client.query<{ n: number }>(
      "select count(*)::int as n from public.moderation_evidence where case_id = $1",
      [linked.case_id],
    );
    const closed = await client.query<{ status: string }>(
      "select status from public.moderation_cases where id = $1",
      [linked.case_id],
    );
    return {
      post: post.rows[0].n,
      evidence: evidence.rows[0].n,
      caseStatus: closed.rows[0]?.status,
    };
  });
  ok(afterRemoval.post === 0, "25. le contenu condamné est supprimé");
  ok(afterRemoval.evidence === 1, "26. une preuve est conservée avant suppression");
  ok(afterRemoval.caseStatus === "actioned", "27. le dossier est clos avec sa décision");

  // ── 9. Paramètres de protection et bannissement ────────────
  const settings = await as(ids.a, async (client) => {
    const r = await client.query<{ settings: { who_can_message: string; who_can_comment: string } }>(
      "select to_jsonb(public.set_safety_settings('nobody', 'followers', 'everyone', true, false, array['spoiler'])) as settings",
    );
    return r.rows[0]?.settings;
  });
  ok(
    settings?.who_can_message === "nobody" && settings?.who_can_comment === "followers",
    "28. les préférences de protection sont enregistrées par la RPC",
  );

  await expectError(
    as(ids.lead, (client) =>
      client.query("select public.issue_sanction($1, 'ban', 'harassment', 'test')", [ids.a]),
    ),
    /bannissement définitif/,
    "28bis. un lead moderator ne peut pas bannir définitivement",
  );

  const banId = await as(ids.admin, async (client) => {
    const r = await client.query<{ id: string }>(
      "select public.issue_sanction($1, 'ban', 'harassment', 'test bannissement') as id",
      [ids.b],
    );
    return r.rows[0].id;
  });
  const blockedLogin = await owner(async (client) => {
    const r = await client.query<{ blocked: boolean }>(
      "select public.is_login_blocked($1) as blocked",
      [ids.b],
    );
    return r.rows[0]?.blocked;
  });
  ok(
    Boolean(banId) && blockedLogin === true,
    "29. un bannissement actif est signalé à la console",
  );

  // La connexion reste possible : un compte banni doit pouvoir lire et
  // déposer un recours. L'effet du bannissement est sur l'écriture.
  await expectError(
    as(ids.b, (client) =>
      client.query(
        "insert into public.posts (id, text, author_type, author_id) values (gen_random_uuid(), 'après bannissement', 'user', $1)",
        [ids.b],
      ),
    ),
    /banni[^:]*: publication refusée/,
    "30. un bannissement actif refuse la publication, pas la connexion",
  );

  console.log(`\n✓ Trust & Safety : ${checks} vérifications sur PostgreSQL réel.`);
}

main().catch((error: unknown) => {
  console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
