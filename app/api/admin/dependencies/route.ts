import { NextResponse } from "next/server";
import { ADMIN_NO_STORE, requireAdmin } from "@/lib/admin-server";
import { getFailoverState } from "@/platform/infrastructure/postgres/failover";
import { hasDatabaseUrl } from "@/platform/infrastructure/postgres/pool";
import { REGISTERED_PLUGINS } from "@/platform/registry.generated";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Dépendances — le registre des ports et des adaptateurs réellement actifs.
 *
 * Le module annonçait « aucun registre des ports et adaptateurs actifs n'est
 * exposé ». C'était exact, et c'est un angle mort qui compte : le dépôt
 * contient plusieurs implémentations du même port (Postgres, REST, mémoire),
 * et **rien dans l'application ne disait laquelle tourne**. Le 14 novembre,
 * la base est tombée et le fil a répondu un tableau vide : sans ce registre,
 * impossible de distinguer « pas de contenu » de « mauvais adaptateur ».
 *
 * Ce que cette route fait, et ce qu'elle refuse de faire :
 *
 *  - elle **décrit** les adaptateurs présents dans le dépôt et celui qui est
 *    choisi à l'exécution, avec la raison du choix ;
 *  - elle signale les implémentations **orphelines** — présentes mais jamais
 *    instanciées — parce qu'un adaptateur mort est une fausse promesse ;
 *  - elle ne teste **aucune** connexion externe : un registre qui sonde
 *    Google ou GitHub à chaque ouverture serait lent et mentirait en cas de
 *    panne réseau. Elle rapporte la configuration, pas la disponibilité.
 *
 * Aucune valeur de secret ne sort : seulement « configuré » ou « absent ».
 */

type Adapter = {
  module: string;
  port: string;
  implementations: { name: string; kind: "postgres" | "rest" | "memory" | "http" | "image" | "media" | "oauth"; active: boolean }[];
  selected: string | null;
  note: string;
};

const configured = (value: string | undefined): boolean => Boolean(value?.trim());

/**
 * Carte des ports et adaptateurs, écrite à la main parce qu'elle décrit une
 * décision d'architecture, pas un état mesurable. Chaque entrée a été
 * vérifiée dans le code : `platform/container.ts` et
 * `platform/server-container.ts` sont les deux seuls points de composition.
 */
function adapterRegistry(): Adapter[] {
  const demo = process.env.NEXT_PUBLIC_FORCE_DEMO === "true";
  const db = hasDatabaseUrl();

  return [
    {
      module: "feed",
      port: "FeedRepository",
      implementations: [
        { name: "PostgresFeedRepository", kind: "postgres", active: db && !demo },
        { name: "HttpFeedRepository", kind: "http", active: !demo },
        { name: "RestFeedRepository", kind: "rest", active: !demo },
        { name: "MemoryFeedRepository", kind: "memory", active: demo },
      ],
      selected: demo
        ? "MemoryFeedRepository"
        : db
          ? "PostgresFeedRepository (serveur) / HttpFeedRepository (client)"
          : "HttpFeedRepository",
      note: demo
        ? "Mode démonstration forcé : le fil lit des données en mémoire."
        : "Le serveur lit PostgreSQL ; le navigateur passe par la route HTTP.",
    },
    {
      module: "stories",
      port: "StoriesRepository",
      implementations: [{ name: "PostgresStoriesRepository", kind: "postgres", active: db }],
      selected: db ? "PostgresStoriesRepository" : null,
      note: db
        ? "Un seul adaptateur : les stories n'ont pas de repli mémoire."
        : "Aucune base configurée : les stories sont indisponibles.",
    },
    {
      module: "stickers",
      port: "StickersRepository",
      implementations: [{ name: "PostgresStickersRepository", kind: "postgres", active: db }],
      selected: db ? "PostgresStickersRepository" : null,
      note: db ? "Lecture et écriture directes en base." : "Aucune base configurée.",
    },
    {
      module: "auth",
      port: "AuthRepository",
      implementations: [{ name: "PostgresAuthRepository", kind: "postgres", active: db }],
      selected: db ? "PostgresAuthRepository" : null,
      note: db
        ? "Sessions et identifiants en base ; OAuth délégué aux fournisseurs."
        : "Aucune base configurée : la connexion est impossible.",
    },
    {
      module: "events",
      port: "EventOutboxRepository",
      implementations: [
        { name: "PostgresEventOutboxRepository", kind: "postgres", active: db },
        { name: "MemoryPluginStateRepository", kind: "memory", active: !db },
      ],
      selected: db ? "PostgresEventOutboxRepository" : "MemoryPluginStateRepository",
      note: db
        ? "Boîte d'envoi persistée : un événement survit à un redémarrage."
        : "Boîte d'envoi en mémoire : les événements sont perdus au redémarrage.",
    },
    {
      module: "moderation",
      port: "ReportRepository",
      implementations: [{ name: "RestReportRepository", kind: "rest", active: true }],
      selected: "RestReportRepository",
      note: "Passe par la couche REST interne, pas directement par PostgreSQL.",
    },
    {
      module: "messages",
      port: "MessageExtrasRepository",
      implementations: [{ name: "RestMessageExtrasRepository", kind: "rest", active: true }],
      selected: "RestMessageExtrasRepository",
      note: "Passe par la couche REST interne.",
    },
  ];
}

