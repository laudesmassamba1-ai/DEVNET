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
 * Les headers `x-forwarded-proto` / `x-forwarded-host` sont posés par
 * cloudflared (et tout reverse proxy standard) ; on les préfère à
 * `request.url`.
 */
import { publicOrigin } from "@/lib/github/oauth";

function check(label: string, request: Request, expected: string) {
  const actual = publicOrigin(request);
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

// 4. Proxy mal configuré : `x-forwarded-host` en liste, on prend le
//    premier élément, comme un reverse proxy standard le ferait.
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

// 5. `x-forwarded-proto` absent mais `x-forwarded-host` présent : on
//    suppose HTTPS par défaut, comme le ferait un proxy inversé.
check(
  "host sans proto",
  new Request("http://localhost:3000/api/github/authorize?u=a&next=/p", {
    headers: { "x-forwarded-host": "app.example.com" },
  }),
  "https://app.example.com",
);