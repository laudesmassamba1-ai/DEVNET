/**
 * Modération de texte : gros mots, insultes, haine, scams.
 *
 * ## Pourquoi un module à part
 *
 * Un `filter(x => !badWords.includes(x))` ne filtre rien : il rate
 * `c0nn4rd`, `c o n n a r d`, `connnnard`, `çonnard`, et il bloque
 * `Scunthorpe` ou `assassin` parce qu'une sous-chaîne s'y cache. Un filtre
 * naïf est pire qu'aucun filtre : il donne l'illusion d'une protection et
 * punit des innocents.
 *
 * ## Ce que ce module fait
 *
 *  1. **Normalisation** : Unicode NFKD, diacritiques retirés, minuscules,
 *     leetspeak (`0→o`, `1→i`, `3→e`, `@→a`, `$→s`…), lettres répétées
 *     réduites, séparateurs internes retirés (`c.o.n.n.a.r.d`).
 *  2. **Deux passes** : mots entiers d'abord (fiable), puis forme compacte
 *     pour les contournements — avec une liste d'exceptions pour les mots
 *     légitimes qui contiennent une suite interdite (`assassin`, `Scunthorpe`,
 *     `connaissance`, `député`…).
 *  3. **Une décision graduée** : `allow`, `flag` (publié mais mis en file de
 *     relecture), `block` (refusé). Les insultes courantes sont `flag` par
 *     défaut ; la haine, la pédocriminalité et les menaces sont `block`.
 *  4. **Aucune donnée brute dans les alertes** : on rapporte le terme et sa
 *     catégorie, pas la phrase entière. Le contenu reste dans la table
 *     d'origine, là où il doit être modéré.
 *
 * ## Ce qu'il ne fait pas
 *
 * Il ne comprend pas le second degré, l'ironie, ni une insulte inventée. La
 * liste administrable (`moderation_terms`) et la file de relecture existent
 * précisément pour ce residu : le filtre automatique n'est pas un juge.
 */

export type ModerationCategory =
  | "insult"
  | "hate"
  | "sexual"
  | "violence"
  | "scam"
  | "drugs"
  | "selfharm"
  | "custom";

export type ModerationSeverity = "info" | "warning" | "critical";

export type ModerationVerdict = "allow" | "flag" | "block";

export type TermMatch = {
  term: string;
  category: ModerationCategory;
  severity: ModerationSeverity;
};

export type TextModerationResult = {
  verdict: ModerationVerdict;
  severity: ModerationSeverity;
  matches: TermMatch[];
  /** Explication lisible, sans répéter le contenu. */
  reason: string | null;
};

type Term = { term: string; category: ModerationCategory; severity: ModerationSeverity };

/**
 * Liste de base.
 *
 * Volontairement en français d'abord (la communauté est francophone), avec
 * les insultes anglophones que les messages contiennent de toute façon. Les
 * termes sont stockés normalisés (sans accent, minuscules) : la normalisation
 * de l'entrée suit exactement la même règle.
 */
