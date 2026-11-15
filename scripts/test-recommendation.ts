/**
 * Tests du classement « Pour toi ».
 *
 * On ne teste pas « le bon ordre » — il n'y en a pas — mais les **propriétés**
 * qui doivent tenir quel que soit le corpus : un abonnement remonte, une
 * publication fraîche bat une vieille à engagement égal, un auteur ne prend
 * pas tout le haut du fil, et un signalement ouvert pénalise.
 */
import assert from "node:assert/strict";
import { rankPosts, scorePost, tagsOf, type RankablePost } from "../lib/recommendation";

let checks = 0;
const now = Date.parse("2026-11-15T12:00:00Z");

function post(overrides: Partial<RankablePost> & { id: string }): RankablePost {
  return {
    author_id: "author-1",
    created_at: new Date(now - 60_000).toISOString(),
    likes: 0,
    comments: 0,
    reposts: 0,
    has_code: false,
    text: "un texte de publication",
    ...overrides,
  };
}

/* ── 1. Un abonnement remonte ───────────────────────────────── */
const followed = scorePost(post({ id: "a", author_id: "friend" }), {
  now,
  followedAuthorIds: ["friend"],
});
const stranger = scorePost(post({ id: "b", author_id: "stranger" }), { now });
checks += 1;
assert.ok(followed.score > stranger.score, "un auteur suivi doit être favorisé");
console.log("✓ 1. affinité d'abonnement");

/* ── 2. La fraîcheur compte ─────────────────────────────────── */
const fresh = scorePost(post({ id: "c", created_at: new Date(now - 60_000).toISOString() }), { now });
const old = scorePost(post({ id: "d", created_at: new Date(now - 7 * 86_400_000).toISOString() }), { now });
checks += 1;
assert.ok(fresh.score > old.score, "une publication fraîche doit battre une vieille");
console.log("✓ 2. décroissance temporelle");

/* ── 3. L'engagement compte ─────────────────────────────────── */
const quiet = scorePost(post({ id: "e", likes: 0, comments: 0 }), { now });
const loud = scorePost(post({ id: "f", likes: 80, comments: 20, reposts: 10 }), { now });
checks += 1;
assert.ok(loud.score > quiet.score, "l'engagement doit compter");
console.log("✓ 3. engagement");

/* ── 4. Les preuves comptent ────────────────────────────────── */
const prose = scorePost(post({ id: "g", text: "un texte de publication" }), { now });
const code = scorePost(post({ id: "h", has_code: true }), { now });
checks += 1;
assert.ok(code.score > prose.score, "une publication avec code doit être valorisée");
console.log("✓ 4. preuve de travail");

/* ── 5. Un signalement pénalise ─────────────────────────────── */
const clean = scorePost(post({ id: "i" }), { now });
const reported = scorePost(post({ id: "j", open_reports: 3 }), { now });
checks += 1;
assert.ok(reported.score < clean.score, "un signalement ouvert doit pénaliser");
console.log("✓ 5. signalements");

/* ── 6. Diversité : un auteur ne sature pas le haut ─────────── */
const flood: RankablePost[] = Array.from({ length: 6 }, (_, index) =>
  post({
    id: `flood-${index}`,
    author_id: "spammer",
    likes: 100,
    comments: 30,
    text: `publication numéro ${index} #javascript`,
  }),
);
const others: RankablePost[] = Array.from({ length: 3 }, (_, index) =>
  post({
    id: `other-${index}`,
    author_id: `author-${index}`,
    likes: 2,
    text: `autre publication ${index} #design`,
  }),
);
const ranked = rankPosts([...flood, ...others], { now });
const firstFour = ranked.slice(0, 4).filter((item) => item.author_id === "spammer");
checks += 1;
assert.ok(firstFour.length <= 3, "un auteur ne doit pas occuper tout le haut du fil");
console.log("✓ 6. diversité d'auteur");

/* ── 7. Le classement est stable ────────────────────────────── */
const first = rankPosts([...flood, ...others], { now }).map((item) => item.id);
const second = rankPosts([...flood, ...others], { now }).map((item) => item.id);
checks += 1;
assert.deepEqual(first, second, "deux appels identiques doivent rendre le même ordre");
console.log("✓ 7. déterminisme");

/* ── 8. Les tags sont extraits sans casser l'Unicode ────────── */
checks += 1;
assert.deepEqual(tagsOf("salut #Python et #machine_learning, pas #"), ["python", "machine_learning"]);
assert.deepEqual(tagsOf(""), []);
console.log("✓ 8. extraction des tags");

console.log(`\n✓ classement du fil — ${checks} vérifications`);
