/**
 * Tests de la présence et de la garde de divergence — migration 019.
 *
 * Exécuter avec :  npx tsx scripts/test-presence.ts
 *
 * Deux règles sont vérifiées ici, et ce sont exactement les deux qui ne se
 * voient pas à l'écran quand elles sont fausses :
 *
 *  · **la clé de `project_sessions`.** Tant qu'elle portait sur le chemin
 *    du fichier (004), deux membres sur le même fichier tenaient une seule
 *    ligne et le second effaçait la présence du premier. Rien n'aurait
 *    planté : l'écran aurait simplement montré une personne là où il y en
 *    a deux.
 *  · **la garde de divergence.** Une écriture qui écrase silencieusement
 *    le travail de quelqu'un d'autre ne lève aucune erreur — c'est un
 *    succès. Le seul moyen de savoir qu'elle refuse est de le lui
 *    demander.
 *
 * Les tests ne supposent rien du jeu de démonstration : le partenaire est
 * celui du seed, quel qu'il soit.
 */

import {
  fetchPresence,
  heartbeatSession,
  isLive,
  PRESENCE_TTL_MS,
} from "../lib/presence";
import { fetchRepoFiles, saveRepoFile } from "../lib/repo";
import { getStore, resetStore } from "../lib/demo/store";
import { saveSessionId } from "../lib/demo/session";
import { demoFrom } from "../lib/demo/query";

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) passed++;
  else failures.push(`${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
}

const ME = "u-koffi";

/** Les sessions d'un couple (projet, personne). */
function sessionsOf(projectId: string, userId: string): number {
  return getStore().project_sessions.filter(
    (s) => s.project_id === projectId && s.user_id === userId,
  ).length;
}

async function main() {
  resetStore();
  saveSessionId(ME);

  /* ── La règle du temps ─────────────────────────────────────────── */

  const NOW = Date.parse("2026-06-01T12:00:00Z");

  check("une session vue à l'instant est vivante",
    isLive({ seen_at: new Date(NOW - 1_000).toISOString() }, NOW));

  check("une session vue il y a plus que le délai est morte",
    !isLive({ seen_at: new Date(NOW - PRESENCE_TTL_MS - 1).toISOString() }, NOW));

  // La borne : une session vue exactement au délai est encore vivante.
  // Décaler cette frontière d'un cheveu n'a l'air de rien et fait
  // disparaître quelqu'un une seconde trop tôt.
  check("la borne du délai est inclusive",
    isLive({ seen_at: new Date(NOW - PRESENCE_TTL_MS).toISOString() }, NOW));

  // Une ligne qu'on ne peut pas dater ne prouve pas qu'il y a quelqu'un.
  check("une session sans horodatage est morte", !isLive({ seen_at: "" }, NOW));
  check("une session sans `seen_at` est morte", !isLive({}, NOW));

  /* ── Le seed ───────────────────────────────────────────────────── */

  const seeded = getStore().project_sessions.find(
    (s) => s.project_id === "p-1" && s.user_id !== ME,
  );
  check("le seed contient une présence", seeded !== undefined);

  // La clé est (projet, personne) : la 019 a retiré la colonne `id`.
  check("une session n'a plus de colonne `id`",
    seeded !== undefined && !("id" in seeded), seeded ? Object.keys(seeded) : null);

  // `seen_at` est calculé par rapport à maintenant, pas par rapport au
  // référentiel fixe du seed (3 octobre) — sinon la présence serait née
  // périmée, et le rail serait vide à chaque ouverture.
  check("la présence du seed est vivante",
    seeded !== undefined && isLive(seeded as { seen_at?: string }));

  const TWIN = String(seeded?.user_id ?? "u-thabo");
  const sameFile = String(seeded?.file_path ?? "registre.py");

  /* ── La clé composite, côté démo ───────────────────────────────── */

  const first = await demoFrom("project_sessions").insert({
    project_id: "p-1",
    user_id: ME,
    file_path: sameFile,
  });
  check("ma présence s'inscrit", first.error === null, first.error);

  // La valeur par défaut `now()` est rejouée : sans elle, une session
  // inscrite sans horodatage naîtrait périmée et ne s'afficherait nulle
  // part — le même piège que `stories.expires_at`.
  const mine = getStore().project_sessions.find(
    (s) => s.project_id === "p-1" && s.user_id === ME,
  );
  check("`seen_at` reçoit sa valeur par défaut",
    mine !== undefined && isLive(mine as { seen_at?: string }), mine?.seen_at);

  // Le partenaire du seed a déjà une ligne : c'est la contrainte qu'on
  // veut voir mordre, et non un cas théorique.
  const duplicate = await demoFrom("project_sessions").insert({
    project_id: "p-1",
    user_id: TWIN,
    file_path: sameFile,
  });
  check("une seconde session pour la même personne est refusée",
    duplicate.error !== null, duplicate.error);
  check("le refus cite la clé primaire",
    /duplicate key|pkey/i.test(duplicate.error?.message ?? ""),
    duplicate.error?.message);

  // Deux personnes différentes sur le même fichier **coexistent** : c'est
  // la correction de la 004, et le cœur de la présence.
  const onSameFile = getStore().project_sessions.filter(
    (s) => s.project_id === "p-1" && s.file_path === sameFile,
  );
  check("deux personnes sur un même fichier tiennent deux lignes",
    onSameFile.length >= 2, onSameFile.length);

  /* ── Le battement ──────────────────────────────────────────────── */

  const count = sessionsOf("p-1", ME);

  const beat = await heartbeatSession({
    projectId: "p-1",
    userId: ME,
    filePath: "lecteur.py",
    color: "av-sage",
  });
  check("le battement ne renvoie pas d'erreur", beat.error === null, beat.error);
  check("le battement ne duplique pas ma session",
    sessionsOf("p-1", ME) === count, sessionsOf("p-1", ME));

  const afterBeat = getStore().project_sessions.find(
    (s) => s.project_id === "p-1" && s.user_id === ME,
  );
  check("le battement met à jour le fichier",
    afterBeat?.file_path === "lecteur.py", afterBeat?.file_path);

  // Un second battement ne crée toujours pas de ligne : c'est la lecture
  // préalable — jamais un `upsert` sur clé composite — qui l'assure.
  await heartbeatSession({ projectId: "p-1", userId: ME, filePath: "registre.py" });
  check("deux battements ne laissent qu'une ligne",
    sessionsOf("p-1", ME) === count, sessionsOf("p-1", ME));

  /* ── La lecture ────────────────────────────────────────────────── */

  const seen = await fetchPresence("p-1", ME);
  check("on ne se voit pas soi-même", !seen.some((s) => s.user_id === ME), seen);
  check("on voit les autres", seen.some((s) => s.user_id === TWIN), seen);
  check("la jointure de l'auteur est remplie",
    seen.every((s) => s.user === null || typeof s.user.prenom === "string"),
    seen.map((s) => s.user?.prenom ?? null));

  // Une session périmée est filtrée, même si elle est encore en table :
  // c'est ce filtre qui fait disparaître un pair qui a fermé son onglet.
  const stale = getStore().project_sessions.find((s) => s.user_id === TWIN);
  if (stale) stale.seen_at = new Date(Date.now() - PRESENCE_TTL_MS - 60_000).toISOString();
  const afterStale = await fetchPresence("p-1", ME);
  check("une présence périmée est filtrée",
    !afterStale.some((s) => s.user_id === TWIN), afterStale);

  /* ── La garde de divergence ────────────────────────────────────── */

  const files = await fetchRepoFiles("p-1");
  const target = files.find((f) => f.path === "registre.py");
  check("le fichier témoin existe", target !== undefined, files.map((f) => f.path));

  const baseSha = String(target?.blob_sha ?? "");
  const baseContent = String(target?.content ?? "");

  // 1. Une écriture conforme passe.
  const okWrite = await saveRepoFile({
    projectId: "p-1",
    path: "registre.py",
    content: baseContent + "\n# marque du test\n",
    userId: ME,
    expectedSha: baseSha,
  });
  check("écrire avec le bon sha passe",
    okWrite.error === null && !okWrite.diverged, okWrite);

  // 2. Quelqu'un d'autre écrit pendant ce temps, **sans** garde : c'est
  //    le chemin de la copie de branche, qui vient d'écrire.
  const otherWrite = await saveRepoFile({
    projectId: "p-1",
    path: "registre.py",
    content: "# version de quelqu'un d'autre\n",
    userId: TWIN,
  });
  check("l'écriture concurrente est acceptée", otherWrite.error === null, otherWrite);

  // 3. J'essaie d'écrire avec le sha d'avant : refusé.
  const diverged = await saveRepoFile({
    projectId: "p-1",
    path: "registre.py",
    content: "# ma version, écrite trop tard\n",
    userId: ME,
    expectedSha: baseSha,
  });
  check("écrire avec un sha périmé est refusé",
    diverged.diverged === true && diverged.error !== null, diverged);

  // 4. Et le refus a **vraiment** laissé le contenu tranquille : un refus
  //    qui écrit quand même serait pire que pas de garde du tout.
  const afterRefusal = (await fetchRepoFiles("p-1")).find((f) => f.path === "registre.py");
  check("le refus n'a rien écrit",
    afterRefusal?.content === "# version de quelqu'un d'autre\n",
    afterRefusal?.content);

  // 5. Relire, puis écrire avec le bon sha : passe de nouveau.
  const reloaded = await saveRepoFile({
    projectId: "p-1",
    path: "registre.py",
    content: "# version relue puis corrigée\n",
    userId: ME,
    expectedSha: afterRefusal?.blob_sha,
  });
  check("après relecture, l'écriture passe",
    reloaded.error === null && !reloaded.diverged, reloaded);

  // 6. `expectedSha: null` veut dire « je crois que ce fichier n'existe
  //    pas ». Sur un fichier existant, c'est une divergence.
  const claimedNew = await saveRepoFile({
    projectId: "p-1",
    path: "registre.py",
    content: "# je croyais créer ce fichier\n",
    userId: ME,
    expectedSha: null,
  });
  check("créer un fichier qui existe déjà est refusé",
    claimedNew.diverged === true, claimedNew);

  // 7. Sur un chemin réellement vide, la même garde laisse passer.
  const brandNew = await saveRepoFile({
    projectId: "p-1",
    path: "presence-neuf.txt",
    content: "bonjour\n",
    userId: ME,
    expectedSha: null,
  });
  check("créer un fichier vraiment neuf passe",
    brandNew.error === null && !brandNew.diverged, brandNew);

  // 8. Sans `expectedSha`, la garde est inactive — c'est le chemin de la
  //    copie de branche, qui vient précisément d'écrire.
  const unguarded = await saveRepoFile({
    projectId: "p-1",
    path: "registre.py",
    content: "# sans garde\n",
    userId: ME,
  });
  check("sans garde, l'écriture reste possible",
    unguarded.error === null && !unguarded.diverged, unguarded);

  /* ── Rapport ───────────────────────────────────────────────────── */

  saveSessionId(null);
  console.log(`\n${passed} vérification(s) passée(s), ${failures.length} échec(s)\n`);
  if (failures.length) {
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("  ✓ La présence et la garde de divergence tiennent en démonstration\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