const BASE_TERMS: Term[] = [
  // Insultes courantes. Le filtre est en mode `auto` : ces termes refusent
  // la publication. Les mots trop ambigus (« retard », « dégager », « race
  // de chevaux ») ont été retirés : un faux positif sur un mot ordinaire est
  // plus grave qu'un terme laissé passer, et la file de relecture existe.
  ...[
    "connard", "connasse", "conard", "conasse", "salaud", "salope", "salopard",
    "enculé", "encule", "enculer", "enfoiré", "enfoire", "abruti", "abrutie",
    "debile", "débile", "idiot", "idiote", "imbecile", "imbécile", "crétin",
    "cretin", "cretine", "crétine", "ordure", "batard", "bâtard", "batar",
    "pute", "putain", "putasse", "pouffiasse", "pétasse", "petasse", "garce",
    "nique", "niquer", "niqué", "nique ta", "fdp", "fils de pute", "ntm",
    "ta gueule", "ferme ta gueule",
    "merde", "merdique", "chiotte", "chieur", "chieuse",
    "foutre", "foutu", "foutue", "bordel",
  ].map((term) => ({ term, category: "insult" as const, severity: "warning" as const })),

  // Haine — `block`. Les slurs sont inclus parce qu'un filtre qui ne les
  // connaît pas ne filtre rien ; ils ne sont jamais affichés.
  ...[
    "negre", "nègre", "negro", "bougnoule", "bicot", "raton", "youpin",
    "feuj", "pede", "pédé", "pédophile", "pedophile", "tapette", "travelo",
    "gouine", "bamboula", "sale race", "sous-race", "sous race",
    "nazi", "hitler", "heil", "kkk", "suprémaciste", "supremaciste",
    "faggot", "nigger", "nigga", "tranny", "kike", "spic", "chink",
    "islamophobe", "antisémite", "antisemite", "xénophobe", "xenophobe",
  ].map((term) => ({ term, category: "hate" as const, severity: "critical" as const })),

  // Sexuel explicite et contenu impliquant des mineurs — `block`.
  ...[
    "porno", "pornographie", "pornhub", "xvideos", "xhamster", "onlyfans",
    "sexe explicite", "nudes", "nude", "sextape", "viol", "violer", "violeur",
    "pedopornographie", "pédopornographie", "lolicon", "shotacon",
    "underage", "mineure nue", "enfant nu", "enfants nus",
  ].map((term) => ({ term, category: "sexual" as const, severity: "critical" as const })),

  // Menaces et violence — `block` pour les menaces directes.
  ...[
    "je vais te tuer", "je vais te frapper", "je vais te buter", "je te tue",
    "je te bute", "mort à toi", "tu vas mourir", "attentat", "tuer tous",
    "massacre", "égorgé", "egorge", "décapiter", "decapiter", "kys", "kill yourself",
  ].map((term) => ({ term, category: "violence" as const, severity: "critical" as const })),

  // Arnaques et spam — `flag` : un lien de phishing doit être relu, pas
  // forcément supprimé (un membre peut prévenir les autres).
  ...[
    "crypto gratuit", "doublez votre argent", "double ton argent", "investissement garanti",
    "gagnez 500", "gagne 500", "argent facile", "sans risque garanti",
    "cliquez ici pour gagner", "compte bloqué cliquez", "votre compte sera suspendu",
    "free robux", "casino en ligne", "paris sportifs garantis", "prêt sans justificatif",
    "bitcoin doubler", "airdrop gratuit", "seed phrase", "phrase secrète",
  ].map((term) => ({ term, category: "scam" as const, severity: "warning" as const })),

  // Drogues dures — `flag`, sauf vente explicite.
  ...[
    "cocaïne", "cocaine", "héroïne", "heroine", "crystal meth", "methamphetamine",
    "vendre de la drogue", "vente de drogue", "dealer", "shit à vendre", "beuh à vendre",
  ].map((term) => ({ term, category: "drugs" as const, severity: "warning" as const })),

  // Auto-mutilation : `flag` avec priorité haute, jamais un blocage public —
  // humilier quelqu'un qui appelle à l'aide serait la pire réponse.
  ...[
    "je veux mourir", "je veux me tuer", "me suicider", "suicide", "me scarifier",
    "automutilation", "self harm", "kill myself",
  ].map((term) => ({ term, category: "selfharm" as const, severity: "warning" as const })),
];

/**
 * Mots légitimes qui contiennent une suite interdite.
 *
 * La passe compacte chercherait `con` dans `connaissance`, `pute` dans
 * `député`, `ass` dans `passer`. On protège les mots **entiers** listés ici.
 * C'est une liste de bon sens, pas une preuve : elle est courte, relue, et
 * complétée par les tests.
 */
const ALLOWLIST = new Set([
  "assassin", "assassiner", "assassinat", "assassine", "passer", "passage", "passion",
  "classe", "classique", "massif", "masse", "compas", "dépasser", "depasser",
  "connaissance", "connaitre", "connaître", "connexion", "connecter", "connecté",
  "contenu", "content", "contexte", "contrôle", "controle", "conseil", "concept",
  "concours", "concret", "concretement", "concurrence", "condition", "configurer",
  "confiance", "confirmer", "conflit", "congé", "conge", "congrès", "congres",
  "député", "depute", "réputation", "reputation", "computation", "amputé", "ampute",
  "scunthorpe", "penistone", "lightwater", "sussex", "essex", "middlesex",
  "analyse", "analyste", "analogique", "canal", "banal", "animal", "finale",
  "drogue", "drogues", "drogue", "sextant", "sexisme", "sexiste", "sexuel",
  // Mots ordinaires qu'un terme court retrouve à l'intérieur.
  "salopette", "salopettes", "bordelais", "bordelaise", "bordelaises",
  "ordurier", "orduriere", "orduriers", "ordurieres",
]);

/** Leetspeak et confusables : la même lettre, plusieurs déguisements. */
const LEET: Record<string, string> = {
  "0": "o", "1": "i", "2": "z", "3": "e", "4": "a", "5": "s", "6": "g",
  "7": "t", "8": "b", "9": "g", "@": "a", "$": "s", "!": "i", "|": "l",
  "€": "e", "£": "l", "ø": "o", "æ": "ae", "œ": "oe", "ß": "ss",
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x",
};

/** Normalisation « lisible » : accents, casse, leetspeak, lettres répétées. */
export function normalizeText(input: string): string {
  let value = input.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  value = value.replace(/[0-9@$!|€£øæœßаеорсух]/g, (char) => LEET[char] ?? char);
  value = value.replace(/(.)\1{2,}/g, "$1$1");
  return value;
}

/** Forme compacte : plus aucun séparateur, pour `c.o.n.n.a.r.d`. */
function compact(input: string): string {
  return normalizeText(input).replace(/[^a-z]/g, "");
}

