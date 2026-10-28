/**
 * Tests du wiki de projet (notre « Notion »).
 *
 * Exécuter avec :  npx tsx scripts/test-pages.ts
 *
 * Deux moitiés, comme d'habitude : le **moteur pur** (`lib/doc.ts` — le
 * découpage d'une page en blocs, qui ne dépend de rien) et le **parcours
 * données** (créer, modifier, supprimer une page via le jeu de
 * démonstration, qui rejoue les déclencheurs de la migration 015).
 *
 * Le point que ces tests gardent est le même que pour les issues : **ce
 * que la base calcule n'est pas écrit par le client**. Ici c'est
 * `updated_at` — une page qu'on vient d'enregistrer doit porter une date
 * de modification fraîche, sans que l'écran l'ait envoyée.
 */

import { firstHeading, parseDoc } from "../lib/doc";
import {
  createProjectPage,
  deleteProjectPage,
  fetchProjectPages,
  updateProjectPage,
} from "../lib/pages";
import { resetStore } from "../lib/demo/store";

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) passed++;
  else failures.push(`${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
}

const author = { id: "u-koffi" };
const project = "p-1";

/* ══════════════════════════════════════════════════════════════════
   1. Le découpage d'un document — pur, sans navigateur
   ══════════════════════════════════════════════════════════════════ */

function testParseur() {
  const doc = [
    "# Démarrage",
    "",
    "Une phrase",
    "sur deux lignes.",
    "",
    "- premier",
    "- second",
    "",
    "1. étape un",
    "2. étape deux",
    "",
    "> attention",
    "",
    "```bash",
    "python lecteur.py",
    "```",
  ].join("\n");

  const blocks = parseDoc(doc);

  check("un titre de niveau 1 est reconnu",
    blocks[0].kind === "heading" && blocks[0].level === 1 && blocks[0].text === "Démarrage",
    blocks[0]);

  // Deux lignes contiguës forment **un** paragraphe : revenir à la ligne
  // à 80 colonnes n'est pas un nouveau paragraphe.
  const para = blocks.find((b) => b.kind === "paragraph");
  check("un paragraphe joint ses lignes",
    para?.kind === "paragraph" && para.text === "Une phrase sur deux lignes.", para);

  const lists = blocks.filter((b) => b.kind === "list");
  check("une liste à puces est reconnue",
    lists[0]?.kind === "list" && !lists[0].ordered && lists[0].items.length === 2, lists[0]);
  check("une liste ordonnée est reconnue",
    lists[1]?.kind === "list" && lists[1].ordered && lists[1].items.length === 2, lists[1]);

  const quote = blocks.find((b) => b.kind === "quote");
  check("une citation est reconnue",
    quote?.kind === "quote" && quote.text === "attention", quote);

  const code = blocks.find((b) => b.kind === "code");
  check("un bloc de code garde son langage",
    code?.kind === "code" && code.lang === "bash", code);
  check("un bloc de code garde son contenu exactement",
    code?.kind === "code" && code.code === "python lecteur.py", code);

  // La restitution est un invariant : le découpage ne doit rien perdre.
  // C'est le même contrat que le tokenizer de coloration syntaxique.
  const rendered = blocks
    .map((b) => (b.kind === "code" ? b.code : b.kind === "list" ? b.items.join("\n") : b.text))
    .join("\n");
  check("le découpage ne perd aucun mot",
    ["Démarrage", "Une phrase", "deux lignes", "premier", "étape deux", "attention",
      "python lecteur.py"].every((mot) => rendered.includes(mot)),
    rendered);

  // Une clôture manquante ne doit pas faire disparaître la fin de page.
  const ouvert = parseDoc("```js\nligne 1\nligne 2");
  check("un bloc non fermé prend ce qui reste",
    ouvert.length === 1 && ouvert[0].kind === "code" && ouvert[0].code === "ligne 1\nligne 2",
    ouvert);

  // Les fins de ligne Windows ne doivent pas laisser un `\r` dans le code.
  const windows = parseDoc("```\r\na\r\nb\r\n```\r\n");
  check("les fins de ligne Windows sont normalisées",
    windows[0]?.kind === "code" && windows[0].code === "a\nb", windows[0]);

  // Une page sans règle connue reste un paragraphe : rien ne disparaît
  // en silence.
  const libre = parseDoc("du texte tout simple || avec des symboles");
  check("tout le reste devient un paragraphe",
    libre.length === 1 && libre[0].kind === "paragraph", libre);

  check("un corps vide ne produit aucun bloc", parseDoc("").length === 0);

  check("le premier titre sert de nom proposé",
    firstHeading("# Démarrage\n\ntexte") === "Démarrage",
    firstHeading("# Démarrage\n\ntexte"));
  check("un corps sans titre n'invente pas de nom",
    firstHeading("juste du texte") === null, firstHeading("juste du texte"));
}

