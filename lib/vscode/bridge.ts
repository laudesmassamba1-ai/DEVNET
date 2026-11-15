/**
 * Passerelle vers VS Code — liens profonds, export devcontainer.
 *
 * On ne peut pas embarquer le client VS Code dans une page : c'est une
 * application de bureau, pas une bibliothèque. Ce module ne fait donc
 * qu'une chose : fabriquer des URI que le système sait remettre au
 * gestionnaire de protocole `vscode://`. Rien ici ne touche au DOM en
 * dehors de `openInVSCode`, et rien n'importe React — les mêmes fonctions
 * servent côté serveur (pour générer un `devcontainer.json`) et dans un
 * bouton client.
 *
 * Le point délicat est l'encodage. Une URI `vscode://file/...` n'est pas
 * un chemin : c'est une URI dont le chemin est lui-même un chemin de
 * fichier. Le séparateur `/` doit rester tel quel, les `:` d'un lecteur
 * Windows (`C:`) ou d'un numéro de ligne ne doivent **pas** devenir
 * `%3A`, mais un espace ou un accent doivent l'être. Encoder le chemin
 * entier l'abîmerait ; ne pas l'encoder du tout le casserait dès qu'un
 * dossier contient une espace. On encode donc segment par segment, puis
 * on restaure les `:`.
 */

/** Base du gestionnaire de fichiers de VS Code, sans barre finale. */
const FILE_SCHEME = "vscode://file";

/**
 * Normalise un chemin d'exploitation vers une forme d'URI.
 *
 * - une URI `file://` déjà formée est dépouillée de son préfixe ;
 * - les antislashs Windows deviennent des `/` ;
 * - l'espace de début et de fin est retiré ;
 * - une barre oblique finale est retirée (sauf à la racine) pour que le
 *   même dossier donne toujours la même URI.
 */
function normalizePath(input: string): string {
  let p = input.trim();

  // Un appelant peut déjà tenir une URI `file://`. On ne la double pas.
  if (/^file:\/\//i.test(p)) p = p.replace(/^file:\/\//i, "");

  // Windows : `C:\Users\...` doit devenir `C:/Users/...`. On ne touche
  // pas aux `:` — ils sépareront le lecteur du reste.
  p = p.replace(/\\/g, "/");

  if (p.length > 1 && p.endsWith("/")) p = p.replace(/\/+$/, "");

  return p;
}

/**
 * Encode un chemin pour une URI sans casser ses séparateurs.
 *
 * `encodeURIComponent` sur le chemin complet encoderait les `/` et les
 * `:` ; on l'applique donc à chaque segment, puis on remet les `:` en
 * clair. Les accents partent en UTF-8 (`Ma%C3%ABl`) et les espaces en
 * `%20`, ce que le gestionnaire de protocole relit correctement.
 */
export function encodePath(path: string): string {
  return normalizePath(path)
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(/%3A/gi, ":"))
    .join("/");
}

/**
 * Assemble `vscode://file` et un chemin encodé.
 *
 * Le `/` qui sépare l'action du chemin vient du **chemin lui-même**
 * quand il est absolu (`/home/...`), sinon on l'ajoute (`C:/...`). Le
 * mettre en dur dans la base produirait `vscode://file//home/...`, une
 * URI que VS Code n'ouvre pas.
 */
function fileUri(path: string): string {
  const encoded = encodePath(path);
  return `${FILE_SCHEME}${encoded.startsWith("/") ? "" : "/"}${encoded}`;
}

