/**
 * La poussée DevNet → GitHub, côté navigateur.
 *
 * On ne construit ici que l'appel : le dépôt local est lu par `lib/repo`
 * (`fetchRepoFiles` et la tête de branche), le suffixe part à
 * `/api/github/sync`, et la réponse est l'outcome fermé de
 * `lib/github/sync`. Aucun état DevNet n'est modifié par cette fonction —
 * c'est l'appelant qui décide d'enregistrer l'état synchronisé.
 */

import type { SyncOutcome, SyncPayload } from "@/lib/github/sync";

export async function pushToGithub(payload: SyncPayload): Promise<SyncOutcome> {
  try {
    const res = await fetch("/api/github/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => null)) as SyncOutcome | null;
    if (!body || typeof body !== "object" || !("status" in body)) {
      return { status: "error", code: "api" };
    }
    return body;
  } catch {
    return { status: "error", code: "api" };
  }
}
