/**
 * Vérifie que `publicOrigin` renvoie l'URL que le navigateur voit,
 * et non l'origine locale de Next.js.
 *
 * ## Pourquoi
 *
 * Le flux OAuth a deux points qui dépendent de l'origine :
 *   · le `redirect_uri` envoyé à GitHub — GitHub refuse un URI relatif,
 *     et renvoie l'utilisateur sur cette URL ;
 *   · le cookie d'état, dont l'attribut `secure` doit correspondre au
 *     protocole réel.
 *
 * Next.js, derrière un reverse proxy, ne voit que
 * `http://localhost:3000`. Si on utilise cette origine :
 *   · le `redirect_uri` est en HTTP, GitHub le refuse ou redirige vers
 *     une URL en HTTP depuis une page HTTPS — le navigateur bloque le
 *     chargement mixte, et l'erreur « Ce site ne peut pas fournir de
 *     connexion sécurisée » apparaît ;
 *   · le cookie `secure` est refusé, l'état disparaît.
 *
 * En production, ces headers peuvent aussi être fournis par le client :
 * seule l'origine configurée est prioritaire. Le repli sur les headers
 * est réservé au développement local derrière un tunnel.
 */
import { publicOrigin } from "@/lib/github/oauth";

const development = { nodeEnv: "development", configuredOrigin: "" };

function check(label: string, request: Request, expected: string) {
  const actual = publicOrigin(request, development);
  const ok = actual === expected;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}: ${actual} (attendu ${expected})`);
  if (!ok) process.exitCode = 1;
}

// 1. Développement local, HTTP pur : pas de proxy, on tombe sur l'origine
//    de la requête.
check(
  "HTTP local",
  new Request("http://localhost:3000/api/github/authorize?u=a&next=/p"),
  "http://localhost:3000",
);

// 2. Derrière le tunnel Cloudflare : la requête arrive en HTTP sur
//    Next.js, mais le navigateur voit HTTPS sur un autre host.
check(
  "tunnel Cloudflare",
  new Request("http://localhost:3000/api/github/authorize?u=a&next=/p", {
    headers: {
      "x-forwarded-proto": "https",
      "x-forwarded-host": "behavioral-territories-about-handles.trycloudflare.com",
    },
  }),
  "https://behavioral-territories-about-handles.trycloudflare.com",
);

// 3. Production, HTTPS direct : les headers sont absents, on utilise
//    l'URL de la requête.
check(
  "HTTPS direct",
  new Request("https://app.example.com/api/github/authorize?u=a&next=/p"),
  "https://app.example.com",
);

// 4. Proxy de développement multi-valeurs : on prend le premier élément.
check(
  "proxy multi-valeurs",
  new Request("http://localhost:3000/api/github/authorize?u=a&next=/p", {
    headers: {
      "x-forwarded-proto": "http, https",
      "x-forwarded-host": "a.example.com, b.example.com",
    },
  }),
  "http://a.example.com",
);

// 5. `x-forwarded-proto` absent sur un tunnel de développement : HTTPS
//    par défaut.
check(
  "host sans proto",
  new Request("http://localhost:3000/api/github/authorize?u=a&next=/p", {
    headers: { "x-forwarded-host": "app.example.com" },
  }),
  "https://app.example.com",
);

const productionRequest = new Request("https://app.example.com/api/github/authorize", {
  headers: {
    "x-forwarded-proto": "https",
    "x-forwarded-host": "attacker.example",
  },
});
let rejectedMissingOrigin = false;
try {
  publicOrigin(productionRequest, { nodeEnv: "production" });
} catch {
  rejectedMissingOrigin = true;
}
console.log(`${rejectedMissingOrigin ? "ok  " : "FAIL"} production requires an explicit public origin`);
if (!rejectedMissingOrigin) process.exitCode = 1;

let configuredOriginWins = false;
try {
  configuredOriginWins =
    publicOrigin(productionRequest, {
      nodeEnv: "production",
      configuredOrigin: "https://devnet.example.com",
    }) === "https://devnet.example.com";
} catch {
  configuredOriginWins = false;
}
console.log(`${configuredOriginWins ? "ok  " : "FAIL"} configured origin overrides forwarded headers`);
if (!configuredOriginWins) process.exitCode = 1;

let rejectedInvalidOrigin = false;
try {
  publicOrigin(productionRequest, {
    nodeEnv: "production",
    configuredOrigin: "javascript:alert(1)",
  });
} catch {
  rejectedInvalidOrigin = true;
}
console.log(`${rejectedInvalidOrigin ? "ok  " : "FAIL"} invalid configured origins are rejected`);
if (!rejectedInvalidOrigin) process.exitCode = 1;