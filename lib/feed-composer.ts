/** Langages proposés dans le composeur de publication. */
export const LANG_OPTIONS = [
  "", "Python", "JavaScript", "TypeScript", "Java", "C / C++",
  "PHP", "Kotlin", "Dart", "Go", "Rust", "Swift", "SQL", "HTML/CSS",
];

/**
 * Brouillon de publication.
 *
 * Le composeur enregistre son état à chaque frappe et le récupère au
 * retour sur le fil : un post pensé, interrompu par une navigation, ne
 * se perd pas. La publication (ou la fermeture) vide le brouillon — un
 * post envoyé est un post parti.
 */
export const DRAFT_KEY = "devnet:compose";

export type ComposerDraft = {
  text: string;
  code: string;
  lang: string;
  isCode: boolean;
};

export const EMPTY_DRAFT: ComposerDraft = {
  text: "",
  code: "",
  lang: "",
  isCode: false,
};

export function readDraft(): ComposerDraft {
  if (typeof window === "undefined") return EMPTY_DRAFT;
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return EMPTY_DRAFT;
    const d = JSON.parse(raw) as Partial<ComposerDraft>;
    return {
      text: typeof d.text === "string" ? d.text : "",
      code: typeof d.code === "string" ? d.code : "",
      lang: typeof d.lang === "string" ? d.lang : "",
      isCode: Boolean(d.isCode),
    };
  } catch {
    return EMPTY_DRAFT;
  }
}

export function saveDraft(draft: ComposerDraft): void {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Stockage indisponible (navigation privée, quota) : on compose sans
    // filet, jamais on ne bloque la saisie pour un brouillon.
  }
}