/* ══════════════════════════════════════════════════════════════════
   2. Le parcours données — via le jeu de démonstration
   ══════════════════════════════════════════════════════════════════ */

async function testDonnees() {
  resetStore();

  const pages = await fetchProjectPages(project);

  check("le dépôt de démonstration a des pages", pages.length === 3, pages.length);

  // L'ordre vient de `position`, pas de la date de création : c'est un
  // sommaire, pas un fil d'actualité.
  const positions = pages.map((p) => p.position);
  check("les pages sortent dans l'ordre du sommaire",
    positions.every((p, i) => i === 0 || positions[i - 1] <= p), positions);
  check("le sommaire part de zéro", positions[0] === 0, positions);

  // L'auteur est résolu par la jointure, jamais recopié dans la page.
  check("l'auteur d'une page est résolu",
    pages.every((p) => typeof p.author?.pseudo === "string"),
    pages.map((p) => p.author?.pseudo));

  /* ── Création ─────────────────────────────────────────────────── */

  const creee = await createProjectPage({
    projectId: project,
    authorId: author.id,
    title: "Feuille de route",
    body: "# Feuille de route\n\n- lire les codes-barres\n- exporter le relevé",
  });

  check("une page se crée sans erreur", creee.error === null, creee.error);
  check("la page créée a un identifiant", typeof creee.page?.id === "string");
  // Valeur par défaut de la migration 015 : sans elle, la page naîtrait
  // hors de tout tri et le sommaire cesserait de bouger.
  check("la position par défaut est posée par la base",
    creee.page?.position === 0, creee.page?.position);
  check("la date de modification existe à la naissance",
    typeof creee.page?.updated_at === "string" && creee.page.updated_at.length > 0,
    creee.page?.updated_at);

  const apresCreation = await fetchProjectPages(project);
  check("la page créée apparaît dans la liste",
    apresCreation.length === 4, apresCreation.length);

  /* ── Un titre vide est refusé ─────────────────────────────────── */

  const vide = await createProjectPage({
    projectId: project,
    authorId: author.id,
    title: "   ",
  });
  check("un titre vide est refusé", vide.error !== null && vide.page === null, vide);

  /* ── Modification, et la date qui suit ───────────────────────── */

  const avant = creee.page!;
  // On laisse passer un milliseconde : deux `iso` peuvent partager la
  // même milliseconde, et le test accuserait alors une date correcte.
  await new Promise((r) => setTimeout(r, 5));

  const maj = await updateProjectPage(avant.id, {
    title: "Feuille de route 2024",
    body: "# Feuille de route\n\n- lire les codes-barres",
  });
  check("une page se modifie sans erreur", maj.error === null, maj.error);

  const relue = (await fetchProjectPages(project)).find((p) => p.id === avant.id)!;
  check("le titre modifié est enregistré", relue.title === "Feuille de route 2024", relue.title);
  // Le déclencheur `touch_project_page` réécrit `updated_at` : le client
  // ne l'envoie pas, et la date doit quand même avancer.
  check("la date de modification est réécrite par la base",
    relue.updated_at > avant.updated_at, { avant: avant.updated_at, apres: relue.updated_at });

  // Un titre vide est refusé **sans** écrire : la page garde son nom.
  const mauvais = await updateProjectPage(avant.id, { title: "  " });
  check("un titre vide n'est pas enregistré",
    mauvais.error !== null &&
      (await fetchProjectPages(project)).find((p) => p.id === avant.id)!.title ===
        "Feuille de route 2024",
    mauvais);

  /* ── Suppression ─────────────────────────────────────────────── */

  const avantSuppression = (await fetchProjectPages(project)).length;
  const retrait = await deleteProjectPage(avant.id);
  check("une page se supprime sans erreur", retrait.error === null, retrait.error);
  check("la page disparaît du sommaire",
    (await fetchProjectPages(project)).length === avantSuppression - 1,
    avantSuppression);
}

async function main() {
  testParseur();
  await testDonnees();

  console.log(`\n${passed} vérification(s) passée(s), ${failures.length} échec(s)\n`);
  if (failures.length) {
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("  ✓ Les pages se rangent, se lisent et se modifient\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
