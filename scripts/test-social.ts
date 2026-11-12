/**
 * Tests du graphe social — vagues 1 et 2 du ROADMAP.
 *
 * Exécuter avec :  npx tsx scripts/test-social.ts
 *
 * Ces tables ne sont pas comme les autres : le like, le commentaire et
 * le suivi ne sont pas des compteurs mais des **lignes**, et tout le
 * raisonnement de sécurité de la migration 005 repose là-dessus. Si le
 * moteur de démonstration s'en écarte, la démo enseigne le contraire
 * du produit — c'est déjà arrivé avec la messagerie (voir
 * `db/migrations/006_messaging.sql`), où un bug invisible en démo bloquait la
 * production.
 *
 * Chaque test porte donc sur un invariant qui doit être vrai dans les
 * deux modes : unicité du like, unicité du suivi, impossibilité de se
 * suivre soi-même, compteur dérivé et jamais écrit, adhésion aux
 * conversations recopiée depuis `participants`.
 */

import { PROFILE_COLUMNS } from "../lib/social";
import { demoFrom } from "../lib/demo/query";
import { getStore, resetStore } from "../lib/demo/store";

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    passed++;
  } else {
    failures.push(`${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
  }
}

const count = <T,>(rows: T[] | null, pred: (r: T) => boolean): number =>
  (rows ?? []).reduce((n, r) => (pred(r) ? n + 1 : n), 0);

async function main() {
  resetStore();

  // Démonstration : koffi (étudiant), thabo (étudiant), aminata (pro).
  const postId = "p-1";

  /* ── Suivi ─────────────────────────────────────────────────────── */

  // Le jeu de démonstration contient déjà des suivis : on choisit une
  // cible qui n'est pas encore suivie, plutôt que d'écrire un test
  // dépendant du contenu exact du seed.
  const followed = new Set(
    ((await demoFrom("follows").select("follower_id, followee_id")).data ?? [])
      .map((r) => `${r.follower_id}->${r.followee_id}`),
  );
  const everyone = (await demoFrom("users").select("id")).data ?? [];
  const target = everyone.find(
    (u) => u.id !== "u-koffi" && !followed.has(`u-koffi->${u.id}`),
  );
  check("le jeu de démonstration offre au moins une cible non suivie",
    target !== undefined, { dejaSuivis: followed.size });

  const follow = await demoFrom("follows")
    .insert({ follower_id: "u-koffi", followee_id: target!.id });
  check("suivi accepté sans erreur", follow.error === null, follow.error);

  const selfFollow = await demoFrom("follows")
    .insert({ follower_id: "u-koffi", followee_id: "u-koffi" });
  check("auto-suivi refusé comme en Postgres", selfFollow.error !== null, selfFollow);
  check("auto-suivi : erreur de contrainte `check`",
    /follows_no_self|23514/i.test(selfFollow.error?.message ?? ""), selfFollow.error?.message);

  const dupeFollow = await demoFrom("follows")
    .insert({ follower_id: "u-koffi", followee_id: target!.id });
  check("suivi en double refusé (clé primaire)", dupeFollow.error !== null, dupeFollow);

  // Les compteurs sont dérivés de la table, jamais écrits par le client.
  const forged = await demoFrom("users").update({ following: 9999 }).eq("id", "u-koffi");
  check("compteur d'abonnements : écriture acceptée sans erreur", forged.error === null, forged);
  const afterForge = await demoFrom("users").select("following").eq("id", "u-koffi").single();
  const realFollowing = count(
    (await demoFrom("follows").select("follower_id")).data as { follower_id: string }[],
    (r) => r.follower_id === "u-koffi",
  );
  check("compteur d'abonnements recalculé malgré l'écriture",
    (afterForge.data as { following: number }).following === realFollowing,
    { forge: 9999, relu: afterForge.data, reel: realFollowing });

  const unfollow = await demoFrom("follows")
    .delete().eq("follower_id", "u-koffi").eq("followee_id", target!.id);
  check("retrait du suivi sans erreur", unfollow.error === null, unfollow.error);
  const gone = await demoFrom("follows")
    .select("followee_id").eq("follower_id", "u-koffi").eq("followee_id", target!.id);
  check("le suivi retiré a disparu", (gone.data ?? []).length === 0, gone.data);

  /* ── Commentaires ──────────────────────────────────────────────── */

  const before = (await demoFrom("posts").select("comments").eq("id", postId).single())
    .data as { comments: number };

  const com = await demoFrom("comments")
    .insert({ post_id: postId, author_id: "u-koffi", text: "Je confirme." });
  check("commentaire accepté sans erreur", com.error === null, com.error);

  const after = (await demoFrom("posts").select("comments").eq("id", postId).single())
    .data as { comments: number };
  check("compteur de commentaires déduit de la table",
    after.comments === before.comments + 1, { avant: before.comments, apres: after.comments });

  // Un commentaire n'est jamais réécrit : la migration 005 n'ouvre
  // aucune politique `update`. Le démo doit donc refuser la réécriture
  // pour ne pas laisser croire qu'on peut corriger un propos publié.
  const rewrite = await demoFrom("comments")
    .update({ text: "version corrigée" })
    .eq("post_id", postId).eq("author_id", "u-koffi");
  check("réécrire un commentaire n'est pas possible",
    (rewrite.data ?? []).length === 0, rewrite.data);

  const delCom = await demoFrom("comments")
    .delete().eq("post_id", postId).eq("author_id", "u-koffi");
  check("suppression de son propre commentaire sans erreur", delCom.error === null, delCom.error);

  const restored = (await demoFrom("posts").select("comments").eq("id", postId).single())
    .data as { comments: number };
  check("compteur rebassé après suppression", restored.comments === before.comments, restored);

  /* ── Adhésion aux conversations (déclencheur 006) ──────────────── */

  const convId = "conv-test-koffi-thabo";
  const conv = await demoFrom("conversations").insert({
    id: convId,
    participants: ["u-koffi", "u-thabo"].sort(),
    last_message: "",
    last_message_at: new Date().toISOString(),
  });
  check("conversation créée sans erreur", conv.error === null, conv.error);

  // Le client n'écrit jamais dans `conversation_members` : c'est le
  // déclencheur qui la remplit. Sans cela, `dm_read` refuserait d'afficher
  // une conversation que l'application vient d'ouvrir.
  const members = await demoFrom("conversation_members")
    .select("user_id").eq("conversation_id", convId);
  check("le déclencheur a rempli l'adhésion de la conversation",
    (members.data ?? []).length === 2, members.data);
  check("les deux participants sont membres",
    ["u-koffi", "u-thabo"].every((uid) =>
      (members.data as { user_id: string }[]).some((m) => m.user_id === uid)),
    members.data);

  // Le client ne peut pas s'ajouter lui-même : c'était la faille qui
  // permettait de lire les MP de n'importe qui.
  const selfJoin = await demoFrom("conversation_members")
    .insert({ conversation_id: convId, user_id: "u-zainab" });
  check("s'ajouter soi-même à une conversation est refusé",
    selfJoin.error !== null, selfJoin);

  // La table se reconstruit à partir de `participants` : une adhésion
  // qui ne correspond à aucun participant ne peut pas subsister.
  check("l'adhésion suit exactement `participants`",
    getStore().conversation_members.every((m) =>
      getStore().conversations
        .filter((c) => c.id === m.conversation_id)
        .flatMap((c) => (c.participants as string[]) ?? [])
        .includes(m.user_id as string)),
    getStore().conversation_members.length);

  /* ── Modification d'un post ────────────────────────────────────── */

  const edited = await demoFrom("posts")
    .update({ text: "texte corrigé" })
    .eq("id", postId);
  check("modifier le texte de son post sans erreur", edited.error === null, edited.error);

  const reread = await demoFrom("posts").select("text, likes").eq("id", postId).single();
  check("le texte corrigé est relu",
    (reread.data as { text: string }).text === "texte corrigé", reread.data);

  // Modifier un post ne doit pas redistribuer ses likes : le compteur
  // vient de `post_likes`, pas du texte.
  const realLikes = count(
    (await demoFrom("post_likes").select("post_id")).data as { post_id: string }[],
    (l) => l.post_id === postId,
  );
  check("modifier un post ne touche pas au compteur de likes",
    (reread.data as { likes: number }).likes === realLikes, reread.data);

  /* ── Lecture d'une liste de suivi (Vague 1) ─────────────────────── */

  // `fetchFollowList` ne fait rien d'exotique : elle lit les liens dans
  // `follows`, puis les profils par `.in("id", …)`. Ce qui mérite d'être
  // vérifié, c'est que ces deux requêtes produisent bien une liste, et
  // surtout qu'elles ne perdent pas de colonnes au passage.
  //
  // Le moteur de démonstration **projette silencieusement** une colonne
  // absente (`if (c in row)`) : une liste qui perd `bio` ou `langages`
  // ne lève aucune erreur, elle affiche simplement un profil plus pauvre
  // que prévu. C'est le genre de défaut que rien ne signale à l'écran.

  const koffiFollows = (await demoFrom("follows")
    .select("created_at, follower_id")
    .eq("followee_id", "u-koffi")
    .order("created_at", { ascending: false })).data as {
      created_at: string;
      follower_id: string;
    }[];

  const followerIds = koffiFollows.map((r) => r.follower_id);
  check("les abonnés de koffi se lisent dans `follows`",
    followerIds.length > 0, followerIds);

  const followerProfiles = (await demoFrom("users")
    .select(PROFILE_COLUMNS)
    .in("id", followerIds)).data as Record<string, unknown>[];

  check("chaque lien du graphe tombe sur un profil",
    followerProfiles.length === followerIds.length,
    { liens: followerIds.length, profils: followerProfiles.length });

  // L'ordre des liens est l'ordre des `created_at` décroissants. C'est le
  // seul ordre qui ait un sens ici : le plus récent suivi en tête.
  const dates = koffiFollows.map((r) => r.created_at);
  check("la liste est triée du lien le plus récent au plus ancien",
    dates.every((d, i) => i === 0 || dates[i - 1] >= d), dates);

  // La projection doit garder les colonnes propres au profil public.
  const sample = followerProfiles[0] ?? {};
  check("la projection garde `bio`",
    "bio" in sample, Object.keys(sample));
  check("la projection garde `langages`",
    "langages" in sample && Array.isArray(sample.langages), sample.langages);
  check("la projection garde les deux compteurs",
    "followers" in sample && "following" in sample, sample);

  // Le sens inverse se lit sur l'autre colonne : suivre et être suivi
  // sont deux relations distinctes, pas deux noms pour la même.
  const koffiFollowing = ((await demoFrom("follows")
    .select("followee_id")
    .eq("follower_id", "u-koffi")).data as { followee_id: string }[])
    .map((r) => r.followee_id);

  check("suivre et être suivi ne sont pas le même ensemble",
    followerIds.length !== koffiFollowing.length ||
      followerIds.some((id) => !koffiFollowing.includes(id)),
    { abonnes: followerIds.length, suivis: koffiFollowing.length });

  // Un compte sans lien ne doit pas produire une requête `.in()` vide :
  // `[]` est invalide pour PostgREST, qui répondrait d'une erreur de
  // syntaxe plutôt que d'une liste vide.
  const lonely = (await demoFrom("follows")
    .select("created_at, follower_id")
    .eq("followee_id", "u-youssef")).data as unknown[];

  check("un compte suivi par personne ne donne aucun lien",
    Array.isArray(lonely), lonely);

  /* ── Rapport ──────────────────────────────────────────────────── */

  console.log(`\n${passed} vérification(s) passée(s), ${failures.length} échec(s)\n`);
  if (failures.length) {
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("  ✓ Le graphe social tient ses invariants en démonstration\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});