/**
 * « La base ne répond pas » — ou « la requête est trop lente » ?
 *
 * ## Pourquoi ce fichier est ici et pas dans `platform/`
 *
 * La classification est une **règle de lecture**, pas un détail de
 * l'adaptateur : le fil et les stories en ont besoin pour décider si une
 * erreur mérite une bascule ou doit rester une erreur de requête. La placer
 * dans `platform/infrastructure/postgres/failover.ts` obligeait ces modules
 * à importer un adaptateur, ce que la frontière d'architecture interdit
 * (`npm run test:boundaries`). Le classifieur vit donc dans `shared/`, que
 * les modules et la plateforme peuvent lire, et `failover.ts` le réexporte
 * pour ne rien casser.
 *
 * ## Pourquoi le code SQL ne suffit pas
 *
 * Le 14 novembre, Systalink acceptait la connexion TCP puis ne répondait
 * plus jamais. `pg` expire alors dans la file d'attente du pool et lève une
 * erreur **sans code**, avec pour seul message « timeout exceeded when
 * trying to connect ». Une classification qui ne lit que `code` ne déclenche
 * pas la bascule — et l'application reste bloquée sur une base morte.
 *
 * Les phrases sont volontairement précises : `statement timeout` (57014) est
 * une requête trop lente, pas une base absente, et doit rester une erreur de
 * requête.
 */

/** Codes et messages qui signifient « la base ne répond pas ». */
export function isConnectionFailure(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  if (code) {
    return (
      ["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EHOSTUNREACH", "EPIPE", "ECONNRESET"].includes(code)
      || ["08001", "08004", "08006", "08P01", "57P01", "57P02", "57P03", "53300"].includes(code)
    );
  }
  const message = error instanceof Error ? error.message : "";
  return /timeout exceeded when trying to connect|Connection terminated|connection is closed|Client has encountered a connection error|database_timeout|probe_timeout|ECONNREFUSED|ETIMEDOUT/i.test(
    message,
  );
}
