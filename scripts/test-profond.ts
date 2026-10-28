/**
 * Tests de profondeur sociale — migration 018.
 *
 * Exécuter avec :  npx tsx scripts/test-profond.ts
 *
 * La migration 018 ouvre quatre familles de lignes — signets, réponses de
 * commentaires, réactions/épingles de messages, stories. Trois d'entre
 * elles ne pouvaient pas être vérifiées avant : ce fichier les couvre au
 * niveau du **moteur de démonstration**, c'est-à-dire là où une règle
 * oubliée ne casse rien visiblement mais enseigne le contraire du vrai
 * produit.
 *
 * Deux règles méritent d'être énoncées ici, parce qu'elles sont la raison
 * d'être de ce fichier :
 *
 *  · les **épingles** sont privées (`OWNED_BY`) — une lecture trop
 *    permissive ne se voit à rien, l'écran affiche simplement plus de
 *    lignes que prévu ;
 *  · les **stories** portent une échéance appliquée à la lecture — sans
 *    ce filtre, une story morte resterait visible en démo et
 *    disparaîtrait en production, un écart qui ne se verrait que le
 *    lendemain.
 *
 * **Les tests n'emportent aucun avis sur le jeu de démonstration** :
 * chaque cible est un identifiant réel du store, et les lignes ajoutées
 * évitent celles du seed pour ne pas rendre faux le jour où le seed
 * change.
 */

