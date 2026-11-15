/**
 * Test de la passerelle vers VS Code.
 *
 *   npx tsx scripts/test-vscode.ts
 *
 * Ces fonctions produisent des adresses que le système remet à un autre
 * programme : une faute d'encodage ne se voit pas à l'écran, elle se voit
 * comme une fenêtre qui s'ouvre sur un fichier introuvable, ou pas du
 * tout. On vérifie donc la chaîne exacte, pas seulement « ça commence par
 * `vscode://` ». Le `devcontainer.json` est relu avec `JSON.parse` : une
 * virgule en trop ferait échouer VS Code silencieusement.
 */

import {
  cloneRepoUri,
  devcontainerJson,
  encodePath,
  openFileUri,
  openFolderUri,
  openInVSCode,
  recommendedExtensions,
} from "../lib/vscode/bridge";

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) passed++;
  else failures.push(`${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
}

function main() {
  /* ── Chemins POSIX ───────────────────────────────────────────── */

  check(
    "POSIX : fichier sans position",
    openFileUri("/home/lea/app.ts") === "vscode://file/home/lea/app.ts",
    openFileUri("/home/lea/app.ts"),
  );

  check(
    "POSIX : fichier avec ligne et colonne",
    openFileUri("/home/lea/app.ts", 12, 5) === "vscode://file/home/lea/app.ts:12:5",
    openFileUri("/home/lea/app.ts", 12, 5),
  );

  check(
    "POSIX : la ligne seule suffit",
    openFileUri("/home/lea/app.ts", 7) === "vscode://file/home/lea/app.ts:7",
    openFileUri("/home/lea/app.ts", 7),
  );

  // `file:12:` n'existe pas : une colonne sans ligne doit être ignorée,
  // pas collée au chemin.
  check(
    "POSIX : une colonne sans ligne est ignorée",
    openFileUri("/home/lea/app.ts", undefined, 5) === "vscode://file/home/lea/app.ts",
    openFileUri("/home/lea/app.ts", undefined, 5),
  );

  check(
    "POSIX : ligne nulle ou négative ignorée",
    openFileUri("/home/lea/app.ts", 0) === "vscode://file/home/lea/app.ts" &&
      openFileUri("/home/lea/app.ts", -3) === "vscode://file/home/lea/app.ts",
    openFileUri("/home/lea/app.ts", 0),
  );

  check(
    "une URI file:// déjà formée n'est pas doublée",
    openFileUri("file:///home/lea/app.ts") === "vscode://file/home/lea/app.ts",
    openFileUri("file:///home/lea/app.ts"),
  );

  /* ── Chemins Windows ─────────────────────────────────────────── */

  // Le `:` du lecteur reste un `:` : encodé en `%3A`, VS Code chercherait
  // un fichier nommé « C%3A ».
  const win = "C:\\Users\\Lea\\Documents\\app.ts";
  check(
    "Windows : antislashs normalisés, lecteur préservé",
    openFileUri(win, 3, 1) === "vscode://file/C:/Users/Lea/Documents/app.ts:3:1",
    openFileUri(win, 3, 1),
  );
  check(
    "Windows : le deux-points du lecteur n'est pas encodé",
    !openFileUri(win).includes("%3A"),
    openFileUri(win),
  );
  check(
    "Windows : lecteur en minuscule",
    openFileUri("d:\\projets\\app.js") === "vscode://file/d:/projets/app.js",
    openFileUri("d:\\projets\\app.js"),
  );

  /* ── Encodage des espaces et des accents ─────────────────────── */

  check(
    "espace encodée en %20",
    openFileUri("/home/lea/mes projets/app.ts") ===
      "vscode://file/home/lea/mes%20projets/app.ts",
    openFileUri("/home/lea/mes projets/app.ts"),
  );
  check(
    "accents encodés en UTF-8",
    openFileUri("/home/léa/Maël.ts") === "vscode://file/home/l%C3%A9a/Ma%C3%ABl.ts",
    openFileUri("/home/léa/Maël.ts"),
  );
  check(
    "les `#` et `?` d'un nom de fichier ne cassent pas l'URI",
    openFileUri("/home/lea/tmp#1/x?.ts") === "vscode://file/home/lea/tmp%231/x%3F.ts",
    openFileUri("/home/lea/tmp#1/x?.ts"),
  );
  check(
    "encodePath préserve les séparateurs",
    encodePath("C:\\a b\\c") === "C:/a%20b/c",
    encodePath("C:\\a b\\c"),
  );

  /* ── Dossier ─────────────────────────────────────────────────── */

  check(
    "dossier : même forme que le fichier, sans position",
    openFolderUri("/home/lea/projet") === "vscode://file/home/lea/projet",
    openFolderUri("/home/lea/projet"),
  );
  check(
    "dossier : barre oblique finale retirée",
    openFolderUri("/home/lea/projet/") === "vscode://file/home/lea/projet",
    openFolderUri("/home/lea/projet/"),
  );

  /* ── Clonage ─────────────────────────────────────────────────── */

  const repo = "https://github.com/lea/devnet.git";
  check(
    "clone : URL encodée en paramètre",
    cloneRepoUri(repo) === "vscode://vscode.git/clone?url=https%3A%2F%2Fgithub.com%2Flea%2Fdevnet.git",
    cloneRepoUri(repo),
  );
  check(
    "clone : l'action vscode.git est bien présente",
    cloneRepoUri(repo).startsWith("vscode://vscode.git/clone?url="),
    cloneRepoUri(repo),
  );
  check(
    "clone : dépôt avec espace et accent correctement encodé",
    cloneRepoUri("https://exemple.afrique/dépôts/mon app.git") ===
      "vscode://vscode.git/clone?url=https%3A%2F%2Fexemple.afrique%2Fd%C3%A9p%C3%B4ts%2Fmon%20app.git",
    cloneRepoUri("https://exemple.afrique/dépôts/mon app.git"),
  );
  check(
    "clone : pas de dépôt → URI vide, pas de plantage",
    cloneRepoUri("") === "vscode://vscode.git/clone?url=",
    cloneRepoUri(""),
  );

  /* ── Ouverture hors navigateur ───────────────────────────────── */

  // En Node il n'y a pas de `window` : la fonction doit le dire, pas
  // lever. Un composant rendu côté serveur traverse ce chemin.
  check("openInVSCode renvoie false sans window", openInVSCode("vscode://file/x") === false);

  /* ── devcontainer.json ───────────────────────────────────────── */

  const raw = devcontainerJson();
  let doc: Record<string, unknown> | null = null;
  try {
    doc = JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    check("devcontainer : JSON relisible", false, String(error));
  }

  if (doc) {
    check("devcontainer : JSON relisible", true);
    check(
      "devcontainer : ordre des clés stable",
      JSON.stringify(Object.keys(doc)) ===
        JSON.stringify(["name", "image", "customizations", "postCreateCommand", "forwardPorts"]),
      Object.keys(doc),
    );
    check(
      "devcontainer : nom et image par défaut",
      doc.name === "devnet" &&
        typeof doc.image === "string" &&
        (doc.image as string).startsWith("mcr.microsoft.com/devcontainers/"),
      { name: doc.name, image: doc.image },
    );
    const vscode = (doc.customizations as { vscode?: { extensions?: string[] } })?.vscode;
    check(
      "devcontainer : extensions par défaut présentes",
      Array.isArray(vscode?.extensions) && (vscode?.extensions?.length ?? 0) > 0,
      vscode?.extensions,
    );
    check(
      "devcontainer : npm install par défaut",
      doc.postCreateCommand === "npm install",
      doc.postCreateCommand,
    );
    check(
      "devcontainer : port 3000 transféré par défaut",
      JSON.stringify(doc.forwardPorts) === JSON.stringify([3000]),
      doc.forwardPorts,
    );
  }

  // Un appelant qui précise tout doit retrouver ses valeurs, sans doublon
  // et sans port absurde.
  const customRaw = devcontainerJson({
    name: "  devnet-web  ",
    image: "node:22",
    extensions: ["dbaeumer.vscode-eslint", "dbaeumer.vscode-eslint", "  ", "bradlc.vscode-tailwindcss"],
    postCreateCommand: "npm ci",
    forwardPorts: [3000, 3000, -1, 70000, 5173],
  });
  let custom: Record<string, unknown> | null = null;
  try {
    custom = JSON.parse(customRaw) as Record<string, unknown>;
  } catch (error) {
    check("devcontainer personnalisé : JSON relisible", false, String(error));
  }
  if (custom) {
    check("devcontainer personnalisé : JSON relisible", true);
    check("devcontainer : nom nettoyé", custom.name === "devnet-web", custom.name);
    check("devcontainer : image personnalisée", custom.image === "node:22", custom.image);
    check(
      "devcontainer : extensions dédoublonnées et nettoyées",
      JSON.stringify((custom.customizations as { vscode: { extensions: string[] } }).vscode.extensions) ===
        JSON.stringify(["dbaeumer.vscode-eslint", "bradlc.vscode-tailwindcss"]),
      (custom.customizations as { vscode: { extensions: string[] } }).vscode.extensions,
    );
    check(
      "devcontainer : commande personnalisée",
      custom.postCreateCommand === "npm ci",
      custom.postCreateCommand,
    );
    check(
      "devcontainer : ports invalides et doublons retirés",
      JSON.stringify(custom.forwardPorts) === JSON.stringify([3000, 5173]),
      custom.forwardPorts,
    );
  }

  /* ── extensions.json ─────────────────────────────────────────── */

  const recRaw = recommendedExtensions([
    "dbaeumer.vscode-eslint",
    "dbaeumer.vscode-eslint",
    "bradlc.vscode-tailwindcss",
    "",
  ]);
  let rec: { recommendations?: string[] } | null = null;
  try {
    rec = JSON.parse(recRaw) as { recommendations?: string[] };
  } catch (error) {
    check("extensions : JSON relisible", false, String(error));
  }
  if (rec) {
    check("extensions : JSON relisible", true);
    check(
      "extensions : recommandations dédoublonnées",
      JSON.stringify(rec.recommendations) ===
        JSON.stringify(["dbaeumer.vscode-eslint", "bradlc.vscode-tailwindcss"]),
      rec.recommendations,
    );
    check("extensions : la clé est `recommendations`", "recommendations" in rec);
  }

  /* ── Rapport ─────────────────────────────────────────────────── */

  console.log(`\n${passed} vérification(s) passée(s), ${failures.length} échec(s)\n`);
  if (failures.length) {
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("  ✓ Les URI VS Code et les exports sont correctement formés\n");
}

main();
