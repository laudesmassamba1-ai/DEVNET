/**
 * Route `/api/feed` — validation des paramètres et adaptateur HTTP.
 *
 * Ce qui est vérifié ici est la partie où les bugs arrivent vraiment : les
 * bornes, l'encodage du curseur, et le refus d'un adaptateur de lecture qui
 * prétendrait enregistrer un « J'aime ».
 *
 * La route elle-même (identité, RLS, statut 503) se vérifie sur un serveur
 * lancé : `npm run dev` puis `curl localhost:3000/api/feed`.
 */
import assert from "node:assert/strict";
import { MAX_HYDRATION_POSTS, readFeedQuery, readHydrationQuery } from "../modules/feed";
import { HttpFeedRepository } from "../modules/feed/infrastructure/http/http-feed-repository";
import { FeedRepositoryError } from "../modules/feed/ports/feed-repository";

function verifyQueryParsing(): void {
  assert.deepEqual(readFeedQuery(new URLSearchParams()), {
    scope: "all",
    pageSize: 12,
    before: null,
  });
  assert.equal(readFeedQuery(new URLSearchParams("scope=followed")).scope, "followed");
  assert.equal(readFeedQuery(new URLSearchParams("scope=n-importe-quoi")).scope, "all");
  assert.equal(readFeedQuery(new URLSearchParams("pageSize=9999")).pageSize, 30);
  assert.equal(readFeedQuery(new URLSearchParams("pageSize=0")).pageSize, 12);
  assert.equal(readFeedQuery(new URLSearchParams("pageSize=abc")).pageSize, 12);
  assert.equal(readFeedQuery(new URLSearchParams("pageSize=3.7")).pageSize, 3);
  assert.equal(
    readFeedQuery(new URLSearchParams("before=2026-11-08T10%3A00%3A00Z")).before,
    "2026-11-08T10:00:00Z",
  );
  assert.equal(readFeedQuery(new URLSearchParams("before=%20")).before, null);
}

/**
 * L'hydratation accepte ce que l'écran affiche, et rien d'autre : un
 * identifiant valide une fois, un plafond, aucune valeur inventée.
 */
function verifyHydrationQueryParsing(): void {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

  assert.deepEqual(readHydrationQuery(new URLSearchParams()), []);
  assert.deepEqual(readHydrationQuery(new URLSearchParams(`ids=${id(1)},${id(1)}`)), [id(1)]);
  assert.deepEqual(
    readHydrationQuery(new URLSearchParams(`ids=pas-un-identifiant,${id(2)}`)),
    [id(2)],
  );
  assert.deepEqual(readHydrationQuery(new URLSearchParams(`ids=${id(3).toUpperCase()}`)), [id(3)]);

  const many = Array.from({ length: 100 }, (_, index) => id(index + 10)).join(",");
  assert.equal(
    readHydrationQuery(new URLSearchParams(`ids=${many}`)).length,
    MAX_HYDRATION_POSTS,
  );
}

async function verifyHttpAdapter(): Promise<void> {
  const calls: { url: string; init?: RequestInit }[] = [];
  const page = { rows: [], more: false, emptyScope: false };

  const repository = new HttpFeedRepository({
    baseUrl: "https://devnet.test",
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify(page), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  });

  const read = await repository.fetchPage({
    scope: "followed",
    readerId: "u-1",
    before: "2026-11-08T10:00:00Z",
    pageSize: 5,
  });

  assert.deepEqual(read, page);
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/api/feed");
  assert.equal(url.searchParams.get("scope"), "followed");
  assert.equal(url.searchParams.get("pageSize"), "5");
  assert.equal(url.searchParams.get("before"), "2026-11-08T10:00:00Z");
  assert.equal(calls[0].init?.cache, "no-store");
  // Le cookie de session doit partir : sans lui, la route ne connaît personne.
  assert.equal(calls[0].init?.credentials, "same-origin");

  // Sans curseur, aucun `before` n'est envoyé.
  await repository.fetchPage({ scope: "all", readerId: null, before: null, pageSize: 12 });
  assert.equal(new URL(calls[1].url).searchParams.has("before"), false);

  // Un refus serveur devient une erreur de port, pas une page vide.
  const failing = new HttpFeedRepository({
    fetchImpl: (async () => new Response("{}", { status: 503 })) as typeof fetch,
  });
  await assert.rejects(
    () => failing.fetchPage({ scope: "all", readerId: null, before: null, pageSize: 12 }),
    (error: unknown) =>
      error instanceof FeedRepositoryError && error.code === "http-503",
  );

  // Panne réseau : même contrat, code distinct.
  const offline = new HttpFeedRepository({
    fetchImpl: (async () => {
      throw new Error("offline");
    }) as typeof fetch,
  });
  await assert.rejects(
    () => offline.fetchPage({ scope: "all", readerId: null, before: null, pageSize: 12 }),
    (error: unknown) => error instanceof FeedRepositoryError && error.code === "network",
  );

  // Lecture seule : l'écriture est refusée explicitement, jamais simulée.
  await assert.rejects(
    () => repository.addLike("p-1", "u-1"),
    (error: unknown) =>
      error instanceof FeedRepositoryError && error.code === "read-only-adapter",
  );
  await assert.rejects(
    () => repository.removeLike("p-1", "u-1"),
    (error: unknown) =>
      error instanceof FeedRepositoryError && error.code === "read-only-adapter",
  );
}

async function main(): Promise<void> {
  verifyQueryParsing();
  verifyHydrationQueryParsing();
  await verifyHttpAdapter();
  console.log("Route /api/feed : paramètres, adaptateur HTTP et hydratation vérifiés.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