import { demoFrom } from "../lib/demo/query";
import { saveSessionId } from "../lib/demo/session";
import { getStore, resetStore } from "../lib/demo/store";

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) passed++;
  else failures.push(`${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
}

/** Un identifiant de message de groupe réel du seed. */
const aGroupMessage = (): string =>
  String(getStore().group_messages.find((m) => String(m.id).startsWith("gm-"))?.id ?? "gm-1");

/** Un compte qui n'est ni koffi (session de départ) ni déjà épinglé. */
function someoneElse(): string {
  const koffi = "u-koffi";
  const found = getStore().users.find((u) => u.id !== koffi);
  return String(found?.id ?? "u-thabo");
}

async function main() {
  resetStore();
  saveSessionId("u-koffi");

  /* ── Réactions sur un message ──────────────────────────────────── */

  const target = aGroupMessage();

  const reactOk = await demoFrom("message_reactions").insert({
    target_type: "group_message",
    target_id: target,
    user_id: "u-koffi",
    emoji: "\u2705",
  });
  check("une réaction de message est acceptée", reactOk.error === null, reactOk.error);

  // L'énumération est fermée : une icône que l'écran ne sait pas afficher
  // doit être refusée par la base comme par la démo. C'est la contrainte
  // `message_reactions_emoji_check`.
  const badEmoji = await demoFrom("message_reactions").insert({
    target_type: "group_message",
    target_id: target,
    user_id: "u-koffi",
    emoji: "ban",
  });
  check("une icône hors du jeu est refusée", badEmoji.error !== null, badEmoji);
  check("le refus cite la contrainte d'emoji",
    /emoji_check|23514/i.test(badEmoji.error?.message ?? ""), badEmoji.error?.message);

  const badTarget = await demoFrom("message_reactions").insert({
    target_type: "story",
    target_id: target,
    user_id: "u-koffi",
    emoji: "\u2705",
  });
  check("un type de cible inconnu est refusé", badTarget.error !== null, badTarget);

  // Contrairement à une publication, un message autorise **plusieurs**
  // icônes par personne : la table n'a pas de clé composite. On vérifie
  // que la démo ne l'invente pas, sinon un clic sur flame retirerait le check.
  const second = await demoFrom("message_reactions").insert({
    target_type: "group_message",
    target_id: target,
    user_id: "u-koffi",
    emoji: "\u{1F525}",
  });
  check("deux icônes de la même personne sur un message coexistent",
    second.error === null, second.error);

  const mineCount = (
    await demoFrom("message_reactions")
      .select("emoji")
      .eq("target_type", "group_message")
      .eq("target_id", target)
      .eq("user_id", "u-koffi")
  ).data as { emoji: string }[] | null;
  check("les deux réactions sont bien stockées",
    (mineCount ?? []).length >= 2, mineCount);

  const removed = await demoFrom("message_reactions")
    .delete()
    .eq("target_type", "group_message")
    .eq("target_id", target)
    .eq("user_id", "u-koffi")
    .eq("emoji", "\u2705");
  check("retirer une réaction précise ne touche pas les autres",
    removed.error === null && (removed.data as unknown[] | null)?.length === 1, removed);

  // Les réactions de message sont **publiques** : elles s'affichent sur la
  // bulle. Une lecture restreinte au poseur serait une divergence.
  saveSessionId(someoneElse());
  const visible = (
    await demoFrom("message_reactions")
      .select("id")
      .eq("target_id", target)
  ).data as { id: string }[] | null;
  check("un autre compte voit les réactions du message",
    (visible ?? []).length >= 1, visible);
  saveSessionId("u-koffi");

  /* ── Épingles : privées ────────────────────────────────────────── */

  const pinTarget = aGroupMessage();
  const bystander = someoneElse();

  const pinOk = await demoFrom("message_pins").insert({
    target_type: "group_message",
    target_id: pinTarget,
    user_id: "u-koffi",
  });
  check("une épingle est acceptée", pinOk.error === null, pinOk.error);

  // Le poseur voit son épingle.
  const mine = (
    await demoFrom("message_pins").select("target_id")
  ).data as { target_id: string }[] | null;
  check("on voit sa propre épingle",
    (mine ?? []).some((r) => r.target_id === pinTarget), mine);

  // Un autre compte ne la voit pas — c'est le test qui compte : une
  // lecture trop permissive ne se remarque pas.
  saveSessionId(bystander);
  const others = (
    await demoFrom("message_pins").select("target_id")
  ).data as { target_id: string }[] | null;
  check("on ne voit pas l'épingle d'un autre",
    !(others ?? []).some((r) => r.target_id === pinTarget), others);

  // Et on ne peut pas la retirer : la suppression ne porte que sur ses
  // propres lignes (`OWNED_BY` filtre aussi le delete).
  const steal = await demoFrom("message_pins")
    .delete()
    .eq("target_id", pinTarget)
    .select("id");
  check("on ne supprime pas l'épingle d'un autre",
    (steal.data as unknown[] | null)?.length === 0, steal);

  saveSessionId("u-koffi");
  const unPin = await demoFrom("message_pins")
    .delete()
    .eq("target_id", pinTarget)
    .select("id");
  check("on retire sa propre épingle",
    (unPin.data as unknown[] | null)?.length === 1, unPin);

  /* ── Réponses de commentaires ──────────────────────────────────── */

  const post = "p-2";
  const root = await demoFrom("comments")
    .insert({ post_id: post, author_id: "u-koffi", text: "Une question ouverte." })
    .select("id")
    .single();
  const rootId = String((root.data as { id?: string } | null)?.id ?? "");
  check("un commentaire racine s'écrit", root.error === null && rootId !== "", root);

  const reply = await demoFrom("comments")
    .insert({
      post_id: post,
      author_id: "u-thabo",
      text: "Voici ma réponse.",
      parent_id: rootId,
    })
    .select("id, parent_id")
    .single();
  check("une réponse accepte un parent",
    reply.error === null && (reply.data as { parent_id?: string })?.parent_id === rootId,
    reply);

  // La contrainte `comments_parent_not_self` : un commentaire ne peut pas
  // être sa propre réponse. Le client ne fournit pas d'`id`, donc le cas
  // demande un `id` explicite — ce que fait ce test.
  const selfParent = await demoFrom("comments").insert({
    id: "c-self-test",
    post_id: post,
    author_id: "u-koffi",
    text: "Je me réponds.",
    parent_id: "c-self-test",
  });
  check("un commentaire ne peut pas être sa propre réponse",
    selfParent.error !== null, selfParent);
  check("le refus cite la contrainte",
    /comments_parent_not_self|23514/i.test(selfParent.error?.message ?? ""),
    selfParent.error?.message);

  // Le seed contient une **réponse à une réponse** : c'est ce cas qui
  // décide si l'interface sait remonter à la racine. On vérifie qu'il est
  // bien présent, pour que le parcours navigateur ait de quoi le montrer.
  const seedRepliesToReply = getStore().comments.filter(
    (c) => typeof c.parent_id === "string" && String(c.parent_id).startsWith("cr-"),
  );
  check("le seed contient une réponse à une réponse",
    seedRepliesToReply.length >= 1, seedRepliesToReply.length);

  // Et chaque réponse à une racine vise un commentaire du **même** post :
  // un rattachement croisé afficherait une réponse sous un commentaire
  // qu'elle ne répond pas.
  const byId = new Map(getStore().comments.map((c) => [String(c.id), c]));
  const validRoots = getStore().comments
    .filter((c) => c.parent_id && !String(c.parent_id).startsWith("cr-"))
    .every((c) => {
      const parent = byId.get(String(c.parent_id));
      return parent !== undefined && parent.post_id === c.post_id;
    });
  check("les réponses à une racine visent un commentaire du même post", validRoots);

  /* ── Stories ───────────────────────────────────────────────────── */

  // Le seed contient une story périmée ; elle ne doit exister nulle part,
  // ni dans le store ni dans une lecture.
  const seededExpired = getStore().stories.some((s) => s.id === "s-3");
  check("la story périmée du seed est retirée", !seededExpired);

  const live = await demoFrom("stories").insert({
    author_id: "u-koffi",
    caption: "Une story de test, vivante.",
  }).select("id, expires_at, caption, media_url").single();
  const liveRow = live.data as {
    id?: string; expires_at?: string; caption?: string; media_url?: string;
  } | null;
  check("une story s'écrit", live.error === null && liveRow?.id !== undefined, live);

  // `expires_at` est un défaut SQL (`now() + 24 h`). Sans son rejeu, la
  // story naîtrait périmée et disparaîtrait à la seconde — sans erreur.
  const inHours = liveRow?.expires_at
    ? (Date.parse(liveRow.expires_at) - Date.now()) / 3_600_000
    : -1;
  check("l'échéance par défaut vaut environ 24 h",
    inHours > 23.9 && inHours <= 24.1, inHours);
  check("les colonnes par défaut sont posées",
    liveRow?.caption === "Une story de test, vivante." && liveRow?.media_url === "",
    liveRow);

  const readLive = (
    await demoFrom("stories").select("id").eq("id", liveRow?.id ?? "")
  ).data as { id: string }[] | null;
  check("la story vivante est lisible", (readLive ?? []).length === 1, readLive);

  // Une story explicitement périmée n'est pas lue : c'est la politique
  // `stories_read` (`expires_at > now()`), et elle doit tenir en démo.
  await demoFrom("stories").insert({
    id: "s-dead-test",
    author_id: "u-koffi",
    caption: "Périmée.",
    expires_at: new Date(Date.now() - 3_600_000).toISOString(),
  });
  const deadRead = (
    await demoFrom("stories").select("id").eq("id", "s-dead-test")
  ).data as { id: string }[] | null;
  check("une story périmée ne remonte pas", (deadRead ?? []).length === 0, deadRead);

  /* ── Connexions : strictement personnelles ─────────────────────── */

  // `u-koffi` a déjà une connexion `github` (004). On en pose une autre
  // **d'un fournisseur distinct** : `unique (user_id, provider)` en
  // autorise une par fournisseur, et un second `github` serait — à juste
  // titre — refusé comme la base le ferait.
  const connect = await demoFrom("github_connections")
    .insert({
      id: "gh-test-1",
      user_id: "u-koffi",
      provider: "gitlab",
      login: "koffi-test",
      token_ref: "vault://gitlab/u-koffi",
    })
    .select("login")
    .single();
  check("une connexion s'enregistre",
    connect.error === null && (connect.data as { login?: string })?.login === "koffi-test",
    connect);

  // La connexion est **strictement personnelle** (migration 004,
  // `gh_self_read`). Un autre compte ne doit pas la lire.
  saveSessionId(someoneElse());
  const stolen = (
    await demoFrom("github_connections").select("id, login")
  ).data as { id: string }[] | null;
  check("on ne lit pas la connexion d'un autre",
    !(stolen ?? []).some((r) => r.id === "gh-test-1"), stolen);

  saveSessionId("u-koffi");
  const myConn = (
    await demoFrom("github_connections").select("id").eq("id", "gh-test-1")
  ).data as { id: string }[] | null;
  check("on lit sa propre connexion",
    (myConn ?? []).length === 1, myConn);

  /* ── Rapport ───────────────────────────────────────────────────── */

  saveSessionId(null);
  console.log(`\n${passed} vérification(s) passée(s), ${failures.length} échec(s)\n`);
  if (failures.length) {
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("  ✓ La profondeur sociale tient ses invariants en démonstration\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