/** Services externes : configuration seulement, jamais de sonde réseau. */
function externalServices(): { name: string; configured: boolean; role: string }[] {
  return [
    {
      name: "PostgreSQL (primaire)",
      configured: hasDatabaseUrl(),
      role: "Toutes les données applicatives",
    },
    {
      name: "PostgreSQL (secours)",
      configured: configured(process.env.DATABASE_URL_STANDBY),
      role: "Reprise automatique si la primaire tombe",
    },
    {
      name: "Cloudflare R2",
      configured:
        configured(process.env.R2_ENDPOINT) &&
        configured(process.env.R2_ACCESS_KEY_ID) &&
        configured(process.env.R2_SECRET_ACCESS_KEY) &&
        configured(process.env.R2_BUCKET),
      role: "Médias et sauvegardes chiffrées hors site",
    },
    {
      name: "Vercel Blob",
      configured: configured(process.env.BLOB_READ_WRITE_TOKEN),
      role: "Médias de secours",
    },
    {
      name: "Connexion Google",
      configured:
        configured(process.env.GOOGLE_CLIENT_ID) &&
        configured(process.env.GOOGLE_CLIENT_SECRET) &&
        configured(process.env.AUTH_OAUTH_SECRET),
      role: "Authentification OAuth",
    },
    {
      name: "Connexion GitHub",
      configured:
        configured(process.env.GITHUB_LOGIN_CLIENT_ID) &&
        configured(process.env.GITHUB_LOGIN_CLIENT_SECRET) &&
        configured(process.env.AUTH_OAUTH_SECRET),
      role: "Authentification OAuth",
    },
    {
      name: "Dépôts GitHub",
      configured:
        configured(process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID) &&
        configured(process.env.GITHUB_CLIENT_SECRET) &&
        configured(process.env.GITHUB_CRYPT_KEY),
      role: "Lecture des dépôts d'un profil",
    },
    {
      name: "GIF (Tenor)",
      configured: configured(process.env.TENOR_API_KEY),
      role: "Recherche de GIF",
    },
    {
      name: "GIF (Giphy)",
      configured: configured(process.env.GIPHY_API_KEY),
      role: "Recherche de GIF (repli)",
    },
    {
      name: "Courriel (Resend)",
      configured: configured(process.env.RESEND_API_KEY),
      role: "Mot de passe oublié",
    },
  ];
}

export async function GET(): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json(
      { error: admin.error },
      { status: admin.status, headers: ADMIN_NO_STORE },
    );
  }

  const adapters = adapterRegistry();
  const failover = getFailoverState();

  /*
   * Un adaptateur est « orphelin » quand il existe dans le dépôt mais n'est
   * choisi dans aucune configuration. C'est un signal d'architecture : soit
   * du code mort, soit une bascule prévue mais jamais câblée.
   */
  const orphans = adapters.flatMap((adapter) =>
    adapter.implementations
      .filter((implementation) => !implementation.active && !adapter.selected?.includes(implementation.name))
      .map((implementation) => ({
        module: adapter.module,
        name: implementation.name,
        why: "présent dans le dépôt, jamais instancié dans cette configuration",
      })),
  );

  return NextResponse.json(
    {
      checkedAt: new Date().toISOString(),
      environment: {
        demo: process.env.NEXT_PUBLIC_FORCE_DEMO === "true",
        region: process.env.VERCEL_REGION ?? null,
        vercelEnv: process.env.VERCEL_ENV ?? null,
        activeDatabase: failover.active,
      },
      adapters,
      orphans,
      plugins: REGISTERED_PLUGINS.map((plugin) => ({
        id: plugin.manifest.id,
        name: plugin.manifest.name,
        version: plugin.manifest.version,
      })),
      services: externalServices(),
    },
    { headers: ADMIN_NO_STORE },
  );
}
