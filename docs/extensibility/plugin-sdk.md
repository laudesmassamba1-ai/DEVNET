# SDK de plugins — guide minimal (Phase 2)

Ce document décrit ce qui existe **réellement** aujourd'hui. Les slots, les
événements réels, le stockage clé-valeur et le client HTTP restreint arrivent
aux phases suivantes ; leurs types sont déjà dans le SDK mais le runtime ne les
distribue pas encore.

## Créer un plugin

```
plugins/
  mon-plugin/
    plugin.json
    server.ts
    README.md
```

`plugin.json` minimal :

```json
{
  "id": "mon-plugin",
  "name": "Mon plugin",
  "version": "1.0.0",
  "devnetApi": "^1.0.0",
  "level": 2,
  "requires": [],
  "conflicts": [],
  "capabilities": [],
  "network": { "outbound": [] },
  "entry": { "server": "server.ts" },
  "i18n": ["fr"],
  "dataCategories": []
}
```

Le nom du dossier **doit** égaler `id`. Le manifeste est strict : un champ
inconnu, une capacité inventée, un hôte avec protocole ou une version non
SemVer font échouer `npm run plugins:validate`.

`server.ts` :

```ts
import { definePlugin } from "@devnet/plugin-sdk";

export default definePlugin((api) => {
  api.onActivate((ctx) => ctx.log.info("activé"));
  api.onDeactivate((ctx) => ctx.log.info("désactivé"));
});
```

## Capacités

Une capacité se demande dans `capabilities`, puis doit être **accordée** dans
`plugin_state.granted_capabilities`. Sans octroi, l'abonnement n'est jamais
distribué. Le manifeste reste la limite haute : une capacité accordée mais non
demandée ne sert à rien.

Formes acceptées aujourd'hui :

- `events:subscribe:<événement>@<version>` — événements du catalogue ;
- `ui:slot:<emplacement>` — un emplacement ouvert par le cœur ;
- `store:kv`, `notifier:channel`, `content:filter`, `ranking:signal` ;
- `api:route:<chemin>` et `jobs:task:<nom>` ;
- `read:profile.public`, `read:posts.public`, `write:notifications`.

Interdits par conception : messages privés, sessions, secrets du cœur, journal
d'audit, SQL brut, migrations du cœur.

## Registre et activation

```bash
npm run plugins:gen       # écrit platform/registry.generated.ts
npm run plugins:validate  # échoue si le registre ou un manifeste est invalide
```

Le registre ne contient que des imports statiques : aucun `eval`, aucun
`import()` construit, aucun code distant. L'activation vit dans
`public.plugin_state` :

```sql
insert into public.plugin_state (plugin_id, enabled, version, granted_capabilities)
values ('mon-plugin', true, '1.0.0', '{}')
on conflict (plugin_id) do update set enabled = excluded.enabled;
```

Aucun redéploiement n'est nécessaire pour activer, couper ou mettre en
quarantaine. En revanche, **ajouter** un plugin au dépôt demande une
construction et un déploiement.

## Garanties vérifiées

- manifeste invalide, cycle de dépendances ou registre périmé → CI rouge ;
- plugin désactivé, API incompatible, dépendance manquante ou conflit → non
  chargé, avec une raison ;
- interrupteur global → le cœur démarre sans aucun plugin ;
- hook en échec → compté, santé `degraded`, le cœur continue ;
- un plugin n'importe que `@devnet/plugin-sdk` (test de frontières).

## S'abonner à un événement

```ts
import { definePlugin } from "@devnet/plugin-sdk";

export default definePlugin((api) => {
  api.onEvent("proof.verified@1", async (event, context) => {
    context.log.info(`preuve ${event.subject.proofId}`);
    // Le gestionnaire peut être rappelé : rendre l'effet idempotent.
  });
});
```

Le manifeste doit demander la capacité correspondante **et** l'état doit
l'accorder :

```json
"capabilities": ["events:subscribe:proof.verified@1"]
```

Le contrat des enveloppes, les reprises et l'exploitation sont décrits dans
[`events.md`](./events.md).
