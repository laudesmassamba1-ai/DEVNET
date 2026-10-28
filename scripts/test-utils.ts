/**
 * Tests des utilitaires d'affichage.
 *
 * Exécuter avec :  npx tsx scripts/test-utils.ts
 *
 * Un fichier à part pour une fonction de six lignes, c'est disproportionné
 * — sauf que cette fonction a fait afficher « il y a 0 j » pendant sept
 * jours, sur **toute** l'application. Le fil, les commentaires,
 * l'historique du dépôt et les notifications disaient tous « à
 * l'instant ». Une application dont tout semble écrit à l'instant où l'on
 * regarde paraît vide, et rien ne signale l'erreur : « il y a 0 j » se
 * lit très bien.
 *
 * Le test existe donc pour que la division ne soit plus refaite à la
 * main, et pour que le cas « entre un jour et sept jours » soit nommé.
 */

import { timeAgo, clockTime, avatarClass, initials } from "../lib/utils";

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) passed++;
  else failures.push(`${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
}

const NOW = Date.now();
const ago = (seconds: number) => new Date(NOW - seconds * 1000);

function main() {
  /* ── Le temps relatif ────────────────────────────────────────── */

  check("moins d'une minute : à l'instant", timeAgo(ago(30)) === "à l'instant", timeAgo(ago(30)));
  check("une minute pile n'est plus « à l'instant »", timeAgo(ago(60)) !== "à l'instant", timeAgo(ago(60)));
  check("cinq minutes", timeAgo(ago(300)) === "il y a 5 min", timeAgo(ago(300)));
  check("une heure", timeAgo(ago(3600)) === "il y a 1 h", timeAgo(ago(3600)));
  check("trois heures", timeAgo(ago(3 * 3600)) === "il y a 3 h", timeAgo(ago(3 * 3600)));

  // Le palier qui a cassé. Un décalage d'un facteur dix ne se voit sur
  // aucune autre valeur : les minutes et les heures étaient justes, et
  // seuls les jours étaient faux. Il faut donc les tester séparément.
  check("un jour", timeAgo(ago(86400)) === "il y a 1 j", timeAgo(ago(86400)));
  check("deux jours", timeAgo(ago(2 * 86400)) === "il y a 2 j", timeAgo(ago(2 * 86400)));
  check("six jours", timeAgo(ago(6 * 86400)) === "il y a 6 j", timeAgo(ago(6 * 86400)));

  // « il y a 0 j » ne doit **jamais** sortir. C'est le symptôme exact du
  // défaut, et il se lit comme une phrase correcte : c'est pour cela
  // qu'une relecture ne l'aurait pas vu.
  const paliers = [0, 30, 59, 60, 300, 3599, 3600, 3600 * 5, 86400 - 1, 86400,
    86400 * 2, 86400 * 3, 86400 * 7 - 1];
  const zeros = paliers
    .map((s) => timeAgo(ago(s)))
    .filter((t) => t.includes("il y a 0"));
  check("aucun palier ne produit « il y a 0 »", zeros.length === 0, zeros);

  // Au-delà de sept jours, on affiche une date. C'est un choix : un
  // nombre de jours croissant dans un fil qui remonte loin devient
  // illisible.
  check("au-delà de sept jours : une date",
    !timeAgo(ago(10 * 86400)).startsWith("il y a"), timeAgo(ago(10 * 86400)));

  // Une date future ne doit pas produire un temps négatif : les
  // horodatages de deux serveurs peuvent se chevaucher de quelques
  // secondes, et « il y a -3 s » se lirait comme une faute.
  check("une date future reste lisible",
    !timeAgo(ago(-30)).includes("-"), timeAgo(ago(-30)));

  /* ── L'heure ─────────────────────────────────────────────────── */

  check("l'heure reprend la date fournie",
    clockTime(ago(0)).length === 5 && clockTime(ago(0)).includes(":"),
    clockTime(ago(0)));

  /* ── Les initiales ───────────────────────────────────────────── */

  // Une **seule** lettre, volontairement. Les avatars font 34 px : deux
  // lettres y sont illisibles sur la plus petite taille, et une demi-lettre
  // dans un cercle est plus lisible qu'un sigle à l'étroit. Le test dit
  // cela explicitement, parce que « initiales » au pluriel ferait croire
  // à l'inverse — et quelqu'un, en lisant le nom, poserait la question.
  check("une seule lettre, quelle que soit la longueur du nom",
    initials("Koffi Adjo") === "K", initials("Koffi Adjo"));
  check("la lettre est en majuscule", initials("awa") === "A", initials("awa"));
  check("les espaces de bord ne produisent pas d'espace",
    initials("  Awa  ") === "A", initials("  Awa  "));

  // Le cas vide doit produire un **caractère**, pas une chaîne vide : une
  // initiale vide laisse un cercle sans rien dedans, ce qui ressemble à
  // un avatar cassé plutôt qu'à un compte sans nom.
  check("un nom vide donne un point d'interrogation", initials("") === "?", initials(""));
  check("un nom absent aussi", initials(null) === "?", initials(null));
  check("un nom fait d'espaces aussi", initials("   ") === "?", initials("   "));

  /* ── La couleur d'avatar ─────────────────────────────────────── */

  // Une couleur inconnue ne doit pas produire une classe vide : c'est le
  // fond de l'avatar qui disparaîtrait, et l'initiale se retrouverait
  // seule, sans cadre.
  check("une couleur inconnue retombe sur une couleur réelle",
    (avatarClass("av-inconnu") ?? "").length > 0, avatarClass("av-inconnu"));
  check("une couleur absente retombe aussi",
    (avatarClass(null) ?? "").length > 0, avatarClass(null));

  console.log(`\n${passed} vérification(s) passée(s), ${failures.length} échec(s)\n`);
  if (failures.length) {
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("  ✓ L'affichage des dates et des noms est cohérent\n");
}

main();