/** Un numéro de ligne/colonne n'est retenu que s'il est un entier ≥ 1. */
function positiveInt(value: number | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

/**
 * URI d'ouverture : un fichier, éventuellement à une ligne/colonne.
 *
 * `vscode://file/<chemin>:<ligne>:<colonne>`. La colonne sans ligne est
 * ignorée : `file:12:` n'a pas de sens pour VS Code, qui attend la ligne
 * avant la colonne.
 */
export function openFileUri(
  path: string,
  line?: number,
  column?: number,
): string {
  const l = positiveInt(line);
  const c = positiveInt(column);
  const suffix = l !== null ? `:${l}${c !== null ? `:${c}` : ""}` : "";
  return `${fileUri(path)}${suffix}`;
}

/**
 * URI d'ouverture : un dossier.
 *
 * Le gestionnaire `file` de VS Code ouvre le dossier quand le chemin en
 * désigne un, et le fichier quand c'en est un. L'URI est donc la même que
 * `openFileUri` sans suffixe — la fonction existe surtout pour rendre
 * l'intention lisible à l'appel.
 */
export function openFolderUri(dir: string): string {
  return fileUri(dir);
}

/**
 * URI de clonage : `vscode://vscode.git/clone?url=<dépôt>`.
 *
 * L'URL du dépôt est encodée en bloc : c'est la **valeur** d'un
 * paramètre, donc ses `:` et ses `/` doivent disparaître pour ne pas
 * être pris pour la structure de l'URI extérieure.
 */
export function cloneRepoUri(repo: string): string {
  const url = repo.trim();
  return `vscode://vscode.git/clone?url=${encodeURIComponent(url)}`;
}

/**
 * Ouvre une URI dans VS Code, si l'on est dans un navigateur.
 *
 * Renvoie `false` hors navigateur (rendu serveur, test Node) plutôt que
 * de lever : un composant rendu côté serveur ne doit pas planter.
 *
 * On clique un `<a>` plutôt que d'écrire dans `window.location` : un
 * gestionnaire de protocole enregistré attrape la navigation, alors
 * qu'une affectation directe peut être bloquée ou, sans gestionnaire,
 * faire quitter la page vers une adresse inconnue. Le lien est monté
 * dans le document, cliqué, puis retiré — sur certains navigateurs un
 * clic sur un nœud détaché est ignoré.
 */
export function openInVSCode(uri: string): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }

  const anchor = document.createElement("a");
  anchor.href = uri;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  return true;
}

/* ── Export devcontainer ─────────────────────────────────────────── */

/**
 * Le conteneur par défaut parle déjà la langue du dépôt : Node 20 pour
 * l'application, et les extensions que le projet suppose — lint, format,
 * et le support Tailwind. Un appelant qui ne sait presque rien du projet
 * obtient malgré tout un fichier utile.
 */
export const DEFAULT_DEVCONTAINER_NAME = "devnet";
export const DEFAULT_DEVCONTAINER_IMAGE =
  "mcr.microsoft.com/devcontainers/typescript-node:20";

/** Extensions recommandées par défaut, dans un ordre stable. */
export const DEFAULT_EXTENSIONS: readonly string[] = [
  "dbaeumer.vscode-eslint",
  "esbenp.prettier-vscode",
  "bradlc.vscode-tailwindcss",
];

/** Ce qu'un appelant peut préciser — tout le reste a un défaut. */
export interface DevcontainerSpec {
  name?: string;
  /** Image de base complète ; remplace l'image par défaut. */
  image?: string;
  /** Identifiants d'extensions ; remplace la liste par défaut. */
  extensions?: string[];
  /** Commande jouée après la création du conteneur. */
  postCreateCommand?: string;
  /** Ports transférés vers l'hôte. */
  forwardPorts?: number[];
}

/** Retire les vides, les espaces de bord et les doublons, en gardant l'ordre. */
function dedupe(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = raw.trim();
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

/**
 * `devcontainer.json` d'un projet, sous forme de chaîne JSON.
 *
 * L'ordre des clés est fixe — l'objet est construit dans l'ordre voulu,
 * et `JSON.stringify` le préserve — pour qu'un diff ne montre que ce qui
 * a réellement changé. On n'ajoute pas de `$schema` : le fichier reste
 * minimal et lisible, et VS Code n'en a pas besoin pour fonctionner.
 */
export function devcontainerJson(spec: DevcontainerSpec = {}): string {
  const name = spec.name?.trim() || DEFAULT_DEVCONTAINER_NAME;
  const image = spec.image?.trim() || DEFAULT_DEVCONTAINER_IMAGE;
  const extensions = dedupe(spec.extensions ?? DEFAULT_EXTENSIONS);
  const postCreateCommand = spec.postCreateCommand?.trim() || "npm install";
  const forwardPorts = [
    ...new Set(
      (spec.forwardPorts ?? [3000]).filter(
        (port) => Number.isInteger(port) && port > 0 && port < 65536,
      ),
    ),
  ];

  const doc = {
    name,
    image,
    customizations: {
      vscode: {
        extensions,
      },
    },
    postCreateCommand,
    forwardPorts,
  };

  return `${JSON.stringify(doc, null, 2)}\n`;
}

/**
 * Contenu de `.vscode/extensions.json` à partir d'une liste d'identifiants.
 *
 * C'est une **recommandation**, pas une installation : VS Code la propose
 * à l'ouverture du dossier. On dédoublonne et on nettoie, parce qu'une
 * liste recopiée à la main contient souvent deux fois la même extension.
 */
export function recommendedExtensions(ids: readonly string[]): string {
  return `${JSON.stringify({ recommendations: dedupe(ids) }, null, 2)}\n`;
}
