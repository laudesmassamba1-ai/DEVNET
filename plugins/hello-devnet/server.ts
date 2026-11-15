import { definePlugin } from "@devnet/plugin-sdk";

/**
 * Plugin de référence minimal : il ne demande aucune capacité et ne lit
 * aucune donnée. Il sert à prouver le cycle de vie (chargement, activation,
 * désactivation) sans élargir la surface d'attaque.
 */
export default definePlugin((api) => {
  api.onActivate((context) => {
    context.log.info("activé");
  });

  api.onDeactivate((context) => {
    context.log.info("désactivé");
  });
});
