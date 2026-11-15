/**
 * Paramètres d'une demande d'hydratation, validés avant la base.
 *
 * Le client envoie les identifiants qu'il affiche ; la route ne doit accepter
 * ni doublon, ni valeur qui n'est pas un identifiant, ni liste sans fin. Une
 * demande vide ou entièrement invalide rend une liste vide : la réponse est
 * alors l'état neutre, pas une erreur.
 */
import { MAX_HYDRATION_POSTS } from "../ports/feed-hydration-repository";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readHydrationQuery(params: URLSearchParams): string[] {
  const raw = params.get("ids") ?? "";
  const seen = new Set<string>();

  for (const part of raw.split(",")) {
    const id = part.trim().toLowerCase();
    if (!UUID.test(id)) continue;
    seen.add(id);
    if (seen.size >= MAX_HYDRATION_POSTS) break;
  }

  return [...seen];
}
