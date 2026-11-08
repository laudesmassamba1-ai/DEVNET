/**
 * Transport des connexions PostgreSQL directes.
 *
 * Pourquoi ce fichier existe : `pg-connection-string` 2.14 traite
 * `sslmode=require` comme `verify-full`. Avec le certificat auto-signé de
 * Systalink, `new Pool({ connectionString })` échoue donc en
 * `SELF_SIGNED_CERT_IN_CHAIN` — alors que `psql`, qui suit libpq, se connecte
 * sans problème. On retire `sslmode` de l'URL et on fixe le niveau ici :
 *
 *  - `disable` n'est accepté que vers un hôte **local** ; vers un hôte
 *    distant, le mot de passe circulerait en clair : on refuse ;
 *  - `prefer` et `allow` sont promus en `require` : jamais de repli en clair ;
 *  - `require` chiffre sans vérifier le certificat (état actuel de Systalink) ;
 *  - `verify-ca` et `verify-full` vérifient la chaîne, avec le certificat
 *    d'autorité fourni par `DATABASE_CA_CERT` (contenu PEM ou chemin d'un
 *    fichier). Sans CA, la vérification reste stricte : la connexion échoue
 *    plutôt que de dégrader le transport en silence.
 */
import { readFileSync } from "node:fs";

export type PostgresTlsMode = "disable" | "require" | "verify-full";

export interface PostgresConnectionConfig {
  /** URL sans `sslmode` : le niveau TLS est porté par `ssl`. */
  connectionString: string;
  ssl: false | { rejectUnauthorized: boolean; ca?: string };
  mode: PostgresTlsMode;
  /** `false` : chiffré, mais l'identité du serveur n'est pas prouvée. */
  verified: boolean;
}

/** Hôtes de développement où l'absence de TLS est sans conséquence. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "db"]);

function caCertificate(): string | undefined {
  const value = process.env.DATABASE_CA_CERT?.trim();
  if (!value) return undefined;
  return value.includes("-----BEGIN CERTIFICATE-----") ? value : readFileSync(value, "utf8");
}

export function resolvePostgresConnection(databaseUrl: string): PostgresConnectionConfig {
  const url = new URL(databaseUrl);
  const requested = (url.searchParams.get("sslmode") ?? "").toLowerCase();
  const local = LOCAL_HOSTS.has(url.hostname);

  url.searchParams.delete("sslmode");
  url.searchParams.delete("uselibpqcompat");
  const connectionString = url.toString();

  let mode: PostgresTlsMode;
  if (requested === "disable") {
    if (!local) {
      throw new Error(
        "sslmode=disable refusé vers un hôte distant : le mot de passe et les données circuleraient en clair.",
      );
    }
    mode = "disable";
  } else if (requested === "verify-ca" || requested === "verify-full") {
    mode = "verify-full";
  } else if (requested === "" || requested === "prefer" || requested === "allow") {
    mode = local ? "disable" : "require";
  } else {
    mode = "require";
  }

  if (mode === "disable") return { connectionString, ssl: false, mode, verified: false };
  if (mode === "require") {
    return { connectionString, ssl: { rejectUnauthorized: false }, mode, verified: false };
  }

  const ca = caCertificate();
  return {
    connectionString,
    ssl: ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: true },
    mode,
    verified: true,
  };
}
