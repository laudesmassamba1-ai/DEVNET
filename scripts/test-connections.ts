/**
 * Tests des connexions sortantes — le registre multi-fournisseurs (030).
 *
 * Exécuter avec :  npx tsx scripts/test-connections.ts
 *
 * Deux familles d'invariants :
 *  - la **validation** des destinations est faite avant l'écriture : une
 *    API sans schéma `http(s)` ou un fournisseur inconnu sont refusés par
 *    le module, pas découverts une fois la ligne posée ;
 *  - la **RLS** de la table (héritée de la 004, élargie par la 030) se
 *    comporte comme la base : une connexion est personnelle, son identité
 *    ne se réécrit pas, son état est fermé, et `unique (user_id, provider)`
 *    tient. Une divergence ferait enseigner le contraire du produit.
 */

import {
  CONNECTION_PROVIDERS,
  connectProvider,
  disconnectConnection,
  providerInfo,
  touchConnection,
  validEndpoint,
} from "../lib/github/connect";
import { getBackend, isDemoMode, probeBackend } from "../lib/backend";
import { demoFrom } from "../lib/demo/query";
import { getStore, resetStore } from "../lib/demo/store";
import { saveSessionId } from "../lib/demo/session";

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) passed++;
  else failures.push(`${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
}

function eq<T>(name: string, actual: T, expected: T): void {
  check(name, actual === expected, { actual, expected });
}

interface Rowish { [k: string]: unknown }

async function main(): Promise<void> {
  /* ---------------------------------------------------------------- */
  /* 1. Le catalogue des fournisseurs                                  */
  /* ---------------------------------------------------------------- */

  const ids = CONNECTION_PROVIDERS.map((p) => p.id);
  eq("catalogue : trois fournisseurs", ids.length, 3);
  eq("catalogue : GitHub en fait partie", ids.includes("github"), true);
  check(
    "catalogue : chaque fiche est complète",
    CONNECTION_PROVIDERS.every((p) => p.label && p.icon && p.hint && p.identityLabel),
  );
  check(
    "catalogue : chaque fiche demande des capacités",
    CONNECTION_PROVIDERS.every((p) => Array.isArray(p.scopes)),
  );

  eq("GitHub : pas d'endpoint requis", providerInfo("github")?.needsEndpoint, false);
  eq("VS Code : un endpoint est requis", providerInfo("vscode")?.needsEndpoint, true);
  eq("un fournisseur inconnu n'a pas de fiche", providerInfo("ftp"), null);

  /* ---------------------------------------------------------------- */
  /* 2. La validation d'une destination                                */
  /* ---------------------------------------------------------------- */

  check("endpoint : https accepté", validEndpoint("https://ci.exemple.dev"));
  check("endpoint : http accepté", validEndpoint("http://localhost:8080"));
  check("endpoint : sans schéma refusé", !validEndpoint("ci.exemple.dev"));
  check("endpoint : javascript: refusé", !validEndpoint("javascript:alert(1)"));
  check("endpoint : data: refusé", !validEndpoint("data:text/plain,x"));
  check("endpoint : espace autour toléré", validEndpoint("  https://x.dev  "));
  check("endpoint : chaîne vide refusée", !validEndpoint(""));

  /* ---------------------------------------------------------------- */
  /* 3. Une connexion est personnelle                                  */
  /* ---------------------------------------------------------------- */

  // Le module `lib/github/connect` passe par le client partagé, qui route
  // vers le backend local **seulement** une fois la sonde en échec. En
  // test, personne ne sonde : on pose donc explicitement l'état « hors
  // ligne » (aucune URL configurée), comme `app/layout` le fait au
  // démarrage de l'application.
  await probeBackend();
  check("le backend local est actif", isDemoMode(), getBackend());

  resetStore();
  saveSessionId(null);

  const asGuest = await demoFrom("github_connections").select("id, provider");
  eq("aucune connexion hors session", (asGuest.data as Rowish[]).length, 0);

  saveSessionId("u-koffi");
  const mine = await demoFrom("github_connections").select("provider, status");
  eq("le titulaire voit ses trois connexions", (mine.data as Rowish[]).length, 3);
  eq(
    "les trois fournisseurs sont présents",
    (mine.data as Rowish[]).map((r) => r.provider).sort().join(","),
    "api,github,vscode",
  );

  saveSessionId("u-zainab");
  const stolen = await demoFrom("github_connections").select("id");
  eq("on ne lit pas les connexions d'un autre", (stolen.data as Rowish[]).length, 0);

  /* ---------------------------------------------------------------- */
  /* 4. On connecte une destination fraîche (RLS de la 030)            */
  /* ---------------------------------------------------------------- */

  const made = await demoFrom("github_connections")
    .insert({
      user_id: "u-zainab",
      provider: "vscode",
      login: "zainab-tunnel",
      endpoint: "https://zainab.devtunnels.ms",
    })
    .select()
    .single();
  check("une connexion s'enregistre", made.error === null, made.error);

  const row = made.data as Rowish;
  eq("l'état part à « active »", row.status, "active");
  eq("le fournisseur est conservé", row.provider, "vscode");
  eq("l'endpoint est conservé", row.endpoint, "https://zainab.devtunnels.ms");
  check("les capacités par défaut sont un tableau vide", Array.isArray(row.scopes) && (row.scopes as unknown[]).length === 0);
  eq("jamais utilisée au départ", row.used_at, null);
  eq("le pointeur de coffre est posé par le module", typeof row.token_ref, "string");

  const dup = await demoFrom("github_connections")
    .insert({ user_id: "u-zainab", provider: "vscode", login: "autre" });
  check(
    "une connexion par fournisseur et par personne",
    !!dup.error && /duplicate|unique/i.test(dup.error.message),
    dup.error,
  );

  /* ---------------------------------------------------------------- */
  /* 5. L'identité ne se réécrit pas, l'usage et l'état oui            */
  /* ---------------------------------------------------------------- */

  const id = row.id as string;

  check(
    "la destination ne se réécrit pas",
    (await demoFrom("github_connections").update({ endpoint: "https://ailleurs.exemple" }).eq("id", id)).error !== null,
  );
  check(
    "la connexion ne se réattribue pas",
    (await demoFrom("github_connections").update({ user_id: "u-koffi" }).eq("id", id)).error !== null,
  );
  check(
    "le pointeur de coffre ne se réécrit pas",
    (await demoFrom("github_connections").update({ token_ref: "vault://autre" }).eq("id", id)).error !== null,
  );
  check(
    "un état hors liste est refusé",
    (await demoFrom("github_connections").update({ status: "cassé" }).eq("id", id)).error !== null,
  );

  const touched = await demoFrom("github_connections")
    .update({ used_at: "2026-01-01T00:00:00Z", status: "active" })
    .eq("id", id)
    .select("used_at");
  eq("l'usage se met à jour", (touched.data as Rowish[])[0]?.used_at, "2026-01-01T00:00:00Z");

  /* ---------------------------------------------------------------- */
  /* 6. Le module valide avant d'écrire                                */
  /* ---------------------------------------------------------------- */

  const noEndpoint = await connectProvider({ me: "u-koffi", provider: "vscode", login: "sans-url" });
  check("un endpoint manquant est refusé", noEndpoint.error !== null, noEndpoint.error);

  const badUrl = await connectProvider({
    me: "u-koffi",
    provider: "api",
    login: "ci",
    endpoint: "javascript:alert(1)",
  });
  check("un endpoint non http(s) est refusé", badUrl.error !== null, badUrl.error);

  const noLogin = await connectProvider({
    me: "u-koffi",
    provider: "api",
    login: "   ",
    endpoint: "https://ci.exemple.dev",
  });
  check("une identité vide est refusée", noLogin.error !== null, noLogin.error);

  // `github` n'exige pas d'endpoint : un identifiant suffit.
  const githubOk = await connectProvider({ me: "u-zainab", provider: "github", login: "zainab-gh" });
  check("GitHub se connecte sans endpoint", githubOk.error === null && githubOk.connection?.provider === "github", githubOk.error);

  /* ---------------------------------------------------------------- */
  /* 7. Usage constaté et déconnexion                                  */
  /* ---------------------------------------------------------------- */

  await touchConnection(id);
  const afterTouch = getStore().github_connections.find((c) => c.id === id)!;
  check("le module constate un usage", Boolean(afterTouch.used_at), afterTouch.used_at);

  const before = getStore().github_connections.length;
  await disconnectConnection(id);
  eq("déconnecter retire la ligne", getStore().github_connections.length, before - 1);

  saveSessionId("u-koffi");
  const still = await demoFrom("github_connections").select("id");
  eq("reste les trois connexions du titulaire", (still.data as Rowish[]).length, 3);
}

main()
  .then(() => {
    console.log(`\n${passed} vérification(s) passée(s), ${failures.length} échec(s)\n`);
    if (failures.length) {
      for (const f of failures) console.log(`  ✗ ${f}`);
      process.exit(1);
    }
    console.log("  ✓ Le registre de connexions valide les destinations et respecte la RLS\n");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
