/**
 * Adaptateur HTTP du fil.
 *
 * Le navigateur ne parle plus à Supabase pour lire le fil : il demande
 * `/api/feed`, et c'est le processus Next.js qui ouvre la connexion
 * PostgreSQL. La session continue de voyager en cookie (`same-origin`), donc
 * la route retrouve l'identité et la RLS reste la seule juge du lisible.
 *
 * L'écriture (le « J'aime ») n'est pas exposée par cette route : les deux
 * méthodes de la portée écriture échouent explicitement plutôt que de
 * prétendre avoir enregistré quelque chose. Le conteneur compose un second
 * service pour ce sens-là.
 */
import type { FeedPage, FeedPageRequest, FeedRepository } from "../../ports/feed-repository";
import { FeedRepositoryError } from "../../ports/feed-repository";

export interface HttpFeedDependencies {
  /** Origine de l'application ; vide = même origine que la page. */
  baseUrl?: string;
  /** Injectable pour les tests : aucun serveur n'est alors nécessaire. */
  fetchImpl?: typeof fetch;
}

export class HttpFeedRepository implements FeedRepository {
  constructor(private readonly dependencies: HttpFeedDependencies = {}) {}

  async fetchPage(request: FeedPageRequest): Promise<FeedPage> {
    const parameters = new URLSearchParams({
      scope: request.scope,
      pageSize: String(request.pageSize),
    });
    // Un curseur vide n'est pas un curseur : `before=` ferait comparer à une
    // date vide et la lecture échouerait côté base.
    if (request.before) parameters.set("before", request.before);

    const base = this.dependencies.baseUrl ?? "";
    const send = this.dependencies.fetchImpl ?? fetch;

    let response: Response;
    try {
      response = await send(`${base}/api/feed?${parameters.toString()}`, {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
        credentials: "same-origin",
      });
    } catch (error) {
      throw new FeedRepositoryError("list-feed", "network", { cause: error });
    }

    if (!response.ok) {
      throw new FeedRepositoryError("list-feed", `http-${response.status}`);
    }

    return (await response.json()) as FeedPage;
  }

  async addLike(_postId: string, _userId: string): Promise<"created" | "already-exists"> {
    throw new FeedRepositoryError("add-like", "read-only-adapter");
  }

  async removeLike(_postId: string, _userId: string): Promise<void> {
    throw new FeedRepositoryError("remove-like", "read-only-adapter");
  }
}
