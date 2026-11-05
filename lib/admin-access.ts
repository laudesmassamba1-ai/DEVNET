import { getSupabaseUrl, isDemoAllowed } from "@/lib/backend";

/**
 * Peut-on vérifier le rôle d'administration **côté serveur** ?
 *
 * Non dans deux cas, et il faut les nommer séparément :
 *
 *  1. **Aucun backend n'est configuré.** `getOrCreateServerClient()` rend
 *     `null` : il n'y a pas de session serveur à lire, donc pas de rôle à
 *     vérifier.
 *  2. **La démonstration est forcée.** Le backend peut exister, mais la
 *     session de démonstration vit dans `localStorage`, que le serveur ne
 *     voit jamais : il n'y a toujours aucune session à lire.
 *
 * Dans ces deux cas, refuser en 404 ne protège rien — il n'y a rien à
 * protéger côté serveur — et rend `/admin` inaccessible **même à un compte
 * administrateur**, ce qui était le défaut constaté. L'accès est alors
 * décidé par `AdminGate`, côté client, sur le profil réellement chargé.
 *
 * Dès qu'un backend réel existe sans démonstration forcée, cette fonction
 * rend `false` : les gardes serveur du proxy et du layout reprennent la
 * main, et le client ne fait que confirmer.
 */
export function serverCannotCheckAdmin(): boolean {
  if (!getSupabaseUrl()) return true;
  return process.env.NEXT_PUBLIC_FORCE_DEMO === "true" && isDemoAllowed();
}
