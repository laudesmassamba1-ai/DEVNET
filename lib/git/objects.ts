/**
 * Objets git — calcul d'identifiants de contenu.
 *
 * ## Pourquoi réécrire git
 *
 * Le modèle de git a une propriété qu'aucun autre n'a : **l'identité d'un
 * objet est le hachage de son contenu**. Un fichier, un répertoire, un
 * commit portent un nom qui *est* leur contenu. Deux conséquences qu'on ne
 * peut pas contourner et qui dictent toute cette couche :
 *
 * - un commit créé dans DevNet et poussé sur GitHub est **le même commit**,
 *   pas un commit « qui ressemble » : le sha est calculé pareil ;
 * - un fichier modifié produit un nouveau sha, donc une nouvelle version,
 *   sans qu'on ait besoin d'un numéro de révision à côté.
 *
 * On réimplémente donc le format, pas l'algorithme de merge : celu-ci
 * n'est pas nécessaire ici et ferait des centaines de lignes.
 *
 * ## Pourquoi SHA-1 à la main
 *
 * Le projet n'a aucune dépendance d'exécution en dehors de Supabase, et
 * `crypto.subtle` est asynchrone : il casserait le caractère **pur** du
 * moteur, que l'on veut pouvoir tester et réutiliser partout. Vingt lignes
 * de SHA-1 valent mieux qu'une dépendance pour une primitive stable depuis
 * 1995. Le seul défaut connu de SHA-1 (collisions pratiques) n'a aucune
 * prise ici : on ne cherche pas à forger un conflit, on veut nommer un
 * contenu.
 */

const utf8 = new TextEncoder();

/** SHA-1 sur un tableau d'octets, en hexadécimal minuscule. */
export function sha1Hex(input: Uint8Array): string {
  const len = input.length;
  // Longueur en bits, sur 64 bits : deux mots de 32 bits, big-endian.
  const bits = len * 8;
  const hi = Math.floor(bits / 0x1_0000_0000);
  const lo = bits >>> 0;

  // On complète à un multiple de 64 octets : 0x80, des zéros, puis 8
  // octets de longueur.
  const size = Math.ceil((len + 9) / 64) * 64;
  const buf = new Uint8Array(size);
  buf.set(input);
  buf[len] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(size - 8, hi, false);
  view.setUint32(size - 4, lo, false);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const w = new Uint32Array(80);

  for (let off = 0; off < size; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 80; i++) {
      const n = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = (n << 1) | (n >>> 31);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }

      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
      e = d;
      d = c;
      c = ((b << 30) | (b >>> 2)) >>> 0;
      b = a;
      a = t;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  return [h0, h1, h2, h3, h4].map((x) => x.toString(16).padStart(8, "0")).join("");
}

/** Assemble un objet git : `<type> <taille en octets>\0<contenu>`. */
function framed(type: string, body: Uint8Array): Uint8Array {
  const head = utf8.encode(`${type} ${body.length}\0`);
  const out = new Uint8Array(head.length + body.length);
  out.set(head, 0);
  out.set(body, head.length);
  return out;
}

/** sha d'un fichier. `git hash-object`. */
export function hashBlob(content: string): string {
  return sha1Hex(framed("blob", utf8.encode(content)));
}

export interface TreeEntry {
  /** Mode git : `100644` fichier, `40000` répertoire. */
  mode: string;
  name: string;
  sha: string;
}

/**
 * sha d'un répertoire.
 *
 * Les entrées sont triées, mais **comme git les trie** : un répertoire
 * se classe sur son nom suivi d'une barre oblique, sinon `src.bak` se
 * se trouverait avant `src/` et l’arborescence serait fausse. Un tri naïf
 * donnerait un sha différent de celui de git — donc un dépôt poussé puis
 * relu ne serait pas reconnu comme le même dépôt.
 */
export function hashTree(entries: TreeEntry[]): string {
  const sorted = [...entries].sort((a, b) => {
    const x = a.mode === "40000" ? `${a.name}/` : a.name;
    const y = b.mode === "40000" ? `${b.name}/` : b.name;
    return x < y ? -1 : x > y ? 1 : 0;
  });

  const parts: Uint8Array[] = [];
  for (const e of sorted) {
    parts.push(utf8.encode(`${e.mode} ${e.name}\0`));
    // Dans un objet git, un sha est stocké en binaire : 20 octets, et non
    // les 40 caractères hexadécimaux qu'on manipule partout ailleurs.
    parts.push(hexToBytes(e.sha));
  }

  const total = parts.reduce((n, p) => n + p.length, 0);
  const body = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    body.set(p, off);
    off += p.length;
  }

  return sha1Hex(framed("tree", body));
}

export interface CommitInput {
  tree: string;
  /** Mères du commit : deux pour une fusion, une sinon, aucune pour le premier. */
  parents: string[];
  authorName: string;
  authorEmail: string;
  /** Horodatage en secondes. */
  when: number;
  message: string;
}

/**
 * sha d'un commit.
 *
 * Le fuseau est fixé à `+0000` : c'est le seul choix qui rend le hachage
 * reproductible, donc testable, et cela ne change rien à l'identité du
 * contenu. Un vrai `git log` affiche l'heure locale de l'utilisateur, ce
 * qui n'appartient pas au commit.
 */
export function hashCommit(c: CommitInput): string {
  const stamp = `${c.authorName} <${c.authorEmail}> ${c.when} +0000`;
  const lines = [
    `tree ${c.tree}`,
    ...c.parents.map((p) => `parent ${p}`),
    `author ${stamp}`,
    `committer ${stamp}`,
    "",
    c.message,
  ];
  // Le saut de ligne final fait partie du format : sans lui, le sha ne
  // correspond pas à celui de git et le commit devient inconnu à l'import.
  return sha1Hex(framed("commit", utf8.encode(`${lines.join("\n")}\n`)));
}

/** 40 caractères hexadécimaux → 20 octets. */
export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Le contenu est-il un sha bien formé ? */
export function isSha(value: string): boolean {
  return /^[0-9a-f]{40}$/.test(value);
}

/**
 * « Ganja », le sha d'un commit vide.
 *
 * On ne l'écrit nulle part : c'est la sentinelle qui désigne « pas de
 * parent », parce qu'une chaîne vide est indistinguishable d'une valeur
 * manquante dans une colonne SQL.
 */
export const NULL_SHA = "0000000000000000000000000000000000000000";

/** Vrai si le sha désigne l'absence de commit. */
export const isNullSha = (sha: string | null | undefined): boolean =>
  !sha || sha === NULL_SHA;