/**
 * FICHIER GÉNÉRÉ — ne pas modifier à la main.
 * Source de vérité : plugins/<id>/plugin.json
 * Régénérer : npm run plugins:gen
 */
import type { PluginDefinition, PluginManifest } from "@devnet/plugin-sdk";

import plugin0 from "@/plugins/hello-devnet/server";

export interface RegisteredPlugin {
  readonly manifest: PluginManifest;
  readonly definition: PluginDefinition;
}

export const REGISTERED_PLUGINS: readonly RegisteredPlugin[] = [
  {
    manifest: {
      "id": "hello-devnet",
      "name": "Bonjour DevNet",
      "version": "1.0.0",
      "devnetApi": "^1.0.0",
      "level": 2,
      "requires": [],
      "conflicts": [],
      "capabilities": [],
      "network": {
        "outbound": []
      },
      "entry": {
        "server": "server.ts"
      },
      "i18n": [
        "fr"
      ],
      "dataCategories": []
    },
    definition: plugin0,
  },
];
