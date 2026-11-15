/**
 * Tests des GIF — recherche et sûreté des liens.
 *
 * Exécuter avec :  npx tsx scripts/test-gifs.ts
 *
 * Ce qui est vérifié ici ne dépend pas du réseau : la forme des
 * réponses des deux fournisseurs, le nettoyage de la recherche, et
 * surtout le **filtre d'URL**. Une URL `javascript:` ou `data:` qui
 * passerait ce filtre serait stockée dans `posts.gif_url` puis rendue
 * dans une balise `<img>` : c'est la porte à ne jamais laisser ouverte.
 */

import {
  GIF_QUERY_MAX,
  giphySearchUrl,
  isAllowedGifUrl,
  mapGiphy,
  mapTenor,
  parseGifQuery,
  tenorSearchUrl,
} from "../lib/gifs";
import {
  attachmentColumns,
  canSendMessage,
} from "../lib/message-media";

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) passed++;
  else failures.push(`${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
}

function eq<T>(name: string, actual: T, expected: T): void {
  check(name, actual === expected, { actual, expected });
}

/* ── Filtre d'URL ─────────────────────────────────────────────────── */

check("https tenor accepté", isAllowedGifUrl("https://media.tenor.com/abc/gif.gif"));
check("https giphy accepté", isAllowedGifUrl("https://media.giphy.com/media/x/giphy.gif"));
check("sous-domaine accepté", isAllowedGifUrl("https://media1.tenor.com/abc.gif"));
check("http refusé", !isAllowedGifUrl("http://media.tenor.com/abc.gif"));
check("javascript: refusé", !isAllowedGifUrl("javascript:alert(1)"));
check(
  "data: refusé",
  !isAllowedGifUrl("data:image/gif;base64,R0lGODlhAQABAAAAACw="),
);
check("domaine inconnu refusé", !isAllowedGifUrl("https://exemple.test/gif.gif"));
check(
  "suffixe trompeur refusé",
  !isAllowedGifUrl("https://media.tenor.com.exemple.test/gif.gif"),
);
check("chaîne vide refusée", !isAllowedGifUrl(""));
check("valeur non textuelle refusée", !isAllowedGifUrl({ url: "https://media.tenor.com/a.gif" }));

/* ── Nettoyage de la recherche ────────────────────────────────────── */

eq("la recherche est nettoyée", parseGifQuery("  chat   qui\ntape ").query, "chat qui tape");
eq("une recherche vide reste permise (GIF du moment)", parseGifQuery("   ").query, "");
eq("les caractères de contrôle sont retirés", parseGifQuery("a\u0000b\u001fc").query, "a b c");
eq(
  "une recherche trop longue est refusée",
  parseGifQuery("x".repeat(GIF_QUERY_MAX + 1)).error !== undefined,
  true,
);
eq(
  "une recherche à la limite passe",
  parseGifQuery("x".repeat(GIF_QUERY_MAX)).query.length,
  GIF_QUERY_MAX,
);

/* ── Mappage Tenor ────────────────────────────────────────────────── */

const tenorPayload = {
  results: [
    {
      id: "1",
      content_description: "un chat qui tape",
      media_formats: {
        gif: { url: "https://media.tenor.com/a/full.gif", dims: [320, 240] },
        tinygif: { url: "https://media.tenor.com/a/tiny.gif" },
      },
    },
    {
      id: "2",
      content_description: "",
      media_formats: {
        gif: { url: "https://media.tenor.com/b/full.gif", dims: [200, 300] },
        tinygif: { url: "https://media.tenor.com/b/tiny.gif" },
      },
    },
    {
      id: "3",
      content_description: "lien hostile",
      media_formats: {
        gif: { url: "javascript:alert(1)", dims: [1, 1] },
        tinygif: { url: "https://media.tenor.com/c/tiny.gif" },
      },
    },
  ],
};

const tenor = mapTenor(tenorPayload);
eq("Tenor : les GIF sûrs sont gardés", tenor.length, 2);
eq("Tenor : description reprise en alt", tenor[0]?.alt, "un chat qui tape");
eq("Tenor : dimensions numériques", tenor[0]?.height, 240);
eq("Tenor : preview vient de tinygif", tenor[0]?.preview, "https://media.tenor.com/a/tiny.gif");
eq("Tenor : alt de repli", tenor[1]?.alt, "GIF");
eq("Tenor : forme inattendue → liste vide", mapTenor({ results: "non" }).length, 0);
eq("Tenor : payload nul → liste vide", mapTenor(null).length, 0);

/* ── Mappage Giphy ────────────────────────────────────────────────── */

const giphy = mapGiphy({
  data: [
    {
      id: "g1",
      title: "Happy dance",
      images: {
        fixed_height: { url: "https://media.giphy.com/media/g1/200.gif", width: "200", height: "150" },
        fixed_height_small: { url: "https://media.giphy.com/media/g1/100.gif" },
      },
    },
    {
      id: "g2",
      title: "http refusé",
      images: {
        fixed_height: { url: "http://media.giphy.com/media/g2/200.gif", width: "200", height: "150" },
        fixed_height_small: { url: "https://media.giphy.com/media/g2/100.gif" },
      },
    },
  ],
});
eq("Giphy : le lien http est écarté", giphy.length, 1);
eq("Giphy : titre repris en alt", giphy[0]?.alt, "Happy dance");
eq("Giphy : dimensions converties", giphy[0]?.width, 200);
eq("Giphy : payload nul → liste vide", mapGiphy(undefined).length, 0);

/* ── URLs de requête : la clé ne fuit pas dans le résultat ────────── */

const tenorUrl = new URL(tenorSearchUrl("chat", "SECRET"));
eq("Tenor : recherche sur l'endpoint search", tenorUrl.pathname.endsWith("/search"), true);
eq("Tenor : la clé est dans la requête serveur", tenorUrl.searchParams.get("key"), "SECRET");
eq("Tenor : q est encodé", tenorUrl.searchParams.get("q"), "chat");
eq("Tenor : filtre de contenu élevé", tenorUrl.searchParams.get("contentfilter"), "high");
eq(
  "Tenor : recherche vide → GIF du moment",
  new URL(tenorSearchUrl("", "SECRET")).pathname.endsWith("/featured"),
  true,
);

const giphyUrl = new URL(giphySearchUrl("chat", "SECRET"));
eq("Giphy : endpoint search", giphyUrl.pathname.endsWith("/gifs/search"), true);
eq("Giphy : notation pg-13", giphyUrl.searchParams.get("rating"), "pg-13");
eq(
  "Giphy : recherche vide → tendances",
  new URL(giphySearchUrl("", "SECRET")).pathname.endsWith("/gifs/trending"),
  true,
);

const mapped = JSON.stringify(mapTenor(tenorPayload));
check("la clé n'apparaît jamais dans les GIF mappés", !mapped.includes("SECRET"));


/* ── Pièces jointes de message : mêmes règles, autre surface ──────── */

check(
  "message : un texte suffit",
  canSendMessage("bonjour"),
);
check(
  "message : un GIF sûr suffit sans texte",
  canSendMessage("", {
    kind: "gif",
    gif: {
      id: "1",
      url: "https://media.tenor.com/a.gif",
      preview: "https://media.tenor.com/a-tiny.gif",
      alt: "chat",
      width: 10,
      height: 10,
    },
  }),
);
check(
  "message : un GIF non sûr ne suffit pas",
  !canSendMessage("", {
    kind: "gif",
    gif: {
      id: "1",
      url: "javascript:alert(1)",
      preview: "https://media.tenor.com/a-tiny.gif",
      alt: "chat",
      width: 10,
      height: 10,
    },
  }),
);
check("message : un sticker uuid suffit", canSendMessage("", {
  kind: "sticker",
  stickerId: "3f1c2a44-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
}));
check("message : un identifiant de sticker invalide est refusé", !canSendMessage("", {
  kind: "sticker",
  stickerId: "pas-un-uuid",
}));
eq(
  "message : les colonnes d'un GIF filtré restent vides",
  attachmentColumns({
    kind: "gif",
    gif: {
      id: "1",
      url: "http://media.tenor.com/a.gif",
      preview: "https://media.tenor.com/a-tiny.gif",
      alt: "chat",
      width: 10,
      height: 10,
    },
  }).gif_url,
  "",
);
eq(
  "message : l'alt est borné à 300 caractères",
  attachmentColumns({
    kind: "gif",
    gif: {
      id: "1",
      url: "https://media.tenor.com/a.gif",
      preview: "https://media.tenor.com/a-tiny.gif",
      alt: "x".repeat(400),
      width: 10,
      height: 10,
    },
  }).gif_alt.length,
  300,
);
eq(
  "message : sans pièce jointe, toutes les colonnes sont vides",
  JSON.stringify(attachmentColumns()),
  JSON.stringify({ gif_url: "", gif_alt: "", sticker_id: null, media_url: "", media_type: "" }),
);

console.log(`\n${passed} vérification(s) passée(s), ${failures.length} échec(s)\n`);
if (failures.length) {
  for (const failure of failures) console.log(`  ✗ ${failure}`);
  process.exit(1);
}
console.log("  ✓ La recherche de GIF est filtrée et la clé reste côté serveur\n");
