/**
 * Notifications push — test intégré de la logique d'envoi.
 *
 * Ce test ne contacte aucun service externe : la sortie réseau de
 * `web-push` est remplacée par un espion (`pushTransport.send`) et les
 * requêtes SQL par une base simulée. Ce qui est vérifié est donc la vraie
 * chaîne de décision du serveur :
 *
 * 1. message direct → les autres participants, jamais l'auteur ;
 * 2. like → auteur du post, jamais soi-même ;
 * 3. commentaire → auteur du commentaire parent, sinon du post ;
 * 4. message de groupe → tous les membres du groupe sauf l'auteur ;
 * 5. réponse à un statut → l'autre participant, avec le bon lien ;
 * 6. table neutre, corps sans identifiant → aucun envoi.
 *
 * Exécuter avec : npm run test:push-notify
 */
import { createRequire } from "node:module";

type Row = Record<string, unknown>;
type Sent = {
  endpoint: string;
  payload: { title: string; body: string; url: string; tag?: string };
};

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    return;
  }
  failures.push(`${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
}

async function main() {
  process.env.DATABASE_URL = "postgres://probe:probe@127.0.0.1:1/probe";
  process.env.VAPID_PUBLIC_KEY = "B".repeat(87);
  process.env.VAPID_PRIVATE_KEY = "p".repeat(43);
  process.env.VAPID_SUBJECT = "https://devnet.example.test";

  // La base : `pg` est en CJS, son prototype reste modifiable même quand
  // on l'importe depuis un module ES.
  const require = createRequire(import.meta.url);
  const pg = require("pg") as { Pool: { prototype: { query: unknown } } };

  let handler: (sql: string, params: unknown[] | undefined) => { rows: Row[] } = () => ({ rows: [] });
  let subscriptions: Row[] = [];

  pg.Pool.prototype.query = async function (sql: string, params?: unknown[]) {
    if (sql.includes("from public.push_subscriptions")) {
      const wanted = (params?.[0] as string[] | undefined) ?? [];
      return { rows: subscriptions.filter((row) => wanted.includes(String(row.user_id))) };
    }
    if (sql.includes("delete from public.push_subscriptions")) return { rows: [] };
    return handler(sql, params);
  };

  const { pushTransport } = await import("../lib/push/web-push");
  const originalSend = pushTransport.send;
  const sent: Sent[] = [];
  pushTransport.send = async (subscription, body) => {
    sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(body) });
    return {} as never;
  };

  const { dispatchDirectMessagePush } = await import("../lib/push/notify-message");
  const { dispatchActivityPush, dispatchStoryReplyPush } = await import("../lib/push/notify-activity");

  function reset(rows: Row[] = []) {
    sent.length = 0;
    subscriptions = rows;
    handler = () => ({ rows: [] });
  }

  const author = "11111111-1111-4111-8111-111111111111";
  const other = "22222222-2222-4222-8222-222222222222";
  const third = "33333333-3333-4333-8333-333333333333";
  const conv = "44444444-4444-4444-8444-444444444444";
  const post = "55555555-5555-4555-8555-555555555555";
  const comment = "88888888-8888-4888-8888-888888888888";
  const group = "66666666-6666-4666-8666-666666666666";
  const channel = "77777777-7777-4777-8777-777777777777";

  const device = (endpoint: string, user_id: string): Row => ({
    id: endpoint,
    endpoint,
    p256dh: "k".repeat(20),
    auth: "a".repeat(20),
    user_id,
  });

  try {
    // 1. Message direct : l'autre participant reçoit, pas l'auteur.
    reset([device("https://push.test/other", other)]);
    handler = (sql) => {
      if (sql.includes("from public.conversations")) return { rows: [{ participants: [author, other] }] };
      if (sql.includes("from public.users")) return { rows: [{ prenom: "Koffi", pseudo: "koffi" }] };
      return { rows: [] };
    };
    await dispatchDirectMessagePush(author, [{ conversation_id: conv, text: "salut", author_id: author }]);
    check("DM : un envoi", sent.length === 1, sent.length);
    check("DM : bon appareil", sent[0]?.endpoint === "https://push.test/other", sent[0]?.endpoint);
    check("DM : titre auteur", sent[0]?.payload.title === "Koffi", sent[0]?.payload);
    check("DM : corps", sent[0]?.payload.body === "salut", sent[0]?.payload);
    check("DM : lien", sent[0]?.payload.url === "/messages", sent[0]?.payload);
    check("DM : tag", sent[0]?.payload.tag === `dm-${conv}`, sent[0]?.payload);

    reset();
    handler = (sql) => {
      if (sql.includes("from public.conversations")) return { rows: [{ participants: [author] }] };
      return { rows: [] };
    };
    await dispatchDirectMessagePush(author, [{ conversation_id: conv, text: "seul", author_id: author }]);
    check("DM : conversation seule → aucun envoi", sent.length === 0, sent.length);

    // 2. Like : l'auteur du post reçoit, jamais soi-même.
    reset([device("https://push.test/post", other)]);
    handler = (sql) => {
      if (sql.includes("from public.posts")) return { rows: [{ author_id: other, text: "hello" }] };
      if (sql.includes("from public.users")) return { rows: [{ prenom: "Awa", pseudo: "awa" }] };
      return { rows: [] };
    };
    await dispatchActivityPush(author, "post_likes", null, { post_id: post, user_id: author });
    check("like : un envoi", sent.length === 1, sent.length);
    check("like : message", sent[0]?.payload.body === "a aimé ta publication.", sent[0]?.payload);
    check("like : lien", sent[0]?.payload.url === `/post/${post}`, sent[0]?.payload);
    check("like : tag", sent[0]?.payload.tag === `like-${post}`, sent[0]?.payload);

    reset([device("https://push.test/moi", author)]);
    handler = (sql) => {
      if (sql.includes("from public.posts")) return { rows: [{ author_id: author, text: "moi" }] };
      return { rows: [] };
    };
    await dispatchActivityPush(author, "post_likes", null, { post_id: post, user_id: author });
    check("auto-like ignoré", sent.length === 0, sent.length);

    // 3. Commentaire : auteur du post.
    reset([device("https://push.test/comment", other)]);
    handler = (sql) => {
      if (sql.includes("from public.posts")) return { rows: [{ author_id: other }] };
      if (sql.includes("from public.users")) return { rows: [{ prenom: "Awa", pseudo: "awa" }] };
      return { rows: [] };
    };
    await dispatchActivityPush(author, "comments", null, { post_id: post, author_id: author, text: "bravo" });
    check("commentaire : un envoi", sent.length === 1, sent.length);
    check("commentaire : titre", sent[0]?.payload.title === "Awa a commenté", sent[0]?.payload);
    check("commentaire : corps", sent[0]?.payload.body === "« bravo »", sent[0]?.payload);
    check("commentaire : tag", sent[0]?.payload.tag === `comment-${post}`, sent[0]?.payload);

    // 3 bis. Réponse à un commentaire : c'est l'auteur du parent qui reçoit.
    reset([device("https://push.test/parent", third)]);
    handler = (sql) => {
      if (sql.includes("from public.comments")) return { rows: [{ author_id: third }] };
      if (sql.includes("from public.posts")) return { rows: [{ author_id: other }] };
      if (sql.includes("from public.users")) return { rows: [{ prenom: "Awa", pseudo: "awa" }] };
      return { rows: [] };
    };
    await dispatchActivityPush(author, "comments", null, {
      post_id: post,
      author_id: author,
      text: "d'accord",
      parent_id: comment,
    });
    check("réponse : un envoi", sent.length === 1, sent.length);
    check("réponse : bon appareil", sent[0]?.endpoint === "https://push.test/parent", sent[0]?.endpoint);
    check("réponse : titre", sent[0]?.payload.title === "Awa t'a répondu", sent[0]?.payload);

    // 3 ter. Commentaire GIF seul : la bannière doit le dire.
    reset([device("https://push.test/gif", other)]);
    handler = (sql) => {
      if (sql.includes("from public.posts")) return { rows: [{ author_id: other }] };
      if (sql.includes("from public.users")) return { rows: [{ prenom: "Awa", pseudo: "awa" }] };
      return { rows: [] };
    };
    await dispatchActivityPush(author, "comments", null, {
      post_id: post,
      author_id: author,
      text: "",
      gif_url: "https://media.giphy.com/media/x/giphy.gif",
    });
    check("commentaire GIF : un envoi", sent.length === 1, sent.length);
    check(
      "commentaire GIF : corps",
      sent[0]?.payload.body === "a envoyé un GIF en commentaire.",
      sent[0]?.payload,
    );

    // 4. Message de groupe : tous les membres sauf l'auteur.
    reset([device("https://push.test/g1", other), device("https://push.test/g2", third)]);
    handler = (sql) => {
      if (sql.includes("from public.group_members")) {
        return { rows: [{ user_id: author }, { user_id: other }, { user_id: third }] };
      }
      if (sql.includes("from public.groups")) return { rows: [{ name: "Équipe" }] };
      if (sql.includes("from public.users")) return { rows: [{ prenom: "Koffi", pseudo: "koffi" }] };
      return { rows: [] };
    };
    await dispatchActivityPush(author, "group_messages", null, {
      group_id: group,
      channel_id: channel,
      author_id: author,
      text: "hello groupe",
    });
    check("groupe : deux appareils", sent.length === 2, sent.length);
    const endpoints = sent.map((s) => s.endpoint).sort();
    check("groupe : bons destinataires", endpoints.join(",") === "https://push.test/g1,https://push.test/g2", endpoints);
    check("groupe : titre = nom du groupe", sent[0]?.payload.title === "Équipe", sent[0]?.payload);
    check("groupe : corps avec auteur", sent[0]?.payload.body === "Koffi : hello groupe", sent[0]?.payload);
    check("groupe : lien groupe", sent[0]?.payload.url === `/groups/${group}`, sent[0]?.payload);
    check("groupe : tag canal", sent[0]?.payload.tag === `group-${group}-${channel}`, sent[0]?.payload);

    // 4 bis. Auteur seul dans le groupe : personne à réveiller.
    reset([device("https://push.test/g1", author)]);
    handler = (sql) => {
      if (sql.includes("from public.group_members")) return { rows: [{ user_id: author }] };
      if (sql.includes("from public.groups")) return { rows: [{ name: "Solitaire" }] };
      return { rows: [] };
    };
    await dispatchActivityPush(author, "group_messages", null, {
      group_id: group,
      channel_id: channel,
      author_id: author,
      text: "seul",
    });
    check("groupe : auteur seul → aucun envoi", sent.length === 0, sent.length);

    // 5. Réponse à un statut : l'autre participant.
    reset([device("https://push.test/story", other)]);
    handler = (sql) => {
      if (sql.includes("from public.conversations")) return { rows: [{ participants: [author, other] }] };
      if (sql.includes("from public.users")) return { rows: [{ prenom: "Koffi", pseudo: "koffi" }] };
      return { rows: [] };
    };
    await dispatchStoryReplyPush({ actorId: author, conversationId: conv, body: "bien vu" });
    check("statut : un envoi", sent.length === 1, sent.length);
    check("statut : corps", sent[0]?.payload.body.includes("a répondu à ton statut"), sent[0]?.payload);
    check("statut : lien", sent[0]?.payload.url === `/messages?c=${encodeURIComponent(conv)}`, sent[0]?.payload);
    check("statut : tag", sent[0]?.payload.tag === `story-${conv}`, sent[0]?.payload);

    // 6. Cas muets : table neutre, ligne sans identifiant.
    reset([device("https://push.test/other", other)]);
    await dispatchActivityPush(author, "posts", null, { text: "x" });
    check("table neutre ignorée", sent.length === 0, sent.length);

    reset([device("https://push.test/other", other)]);
    handler = () => ({ rows: [{ author_id: other }] });
    await dispatchActivityPush(author, "post_likes", null, {});
    check("ligne sans post_id ignorée", sent.length === 0, sent.length);
  } finally {
    pushTransport.send = originalSend;
  }

  console.log(`\n${passed} vérifications push réussies.`);
  if (failures.length) {
    console.error(`\n${failures.length} échec(s) :`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log("Push : messages, likes, commentaires, groupes et statuts conformes.");
}

void main();
