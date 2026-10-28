/**
 * Le découpage d'une page de wiki en blocs — module **pur**.
 *
 * Ni base, ni réseau, ni React. Le même découpage sert à l'**écran** (qui
 * affiche les blocs) et au **test** (qui vérifie les cas dégénérés).
 *
 * ## Pourquoi pas un vrai moteur Markdown
 *
 * Un parser Markdown complet fait plusieurs centaines de kilo-octets,
 * accepte des constructions (tables, HTML embarqué, références) que ce
 * wiki n'a pas à connaître, et — surtout — **échoue en silence** sur ce
 * qu'il ne comprend pas. Ici, tout ce qui n'est pas une règle connue
 * devient un paragraphe : une ligne qu'on n'a pas prévue s'affiche quand
 * même, au lieu de disparaître. C'est la même décision que le tokenizer
 * de `lib/highlight.ts`.
 *
 * Le sous-ensemble retenu est celui qu'écrivent réellement des notes
 * techniques : titres, listes, citations, blocs de code. Rien de plus.
 */

export type DocBlock =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "code"; lang: string; code: string };

/** Une clôture de bloc de code : trois accents graves, avec le langage. */
const FENCE = /^```(\w*)\s*$/;
const HEADING = /^(#{1,3})\s+(.*)$/;
const ORDERED = /^\d+\.\s+(.*)$/;
const BULLET = /^[-*]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;

/** Découpe le corps d'une page en blocs affichables, dans l'ordre. */
export function parseDoc(body: string): DocBlock[] {
  const blocks: DocBlock[] = [];
  // Les fins de ligne Windows ne doivent pas produire un `\r` en fin de
  // chaque ligne : il se voit dans les blocs de code, où il est copié.
  const lines = body.replace(/\r\n?/g, "\n").split("\n");

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Ligne vide : séparateur, jamais un bloc.
    if (line.trim() === "") {
      i += 1;
      continue;
    }

    // ── Bloc de code ──
    const fence = line.match(FENCE);
    if (fence) {
      const lang = fence[1] || "";
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      // Une clôture manquante n'est pas une erreur : on prend ce qui
      // reste. Un bloc ouvert par erreur ne doit pas faire disparaître
      // la fin de la page.
      if (i < lines.length) i += 1;
      blocks.push({ kind: "code", lang, code: code.join("\n") });
      continue;
    }

    // ── Titre ──
    const heading = line.match(HEADING);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1].length as 1 | 2 | 3,
        text: heading[2].trim(),
      });
      i += 1;
      continue;
    }

    // ── Citation ──
    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        quoted.push(lines[i].match(QUOTE)![1]);
        i += 1;
      }
      blocks.push({ kind: "quote", text: quoted.join("\n").trim() });
      continue;
    }

    // ── Liste ──
    const bullet = line.match(BULLET);
    const ordered = line.match(ORDERED);
    if (bullet || ordered) {
      const isOrdered = Boolean(ordered);
      const items: string[] = [];
      while (i < lines.length) {
        const m = isOrdered ? lines[i].match(ORDERED) : lines[i].match(BULLET);
        if (!m) break;
        items.push(m[1].trim());
        i += 1;
      }
      blocks.push({ kind: "list", ordered: isOrdered, items });
      continue;
    }

    // ── Paragraphe ──
    // Les lignes contiguës forment un seul paragraphe : dans un texte
    // technique, revenir à la ligne à 80 colonnes n'est pas un nouveau
    // paragraphe, c'est la même phrase.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !FENCE.test(lines[i]) &&
      !HEADING.test(lines[i]) &&
      !QUOTE.test(lines[i]) &&
      !BULLET.test(lines[i]) &&
      !ORDERED.test(lines[i])
    ) {
      para.push(lines[i].trim());
      i += 1;
    }
    blocks.push({ kind: "paragraph", text: para.join(" ") });
  }

  return blocks;
}

/**
 * Un premier titre utilisable comme nom de page, si le corps en contient un.
 *
 * Sert à préremplir le champ lors d'une création : la personne tape son
 * titre `# Démarrage`, et l'écran propose déjà « Démarrage ». Deviner
 * évite une saisie en double ; ne pas deviner laisserait un champ vide
 * que l'utilisateur remplit à la main — et qu'il remplira différemment.
 */
export function firstHeading(body: string): string | null {
  for (const block of parseDoc(body)) {
    if (block.kind === "heading") return block.text.slice(0, 120);
    if (block.kind === "paragraph" || block.kind === "code") return null;
  }
  return null;
}
