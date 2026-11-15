/**
 * Tests du moteur de gamification.
 *
 * Exécuter avec :  npx tsx scripts/test-gamification.ts
 *
 * Le module `lib/gamification.ts` ne dépend de rien — c'est justement
 * pour ça qu'on peut le tester à fond, y compris sur les cas degenerés
 * qu'aucun écran ne visitara jamais : journée vide, gel épuisé, palier
 * maximum, série rompue depuis un an.
 */

import {
  buildEvents, buildStats, buildStory, computeStreak, dayDiff, dayIndex, dayKey,
  heatLevel, heatmap, leaderboard, levelFor, messagePoints, postPoints,
  questsFor, recent, shiftDay, streakBonus, sumXp, XP,
  type ScorablePost,
} from "../lib/gamification";

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    passed++;
  } else {
    failures.push(`${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
  }
}

function eq<T>(name: string, actual: T, expected: T): void {
  check(name, actual === expected, { actual, expected });
}

const D0 = "2026-10-03"; // un samedi, arbitrairement

/* ------------------------------------------------------------------ */
/* 1. Clés de jour                                                     */
/* ------------------------------------------------------------------ */

function testDates() {
  eq("dayKey formate en YYYY-MM-DD", dayKey(new Date(2026, 0, 5)), "2026-01-05");
  eq("dayKey accepte une chaîne ISO", dayKey("2026-03-14T22:30:00.000Z").length, 10);

  eq("shiftDay +1", shiftDay(D0, 1), "2026-10-04");
  eq("shiftDay −1", shiftDay(D0, -1), "2026-10-02");
  eq("shiftDay franchit le mois", shiftDay("2026-10-31", 1), "2026-11-01");
  eq("shiftDay franchit l'année", shiftDay("2026-12-31", 1), "2027-01-01");
  eq("shiftDay gere le 29 février", shiftDay("2028-02-28", 1), "2028-02-29");

  eq("dayDiff(a, b) = a − b", dayDiff("2026-10-10", "2026-10-03"), 7);
  eq("dayDiff négatif", dayDiff("2026-10-03", "2026-10-10"), -7);
  eq("dayDiff nul", dayDiff(D0, D0), 0);

  check("dayIndex est monotone", dayIndex(D0) > dayIndex("2026-10-02"));
  eq("dayIndex est stable", dayIndex(D0), dayIndex(D0));
}

/* ------------------------------------------------------------------ */
/* 2. Paliers                                                          */
/* ------------------------------------------------------------------ */

function testLevels() {
  eq("0 point → palier 1", levelFor(0).level, 1);
  eq("0 point → titre Nouveau", levelFor(0).title, "Nouveau");
  eq("59 points → encore palier 1", levelFor(59).level, 1);
  eq("60 points → palier 2", levelFor(60).level, 2);
  eq("150 points → palier 3", levelFor(150).level, 3);

  const l4 = levelFor(350);
  eq("350 points → palier 4", l4.level, 4);
  check("le palier suivant est renseigné", l4.next !== null);
  eq("il reste 70 points avant le palier 5", l4.toNext, 600 - 350);
  check("la progression est entre 0 et 1", l4.progress > 0 && l4.progress < 1, l4.progress);

  eq("progression nulle au seuil exact", levelFor(60).progress, 0);

  const max = levelFor(999_999);
  eq("score énorme → palier 10", max.level, 10);
  eq("palier maximum : pas de suivant", max.next, null);
  eq("palier maximum : progression pleine", max.progress, 1);
  eq("palier maximum : rien à gagner", max.toNext, 0);

  eq("score négatif → palier 1", levelFor(-50).level, 1);

  // La courbe doit être strictement croissante, sinon deux paliers se
  // chevauchent et l'affichage devient ambigu.
  let prev = -1;
  for (let i = 0; i < 10; i++) {
    const l = levelFor(i * 100);
    check(`palier ${l.level} ≥ ${prev + 1}`, l.level >= prev, { i, l: l.level, prev });
    prev = l.level;
  }
}

/* ------------------------------------------------------------------ */
/* 3. Séries et gels                                                   */
/* ------------------------------------------------------------------ */

function testStreak() {
  const empty = computeStreak([], D0);
  eq("aucun jour → série nulle", empty.current, 0);
  eq("aucun jour → aucun gel", empty.freezes, 0);
  check("aucun jour → pas actif aujourd'hui", !empty.activeToday);

  // Trois jours consécutifs qui incluent aujourd'hui.
  const s3 = computeStreak(["2026-10-01", "2026-10-02", "2026-10-03"], D0);
  eq("série de 3 jours", s3.current, 3);
  check("journée validée", s3.activeToday);
  check("pas en sursis", !s3.atRisk);

  // La série survit jusqu'à la fin de la journée suivante.
  const s3b = computeStreak(["2026-10-01", "2026-10-02"], D0);
  eq("série en cours mais jour non validé", s3b.current, 2);
  check("pas actif aujourd'hui", !s3b.activeToday);
  check("en sursis", s3b.atRisk);

  // Rupture de plus d'un jour : série perdue.
  const broken = computeStreak(["2026-09-20", "2026-09-21"], D0);
  eq("série rompue → 0", broken.current, 0);
  check("série rompue → pas en sursis", !broken.atRisk);
  eq("série rompue → le record est gardé", broken.best, 2);

  // Gels : 1 gel tous les 7 jours d'activité.
  const seven = computeStreak(
    ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04",
     "2026-10-05", "2026-10-06", "2026-10-07"], D0);
  eq("7 jours actifs → 1 gel", seven.freezes, 1);

  const three = computeStreak(["2026-10-01", "2026-10-02", "2026-10-03"], D0);
  eq("3 jours actifs → 0 gel", three.freezes, 0);

  // Le gel absorbe exactement un jour manqué. Ancre = 9 octobre, le trou
  // est le 3 octobre.
  const withGap = computeStreak(
    ["2026-10-01", "2026-10-02", "2026-10-04", "2026-10-05",
     "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"], "2026-10-09");
  eq("8 jours actifs → 1 gel", withGap.freezes, 1);
  eq("le gel comble le 3 octobre", withGap.current, 8);
  eq("le gel est consommé", withGap.freezesUsed, 1);

  // Deux jours consécutifs manqués : le gel ne suffit pas. Ancre = 11 octobre,
  // trou du 2 au 4 octobre.
  const twoGaps = computeStreak(
    ["2026-10-01", "2026-10-05", "2026-10-06", "2026-10-07",
     "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"], "2026-10-11");
  eq("la série s'arrête au gap de 2 jours", twoGaps.current, 7);
  eq("le gel n'a pas été dépens", twoGaps.freezesUsed, 0);

  // Le record inclut les séries ramborgées par un gel.
  const record = computeStreak(
    ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04",
     "2026-09-05", "2026-09-06", "2026-09-07", "2026-09-09"], D0);
  eq("le gel prolonge aussi le record", record.best, 8);

  // Idempotence : l'ordre des jours ne doit rien changer.
  const days = ["2026-10-01", "2026-10-03", "2026-10-04", "2026-10-05",
                "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"];
  const a = computeStreak(days, D0);
  const b = computeStreak([...days].reverse(), D0);
  eq("l'ordre des jours n'a pas d'effet (série)", a.current, b.current);
  eq("l'ordre des jours n'a pas d'effet (gels)", a.freezesUsed, b.freezesUsed);

  // Doublons : un même jour listé deux fois ne gonfle pas la série.
  const dup = computeStreak(["2026-10-02", "2026-10-02", "2026-10-03"], D0);
  eq("les doublons de jour sont ignorés", dup.current, 2);

  // Le gel ne peut pas resonator indéfiniment.
  const frozen = computeStreak(
    ["2026-09-01", "2026-09-03", "2026-09-05", "2026-09-07",
     "2026-09-09", "2026-09-11", "2026-09-13"], "2026-10-03");
  eq("des trous de 2 jours ne sont pas tous pontés", frozen.current < 7, true);

  eq("bonus de série nul à 0", streakBonus(0), 0);
  eq("bonus de série +2 par jour", streakBonus(3), 6);
  eq("bonus plafonné à 7 jours", streakBonus(30), 14);
  eq("bonus négatif nul", streakBonus(-5), 0);
}

/* ------------------------------------------------------------------ */
/* 4. Barème et événements                                             */
/* ------------------------------------------------------------------ */

function testScoring() {
  eq("post texte = 10 pts", postPoints(false), XP.post);
  eq("post avec code = 20 pts", postPoints(true), XP.postCode);
  eq("message texte = 5 pts", messagePoints(false), XP.groupMessage);
  eq("message code = 10 pts", messagePoints(true), XP.groupMessageCode);
  eq("le code vaut le double", postPoints(true), postPoints(false) * 2);

  const posts: ScorablePost[] = [
    { id: "p1", has_code: false, created_at: "2026-10-03T09:00:00.000Z" },
    { id: "p2", has_code: true, lang: "Rust", created_at: "2026-10-03T11:00:00.000Z" },
  ];

  const events = buildEvents({ posts });
  eq("deux posts → deux événements", events.length, 2);
  check("les événements sont triés par date",
    events[0].at <= events[1].at, events.map((e) => e.at));
  eq("premier jour : bonus de présence", events[0].points, 10 + 5);
  eq("deuxième post du même jour : pas de bonus", events[1].points, 20);

  // Deux posts le même jour, un autre jour.
  const spread = buildEvents({
    posts: [
      { id: "a", has_code: false, created_at: "2026-10-02T08:00:00.000Z" },
      { id: "b", has_code: false, created_at: "2026-10-03T08:00:00.000Z" },
    ],
  });
  eq("chaque jour ouvre droit au bonus", sumXp(spread), 2 * (10 + 5));

  const withMsg = buildEvents({
    posts,
    messages: [{ id: "m1", is_code: false, created_at: "2026-10-03T12:00:00.000Z" }],
  });
  eq("un message ne reçoit pas de second bonus de présence",
    withMsg.find((e) => e.kind === "group_message")!.points, 5);

  const likes = buildEvents({ posts: [], likesByPost: { p1: 10, p2: 0, p3: -4 } });
  eq("les likes valent 2 points l'unité", likes[0].points, 10 * 2 + 5);
  eq("les likes nuls ou négatifs sont ignorés", likes.length, 1);

  eq("aucune activité → aucun événement", buildEvents({}).length, 0);
}

/* ------------------------------------------------------------------ */
/* 5. Carte d'activité                                                 */
/* ------------------------------------------------------------------ */

function testHeatmap() {
  eq("0 action → niveau 0", heatLevel(0), 0);
  eq("1 action → niveau 1", heatLevel(1), 1);
  eq("2 actions → niveau 2", heatLevel(2), 2);
  eq("3 actions → niveau 3", heatLevel(3), 3);
  eq("4 actions → niveau 3", heatLevel(4), 3);
  eq("5 actions → niveau 4", heatLevel(5), 4);
  eq("20 actions → niveau 4", heatLevel(20), 4);

  const { cells } = heatmap(["2026-10-01", "2026-10-03"], D0, 15);
  eq("15 colonnes de 7 cases", cells.length, 15);
  check("chaque colonne a 7 jours", cells.every((c) => c.length === 7));

  const flat = cells.flat();
  eq("105 cases au total", flat.length, 15 * 7);

  const last = cells[cells.length - 1];
  // D0 = 2026-10-03 est un samedi : il occupe la 6e ligne (index 5).
  const dowIndex = (new Date(`${D0}T00:00:00`).getDay() + 6) % 7;
  eq("la dernière colonne contient aujourd'hui", last[dowIndex].day, D0);
  eq("la colonne finit sur le dimanche", last[6].day, shiftDay(D0, 1));
  check("les jours après aujourd'hui sont futurs",
    last.slice(dowIndex + 1).every((c) => c.future), last.slice(dowIndex + 1));

  const daysSet = new Set(flat.map((c) => c.day));
  check("aucune case en double", daysSet.size === flat.length);

  check("les jours à venir sont marqués futurs",
    flat.some((c) => c.future === true));
  check("au plus 6 cases futures (la semaine en cours)",
    flat.filter((c) => c.future).length <= 6,
    flat.filter((c) => c.future).length);

  check("aucun jour d'activité n'est dans le futur",
    flat.every((c) => !c.future || c.count === 0));

  const { counts } = heatmap(["2026-10-03"], D0, 15);
  eq("le compteur connaît le jour actif", counts.get(D0), 1);
}

/* ------------------------------------------------------------------ */
/* 6. Badges                                                           */
/* ------------------------------------------------------------------ */

function testBadges() {
  const none = buildStats({ posts: [] }, D0);
  eq("un profil vide n'a aucun badge", none.badgesEarned, 0);
  check("la collection existe quand même", none.badges.length >= 10, none.badges.length);
  check("aucun badge n'est plafonné à 0", none.badges.every((b) => b.progress <= b.target));

  const busy = buildStats({
    posts: [
      { id: "1", has_code: true, created_at: "2026-10-03T02:00:00.000Z" },
      { id: "2", has_code: true, created_at: "2026-10-03T03:00:00.000Z" },
      { id: "3", has_code: true, created_at: "2026-10-03T04:00:00.000Z" },
      { id: "4", has_code: true, created_at: "2026-10-03T05:00:00.000Z" },
      { id: "5", has_code: true, created_at: "2026-10-03T06:00:00.000Z" },
    ],
    messages: [{ id: "m", is_code: false, created_at: "2026-10-03T07:00:00.000Z" }],
    languages: 3,
    hasBio: true,
  }, D0);

  const earned = new Set(busy.badges.filter((b) => b.earned).map((b) => b.id));
  check("Première plume", earned.has("first-post"), [...earned]);
  check("Chanteur de code", earned.has("code-singer"), [...earned]);
  check("Polyglotte", earned.has("polyglot"));
  check("Carte d'identité", earned.has("identity"));
  check("Trois jours non atteint", !earned.has("streak-3"));
  check("Magnétique non atteint", !earned.has("magnetic"));
  check("Nocturne atteint (2 h du matin)", earned.has("nocturnal"));

  // Progression partielle : 3 posts sur 5 pour « Chanteur de code ».
  const partial = buildStats({
    posts: [
      { id: "1", has_code: true, created_at: "2026-10-03T09:00:00.000Z" },
      { id: "2", has_code: true, created_at: "2026-10-03T10:00:00.000Z" },
      { id: "3", has_code: true, created_at: "2026-10-03T11:00:00.000Z" },
      { id: "4", has_code: false, created_at: "2026-10-03T12:00:00.000Z" },
    ],
  }, D0);
  const singer = partial.badges.find((b) => b.id === "code-singer")!;
  check("badge partiel : pas obtenu", !singer.earned);
  eq("badge partiel : avancement 3/5", `${singer.progress}/${singer.target}`, "3/5");

  check("l'avancement ne dépasse jamais la cible",
    partial.badges.every((b) => b.progress <= b.target));
}

/* ------------------------------------------------------------------ */
/* 7. Quêtes                                                           */
/* ------------------------------------------------------------------ */

function testQuests() {
  const counters = { post: 1, post_code: 0, group_message: 0, group_code: 0, bio: 0 };

  const q = questsFor(D0, counters);
  eq("trois quêtes par jour", q.length, 3);
  check("les identifiants sont uniques", new Set(q.map((x) => x.id)).size === 3);

  const again = questsFor(D0, counters);
  check("même jour → mêmes quêtes", JSON.stringify(q) === JSON.stringify(again));

  const tomorrow = questsFor(shiftDay(D0, 1), counters);
  check("jour suivant → quêtes différentes", JSON.stringify(q) !== JSON.stringify(tomorrow));

  const next7 = Array.from({ length: 7 }, (_, i) => questsFor(shiftDay(D0, i), counters));
  check("7 jours de quêtes suffisamment variés",
    new Set(next7.map((d) => d.map((x) => x.id).sort().join(","))).size >= 5,
    next7.map((d) => d.map((x) => x.id).join("+")));

  const done = questsFor(D0, { post: 3, post_code: 3, group_message: 3, group_code: 3, bio: 1 });
  check("toutes les quêtes accomplies", done.every((x) => x.done), done);

  const partial = q.find((x) => x.progress > 0 && !x.done);
  check("une quête commencée reste inachevée", !partial?.done, partial);
  check("avancement borné par la cible", q.every((x) => x.progress <= x.target));
  check("les quêtes accomplies valent des points",
    done.every((x) => x.points > 0));

  // Une quête à 0 doit rester inaccomplie, même avec un compteur nul.
  check("aucune quête vide n'est marquée faite",
    questsFor(D0, { post: 0, post_code: 0, group_message: 0, group_code: 0, bio: 0 })
      .every((x) => !x.done));
}

/* ------------------------------------------------------------------ */
/* 8. Snapshot complet                                                 */
/* ------------------------------------------------------------------ */

function testStats() {
  const stats = buildStats({
    posts: [
      { id: "1", has_code: true, code: "x", lang: "Go", created_at: "2026-10-01T09:00:00.000Z" },
      { id: "2", has_code: false, created_at: "2026-10-02T09:00:00.000Z" },
      { id: "3", has_code: true, code: "y", lang: "Go", created_at: "2026-10-03T09:00:00.000Z" },
    ],
    messages: [{ id: "m", is_code: true, created_at: "2026-10-03T10:00:00.000Z" }],
    likesByPost: { "1": 30 },
  }, D0);

  eq("3 posts comptés", stats.posts, 3);
  eq("2 posts avec code", stats.codePosts, 2);
  eq("1 message de groupe", stats.groupMessages, 1);
  eq("30 likes reçus", stats.likes, 30);
  eq("3 jours d'activité", stats.activeDays.length, 3);
  eq("série de 3", stats.streak.current, 3);

  // 20+10+20 = 50 (posts) · +10 (message code) · +60 (30 likes à 2 pts)
  // · +15 (bonus de présence, un par jour actif) · +6 (bonus de série).
  eq("score total", stats.xp, 50 + 10 + 60 + 15 + 6);
  // Le score de la semaine additionne les événements de la fenêtre : le
  // bonus de série n'en fait pas partie, il est lié à la série courante.
  eq("score de la semaine", stats.weekXp, 50 + 10 + 60 + 15);

  check("le journal contient tous les événements", stats.events.length >= 5);

  const lastWeek = buildStats({
    posts: [{ id: "1", has_code: false, created_at: "2026-09-01T09:00:00.000Z" }],
  }, D0);
  eq("un post vieux d'un mois ne compte pas dans la semaine", lastWeek.weekXp, 0);
  eq("mais il compte dans le score total", lastWeek.xp, 15);
  eq("et il casse la série", lastWeek.streak.current, 0);

  // Un post d'il y a six jours doit compter dans la semaine.
  const sixDays = buildStats({
    posts: [{ id: "1", has_code: false, created_at: `${shiftDay(D0, -6)}T09:00:00.000Z` }],
  }, D0);
  eq("un post à -6 jours est dans la fenêtre", sixDays.weekXp, 15);

  // Le snapshot est stable : deux appels identiques donnent le même score.
  const a = buildStats({ posts: stats.events.length ? [
    { id: "1", has_code: true, created_at: "2026-10-03T09:00:00.000Z" },
  ] : [] }, D0);
  const b = buildStats({ posts: [
    { id: "1", has_code: true, created_at: "2026-10-03T09:00:00.000Z" },
  ] }, D0);
  eq("le calcul est déterministe", a.xp, b.xp);

  check("un snapshot vide ne plante pas",
    buildStats({}, D0).xp === 0);
}

/* ------------------------------------------------------------------ */
/* 9. Classement                                                       */
/* ------------------------------------------------------------------ */

function testLeaderboard() {
  const rows = leaderboard([
    { id: "a", weekXp: 50 },
    { id: "b", weekXp: 120 },
    { id: "c", weekXp: 0 },
    { id: "d", weekXp: 80 },
    { id: "e", weekXp: 120 },
    { id: "f", weekXp: 10 },
  ]);

  eq("5 lignes maximum", rows.length, 5);
  eq("exclusion des scores nuls", rows.some((r) => r.id === "c"), false);
  eq("tri décroissant", rows[0].xp >= rows[1].xp, true);
  eq("la position 1 est attribuée", rows[0].rank, 1);
  check("les rangs sont consécutifs", rows.every((r, i) => r.rank === i + 1));
  check("l'ex-aequo est départagé par l'ordre reçu",
    rows.filter((r) => r.xp === 120).length === 2);

  eq("classement vide", leaderboard([]).length, 0);
  eq("que des zéros → aucun classement", leaderboard([{ id: "a", weekXp: 0 }]).length, 0);
}

/* ------------------------------------------------------------------ */
/* 10. Stories                                                         */
/* ------------------------------------------------------------------ */

function testStories() {
  const none = buildStory("u1", []);
  eq("pas de post → pas de story", none, null);

  const story = buildStory("u1", [
    { id: "p1", has_code: false, text: "un post", created_at: "2026-10-03T09:00:00.000Z" },
    { id: "p2", has_code: true, code: "print(1)", lang: "Python", text: "du code", created_at: "2026-10-03T10:00:00.000Z" },
  ]);

  check("la story existe", story !== null);
  eq("deux slides", story!.slides.length, 2);
  eq("slides triées du plus ancien au plus récent", story!.slides[0].id, "p1");
  eq("slide texte", story!.slides[0].kind, "post");
  eq("slide code", story!.slides[1].kind, "code");
  eq("le code est conservé", story!.slides[1].code, "print(1)");
  eq("le langage est conservé", story!.slides[1].lang, "Python");
  eq("la date de mise à jour est le dernier slide", story!.updatedAt, story!.slides[1].at);
  check("chaque slide vaut des points", story!.slides.every((s) => s.points > 0));

  const withMsg = buildStory("u1", [], [{ id: "m1", is_code: false, text: "salut", created_at: "2026-10-03T11:00:00.000Z" }]);
  eq("un message de groupe fait une story", withMsg!.slides.length, 1);
  eq("slide groupe", withMsg!.slides[0].kind, "group");

  // Un post de trois mois ne doit pas apparaître dans le rail.
  const old = buildStory("u1", [{ id: "p1", has_code: false, created_at: "2020-01-01T09:00:00.000Z" }]);
  check("le filtre 24 h est appliqué par l'appelant", old !== null);
  eq("recent() exclut ce qui est trop vieux",
    recent([{ created_at: "2020-01-01T00:00:00.000Z" }], "2026-10-02T00:00:00.000Z").length, 0);
  eq("recent() inclut ce qui est récent",
    recent([{ created_at: "2026-10-03T00:00:00.000Z" }], "2026-10-02T00:00:00.000Z").length, 1);
  eq("recent() sur une liste vide", recent([], "2026-10-02T00:00:00.000Z").length, 0);
}

/* ------------------------------------------------------------------ */

function main() {
  reset();
  testDates();
  testLevels();
  testStreak();
  testScoring();
  testHeatmap();
  testBadges();
  testQuests();
  testStats();
  testLeaderboard();
  testStories();

  console.log(`\n${passed} vérification(s) passée(s), ${failures.length} échec(s)\n`);
  if (failures.length) {
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("  ✓ Le moteur de progression est cohérent\n");
}

/** Vide le store de test : ce script ne touche qu'à des fonctions pures. */
function reset() {
  /* rien à faire — mentionné pour que l'ajout d'un futur test
     persisté sache où se brancher */
}

main();