function isAllowedWord(word: string): boolean {
  if (ALLOWLIST.has(word)) return true;
  // Pluriels et formes verbales simples.
  const singular = word.replace(/(aux|es|s)$/, "");
  return ALLOWLIST.has(singular);
}

/** Découpe en mots normalisés, en gardant la position pour ne pas recoller. */
function words(input: string): string[] {
  return normalizeText(input)
    .split(/[^a-z]+/)
    .map((word) => word.trim())
    .filter(Boolean);
}

export type ExtraTerm = {
  term: string;
  category?: ModerationCategory;
  severity?: ModerationSeverity;
};

/**
 * Analyse un texte.
 *
 * `extra` vient de la table administrable. Il est appliqué avec la même
 * normalisation : un terme saisi avec un accent fonctionne comme un terme
 * codé en dur.
 */
export function moderateText(
  input: string,
  extra: ExtraTerm[] = [],
): TextModerationResult {
  const text = input.trim();
  if (!text) return { verdict: "allow", severity: "info", matches: [], reason: null };

  const terms: Term[] = [
    ...BASE_TERMS,
    ...extra.map((item) => ({
      term: item.term,
      category: item.category ?? "custom",
      severity: item.severity ?? "warning",
    })),
  ];

  const tokenList = words(text);
  const tokenSet = new Set(tokenList);
  const flat = compact(text);
  const flatWords = tokenList.map((word) => compact(word));

  const matches = new Map<string, TermMatch>();

  const record = (term: Term) => {
    // Clé normalisée : « débile » et « debile » sont le même terme, et un
    // texte ne doit pas être annoncé comme contenant « 2 termes » pour un
    // seul mot accentué.
    const key = compact(term.term);
    if (!key || matches.has(key)) return;
    matches.set(key, {
      term: term.term,
      category: term.category,
      severity: term.severity,
    });
  };

  for (const term of terms) {
    const normalized = compact(term.term);
    if (!normalized) continue;

    // Passe 1 — mot entier (ou expression dont chaque mot est présent).
    const termWords = term.term
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((word) => compact(word))
      .filter(Boolean);

    if (termWords.length === 1) {
      const word = termWords[0];
      if (tokenSet.has(word) || flatWords.includes(word)) {
        if (!isAllowedWord(word)) record(term);
      }
    } else if (termWords.every((word) => flatWords.includes(word))) {
      // Expression : on exige la contiguïté dans la forme compacte.
      if (flat.includes(normalized)) record(term);
    }

    // Passe 2 — contournement par séparateurs ou caractères intercalés.
    // On ne la tente que pour les termes d'au moins 5 lettres : en dessous,
    // le risque de faux positif explose (`con`, `cul`, `ass`).
    if (normalized.length >= 5 && flat.includes(normalized)) {
      const around = tokenList.find((token) => {
        const compacted = compact(token);
        return compacted.includes(normalized) && compacted !== normalized;
      });
      // Un mot plus long qui contient le terme n'est pas une preuve, sauf si
      // ce mot n'est pas dans l'allowlist et que le terme est long.
      if (!around || (!isAllowedWord(around) && normalized.length >= 6)) record(term);
    }
  }

  if (matches.size === 0) {
    return { verdict: "allow", severity: "info", matches: [], reason: null };
  }

  const all = [...matches.values()];
  const severity: ModerationSeverity = all.some((match) => match.severity === "critical")
    ? "critical"
    : "warning";

  /*
   * Trois modes, et le défaut est volontairement asymétrique :
   *
   *  - `off` : on signale sans jamais refuser (installations qui préfèrent
   *    tout relire à la main) ;
   *  - `block` : tout terme trouvé refuse la publication — simple, brutal,
   *    et faux positif possible sur un mot légitime non listé ;
   *  - `auto` (défaut) : **les insultes, la haine, le sexuel et les
   *    menaces refusent** ; les arnaques, les drogues et les appels à
   *    l'aide passent en file de relecture. Bloquer un message de
   *    détresse serait la pire réponse possible ; bloquer une insulte
   *    est la réponse attendue.
   */
  const strict = (process.env.MODERATION_STRICT ?? "auto").toLowerCase();
  const blockingCategories = new Set(["insult", "hate", "sexual", "violence"]);
  const categories = new Set(all.map((match) => match.category));

  let verdict: ModerationVerdict;
  if (strict === "off") verdict = "allow";
  else if (strict === "block") verdict = "block";
  else if (severity === "critical") verdict = "block";
  else verdict = [...categories].some((category) => blockingCategories.has(category))
    ? "block"
    : "flag";

  const categoryList = [...categories].join(", ");
  return {
    verdict,
    severity,
    matches: all,
    reason: `${all.length} terme(s) à surveiller (${categoryList}).`,
  };
}

/** Vérifie un texte et lève une erreur compatible avec la passerelle REST. */
export class ModerationBlockedError extends Error {
  constructor(
    message: string,
    readonly terms: string[],
  ) {
    super(message);
    this.name = "ModerationBlockedError";
  }
}
