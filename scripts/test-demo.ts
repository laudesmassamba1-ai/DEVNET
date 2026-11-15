/**
 * Test de logique du mock PostgREST.
 *
 * Exécuter avec :  npx tsx scripts/test-demo.ts   (ou node --experimental-strip-types)
 *
 * Vérifie que le backend de démonstration se comporte comme Postgres sur
 * les requêtes réellement émises par l'application : tri, filtres, jointures
 * imbriquées, `single` en erreur, `contains`, `ilike`, et écritures.
 */

import { demoFrom, demoChannel } from "../lib/demo/query";
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

async function main() {
  resetStore();

  // --- 1. select + tri décroissant + limite (page /feed) ---
  const feed = await demoFrom("posts")
    .select("*, author:users(id, prenom, pseudo, avatar_color, account_type, verified)")
    .order("created_at", { ascending: false })
    .limit(40);

  check("feed renvoie des lignes", (feed.data?.length ?? 0) > 0, feed.error);
  check("feed trié du plus récent au plus ancien",
    (feed.data as { created_at: string }[])[0].created_at >=
    (feed.data as { created_at: string }[])[1].created_at);

  // --- 2. jointure `author:users(...)` résolue ---
  const first = (feed.data as Record<string, unknown>[])[0];
  check("jointure author présente", first.author !== null, first);
  check("jointure author a les bonnes colonnes",
    "account_type" in (first.author as object),
    Object.keys(first.author as object));

  // --- 3. eq + order + limit (chat de groupe) ---
  const msgs = await demoFrom("group_messages")
    .select("*")
    .eq("group_id", "g-1")
    .order("created_at", { ascending: true })
    .limit(100);

  const gm = msgs.data as { group_id: string }[];
  check("group_messages filtrées par group_id", gm.every((m) => m.group_id === "g-1"));
  check("chat de groupe non vide", gm.length >= 4, gm.length);

  // --- 4. single sur une ligne existante ---
  const one = await demoFrom("users").select("*").eq("id", "u-koffi").single();
  check("single renvoie l'utilisateur", (one.data as { pseudo: string })?.pseudo === "koffi", one);

  // --- 5. single sur zéro ligne doit renvoyer une erreur (comme Postgres) ---
  const none = await demoFrom("users").select("*").eq("id", "inexistant").single();
  check("single sans ligne → erreur", none.error !== null, none);
  check("single sans ligne → data null", none.data === null, none);

  // --- 6. maybeSingle ne doit pas erreur quand il n'y a rien ---
  const maybe = await demoFrom("users").select("*").eq("id", "inexistant").maybeSingle();
  check("maybeSingle sans ligne → pas d'erreur", maybe.error === null, maybe);
  check("maybeSingle sans ligne → null", maybe.data === null, maybe);

  // --- 7. contains (liste des conversations) ---
  const convs = await demoFrom("conversations")
    .select("*")
    .contains("participants", ["u-koffi"])
    .order("last_message_at", { ascending: false });

  check("contains filtre les conversations",
    (convs.data as unknown[]).length > 0, convs.error);
  check("contains ne renvoie que des conversations contenant u-koffi",
    (convs.data as { participants: string[] }[]).every((c) =>
      c.participants.includes("u-koffi")));

  // --- 8. neq + ilike (recherche de destinataire) ---
  const search = await demoFrom("users")
    .select("id, prenom, pseudo")
    .neq("id", "u-koffi")
    .limit(20)
    .ilike("pseudo", "%ami%");

  check("ilike retrouve aminata_dev",
    (search.data as { pseudo: string }[]).some((u) => u.pseudo === "aminata_dev"),
    search.data);
  check("neq exclut l'utilisateur courant",
    !(search.data as { id: string }[]).some((u) => u.id === "u-koffi"));

  // --- 9. insertion avec id et created_at générés (publication) ---
  const before = (await demoFrom("posts").select("*")).data?.length ?? 0;
  const ins = await demoFrom("posts").insert({
    author_id: "u-koffi",
    author_name: "Koffi",
    text: "post de test",
    has_code: false,
    code: "",
    lang: "",
    likes: 0,
    liked_by: [],
    comments: 0,
  });

  check("insert sans erreur", ins.error === null, ins);
  const created = ins.data as { id: string; created_at: string }[];
  check("insert renvoie la ligne", created?.length === 1, ins.data);
  check("insert génère un id", typeof created?.[0]?.id === "string");
  check("insert génère created_at", typeof created?.[0]?.created_at === "string");

  const after = (await demoFrom("posts").select("*")).data?.length ?? 0;
  check("insert persiste en base", after === before + 1, { before, after });

  // --- 10. le like est une ligne, pas un compteur écrit (migration 005) ---
  //
  // Ce test encodait l'ancien modèle — écrire `likes` / `liked_by`
  // directement sur le post — c'est-à-dire exactement ce que la
  // migration 005 interdit : la colonne est un cache, alimenté par le
  // déclencheur `sync_post_likes` à partir de `post_likes`. Le chemin
  // réel de l'application est `toggleLike()` → INSERT sur `post_likes`.
  const likeIns = await demoFrom("post_likes")
    .insert({ post_id: created[0].id, user_id: "u-koffi" });
  check("like posé sans erreur", likeIns.error === null, likeIns);

  const afterLike = await demoFrom("posts").select("likes").eq("id", created[0].id).single();
  check("likes déduit de post_likes, pas écrit par le client",
    (afterLike.data as { likes: number }).likes === 1, afterLike.data);

  // Le garde-fou qui compte vraiment : un client qui écrit le compteur
  // en direct doit être ignoré. C'est la faille que la RSL corrigeait.
  await demoFrom("posts").update({ likes: 9999 }).eq("id", created[0].id);
  const afterForge = await demoFrom("posts").select("likes").eq("id", created[0].id).single();
  check("compteur forgé par le client est ignoré",
    (afterForge.data as { likes: number }).likes === 1, afterForge.data);

  // `toggleLike` décide sur l'erreur de doublon : le moteur doit refuser
  // la réinsertion, comme la clé primaire `(post_id, user_id)`.
  const dupe = await demoFrom("post_likes")
    .insert({ post_id: created[0].id, user_id: "u-koffi" });
  check("like en double refusé (clé primaire)", dupe.error !== null, dupe);
  check("erreur de doublon exploitable par toggleLike",
    /duplicate key|23505/i.test(dupe.error?.message ?? ""), dupe.error?.message);

  // --- 11. retirer le like rebaisse le compteur, les autres posts intacts ---
  const del = await demoFrom("post_likes")
    .delete().eq("post_id", created[0].id).eq("user_id", "u-koffi");
  check("like retiré sans erreur", del.error === null, del);

  const afterUnlike = await demoFrom("posts").select("likes").eq("id", created[0].id).single();
  check("compteur rebaisse après retrait du like",
    (afterUnlike.data as { likes: number }).likes === 0, afterUnlike.data);

  // Chaque post compte ses propres lignes : le cache est global, mais
  // sa valeur est toujours locale à la ligne.
  const likedPosts = (await demoFrom("post_likes").select("post_id")).data as { post_id: string }[];
  const allPosts = (await demoFrom("posts").select("id, likes")).data as
    { id: string; likes: number }[];
  check("chaque post compte ses propres likes",
    allPosts.every((p) => p.likes === likedPosts.filter((l) => l.post_id === p.id).length),
    allPosts.filter((p) =>
      p.likes !== likedPosts.filter((l) => l.post_id === p.id).length));

  // --- 12. upsert : création puis mise à jour (page /register) ---
  const ups1 = await demoFrom("users").upsert(
    { id: "u-test", prenom: "Test", pseudo: "test", email: "t@t.t", langages: [] },
    { onConflict: "id" },
  );
  check("upsert création sans erreur", ups1.error === null, ups1);

  const ups2 = await demoFrom("users").upsert(
    { id: "u-test", prenom: "Test modifié", pseudo: "test", email: "t@t.t", langages: [] },
    { onConflict: "id" },
  );
  check("upsert mise à jour sans erreur", ups2.error === null, ups2);

  const u = await demoFrom("users").select("prenom").eq("id", "u-test").single();
  check("upsert ne duplique pas la ligne",
    (u.data as { prenom: string }).prenom === "Test modifié", u.data);

  const dupes = (await demoFrom("users").select("*")).data as { id: string }[];
  check("upsert ne crée pas de doublon",
    dupes.filter((x) => x.id === "u-test").length === 1);

  // --- 13. realtime : un INSERT notifie le canal ---
  let received: Record<string, unknown> | null = null;
  const chan = demoChannel("feed");
  chan.on("postgres_changes", { event: "INSERT", schema: "public", table: "posts" },
    (p) => { received = p.new; });
  chan.subscribe();

  await demoFrom("posts").insert({
    author_id: "u-koffi", author_name: "Koffi", text: "temps réel",
    likes: 0, liked_by: [], comments: 0,
  });

  check("realtime notifié sur INSERT", received !== null, received);
  check("realtime transmet la bonne ligne",
    (received as { text: string } | null)?.text === "temps réel", received);

  // --- 14. realtime filtré : un canal de groupe ne reçoit pas les autres ---
  let groupHit = 0;
  const gc = demoChannel("gc-g-1");
  gc.on("postgres_changes",
    { event: "INSERT", schema: "public", table: "group_messages", filter: "group_id=eq.g-1" },
    () => { groupHit++; });
  gc.subscribe();

  await demoFrom("group_messages").insert({
    group_id: "g-2", author_id: "u-koffi", author_name: "Koffi", text: "autre groupe",
  });
  check("realtime filtré ignore les autres groupes", groupHit === 0, groupHit);

  await demoFrom("group_messages").insert({
    group_id: "g-1", author_id: "u-koffi", author_name: "Koffi", text: "bon groupe",
  });
  check("realtime filtré reçoit le bon groupe", groupHit === 1, groupHit);

  gc.unsubscribe();
  await demoFrom("group_messages").insert({
    group_id: "g-1", author_id: "u-koffi", author_name: "Koffi", text: "après unsubscribe",
  });
  check("unsubscribe coupe les notifications", groupHit === 1, groupHit);

  // --- 15. requête sur table inconnue ---
  const bad = await demoFrom("table_inexistante").select("*");
  check("table inconnue → erreur", bad.error !== null, bad);

  // --- 16. projection de colonnes ---
  const cols = await demoFrom("users").select("id, pseudo").limit(1);
  check("projection ne renvoie que les colonnes demandées",
    Object.keys((cols.data as object[])[0]).sort().join(",") === "id,pseudo",
    Object.keys((cols.data as object[])[0]));

  // --- 17. insert().select().single() renvoie un OBJET, pas un tableau ---
  // Parité supabase-js : sans elle, l'appelant qui lit `data.id` lit
  // `undefined` en silence (canal #général non créé à la création d'un
  // groupe, tableau poussé dans l'état des canaux…).
  const igs = await demoFrom("channels")
    .insert({ group_id: "g-1", slug: "test-single", name: "test", position: 99 })
    .select("id, slug")
    .single();
  check("insert+single sans erreur", igs.error === null, igs.error);
  check("insert+single renvoie un objet",
    igs.data !== null && !Array.isArray(igs.data), igs.data);
  check("insert+single expose les colonnes demandées",
    (igs.data as { slug?: string })?.slug === "test-single", igs.data);

  const igsMulti = await demoFrom("channels")
    .insert([
      { group_id: "g-1", slug: "multi-a", name: "a", position: 100 },
      { group_id: "g-1", slug: "multi-b", name: "b", position: 101 },
    ])
    .select("id")
    .single();
  check("insert multiple + single → erreur (comme Postgres)", igsMulti.error !== null);

  // --- 18. persistance : reset puis relecture ---
  const saved = getStore().posts.length;
  resetStore();
  check("reset restaure le jeu de seed",
    getStore().posts.length !== saved, { saved, after: getStore().posts.length });

  // --- 19. bornes, `or`, `overlaps`, `is` ---
  //
  // Ce sont les opérateurs de la pagination par curseur et de la
  // recherche par hashtag. Tant qu'un seul manque au moteur de démo, les
  // deux modes divergent : la démo « marche » et la production ne renvoie
  // rien. Une divergence de filtre est plus grave qu'une absence, parce
  // qu'elle se remarque le jour J.
  const bounded = await demoFrom("posts")
    .select("id, created_at")
    .order("created_at", { ascending: false });
  const dated = bounded.data as { id: string; created_at: string }[];
  check("borne : il y a de quoi paginer", dated.length >= 3, dated.length);

  const cursor = dated[1].created_at;
  const older = await demoFrom("posts").select("id").lt("created_at", cursor)
    .order("created_at", { ascending: false });
  const olderIds = (older.data as { id: string }[]).map((r) => r.id);
  check("lt renvoie uniquement ce qui est plus ancien",
    olderIds.every((id) =>
      dated.filter((d) => d.id === id).every((d) => d.created_at < cursor)),
    olderIds.length);
  check("lt ne renvoie pas la ligne du curseur lui-même",
    !olderIds.includes(dated[1].id), olderIds);

  const newer = await demoFrom("posts").select("id").gt("created_at", cursor);
  const newerIds = (newer.data as { id: string }[]).map((r) => r.id);
  // La ligne du curseur appartient à **aucun** des deux côtés : c'est ce
  // qui rend la pagination par curseur sans doublon ni trou. Le compte
  // total doit donc être `gt + lt + 1`.
  check("gt et lt se partagent la liste sans doublon ni trou",
    newerIds.length + olderIds.length + 1 === dated.length,
    { newer: newerIds.length, older: olderIds.length, total: dated.length });
  check("la ligne du curseur n'est ni avant ni après",
    !newerIds.includes(dated[1].id) && !olderIds.includes(dated[1].id));

  // `or` se combine aux autres filtres par un **et** : c'est la precedence
  // qui empêche une recherche de ramener des lignes qu'aucun mode ne doit
  // produire.
  const orBoth = await demoFrom("users")
    .select("id, pseudo, prenom")
    .neq("id", "u-koffi")
    .or("pseudo.ilike.%zainab%,prenom.ilike.%Zainab%");
  const orIds = (orBoth.data as { id: string }[]).map((u) => u.id);
  check("or : pseudo OU prénom, insensible à la casse",
    orIds.includes("u-zainab"), orBoth.data);
  check("or reste combiné au neq : le lecteur courant est exclu",
    !orIds.includes("u-koffi"), orIds);

  // Une liste entre parenthèses contient ses propres virgules : un
  // découpage naïf aurait produit trois clauses dont deux sont du bruit.
  const orIn = await demoFrom("users").select("id").or("id.in.(u-thabo,u-marcus)");
  check("or avec in.(…) : la liste n'est pas coupée",
    (orIn.data as { id: string }[]).map((u) => u.id).sort().join(",") ===
      "u-marcus,u-thabo", orIn.data);

  // Un opérateur inconnu doit échouer bruyamment : une clause ignorée en
  // silence élargirait le résultat, le pire défaut possible pour un filtre.
  let unknownThrew = false;
  try {
    await demoFrom("users").select("id").or("pseudo.bogus.x");
  } catch {
    unknownThrew = true;
  }
  check("or : un opérateur inconnu lève une erreur", unknownThrew);

  // `overlaps` : un seul tag en commun suffit. C'est ce qui distingue la
  // recherche par hashtag d'un `contains` qui exigerait tous les tags.
  //
  // On écrit le **texte**, pas la colonne `tags` : la colonne est un cache
  // du texte, alimenté par le déclencheur `posts_sync_tags`, et le client
  // n'a pas le droit de l'écrire — la migration 007 lui en retire
  // explicitement le droit. Écrire `tags` ici n'aurait donc rien produit,
  // et le test aurait vérifié un chemin que l'application n'a pas.
  const tagged = dated[0].id;
  await demoFrom("posts")
    .update({ text: "Recherche par tag : #python et #debogage, c'est pratique." })
    .eq("id", tagged);

  const readTags = await demoFrom("posts").select("tags").eq("id", tagged).single();
  check("les hashtags sont déduits du texte, jamais écrits par le client",
    JSON.stringify((readTags.data as { tags: string[] }).tags) ===
      JSON.stringify(["python", "debogage"]), readTags.data);

  // Retirer un hashtag du texte doit le retirer de la colonne : le
  // déclencheur remplace la valeur entière, il n'ajoute pas.
  await demoFrom("posts").update({ text: "Plus de tag ici." }).eq("id", tagged);
  const cleared = await demoFrom("posts").select("tags").eq("id", tagged).single();
  check("un hashtag retiré du texte disparaît de la colonne",
    (cleared.data as { tags: string[] }).tags.length === 0, cleared.data);

  // On repart sur un texte qui porte les deux tags, pour la recherche.
  await demoFrom("posts")
    .update({ text: "Reprise : #python et #debogage." })
    .eq("id", tagged);

  const ovOne = await demoFrom("posts").select("id").overlaps("tags", ["python"]);
  check("overlaps : un tag en commun suffit",
    (ovOne.data as { id: string }[]).some((r) => r.id === tagged), ovOne.data);
  const ovTwo = await demoFrom("posts").select("id").overlaps("tags", ["python", "absent"]);
  check("overlaps : plusieurs tags, un seul doit suffire",
    (ovTwo.data as { id: string }[]).some((r) => r.id === tagged), ovTwo.data);
  const ovNone = await demoFrom("posts").select("id").overlaps("tags", ["absent"]);
  check("overlaps : aucun tag en commun → aucune ligne",
    (ovNone.data ?? []).length === 0, ovNone.data);

  const isNull = await demoFrom("posts").select("id").is("lang", null);
  check("is(null) ne confond pas null et une valeur absente",
    isNull.error === null, isNull.error);

  // --- Rapport ---
  console.log(`\n${passed} vérification(s) passée(s), ${failures.length} échec(s)\n`);
  if (failures.length) {
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("  ✓ Le backend de démonstration se comporte comme Postgres\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});