/**
 * Route `/api/feed` — validation des paramètres.
 *
 * Ce qui est vérifié ici est la partie où les bugs arrivent vraiment : les
 * bornes. Un `pageSize` absurde venu d'un client ne doit jamais atteindre la
 * base, et un curseur vide ne doit pas être transmis comme une date.
 *
 * La route elle-même (identité, RLS, statut 503) se vérifie sur un serveur
 * lancé : `npm run dev` puis `curl localhost:3000/api/feed`.
 */
import assert from "node:assert/strict";
import { readFeedQuery } from "../modules/feed";

function main(): void {
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

  console.log("Route /api/feed : 9 vérifications réussies.");
}

main();
