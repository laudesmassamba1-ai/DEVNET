# ADR 0010 — Modèle d’extensibilité

- **Date** : 2026-11-05
- **Statut** : **accepté** — validé par Laudes le 2026-11-05
- **Remplace / complète** : ADR 0006 (niveau 1 déjà livré, voir §2.3)
- **Base mesurée** : `docs/extensibility/inventory.md`, commit `afed373`

## 1. Contexte

Le dépôt compte **44 suites** dans `npm test` (le skill en annonce 33), toutes
vertes, `tsc`, ESLint et le build également. La place de marché `029` existe :
manifeste JSON, installation, activation, réglages, extraits et commandes pour
l’IDE. Elle n’exécute aucun code.

Trois faits contraignent la décision :

1. **La base Systalink n’est pas achetée.** On ne sait pas si `CREATE SCHEMA`
   sera accordé. Toute stratégie de stockage doit avoir un repli qui ne
   suppose que des tables dans `public`.
2. **Vercel serverless.** Pas de processus permanent : un bus en mémoire est
   exclu, et un planificateur n’est pas garanti par l’offre gratuite.
3. **Budget nul, concours, temps limité.** Un framework complet d’un coup
   échouerait ; il faut des tranches verticales vérifiables.

Le niveau 1 (cartes déclaratives `slots`, ADR 0006) est déjà livré et vérifié.
Il sert de **pont**, pas de destination : il ne doit pas rester un second
mécanisme à côté du SDK.

## 2. Décision proposée

### 2.1 Niveaux retenus

| Niveau | Décision | Portée |
|---|---|---|
| 1 — Configuration | **Retenu** | Drapeaux, paramètres, thèmes, textes ; livré pour les cartes de slot |
| 2 — Plugin de confiance | **Retenu** | Code au dépôt, manifeste, registre généré, activation sans redéploiement |
| 3 — Intégration externe | **Retenu** | Webhooks HMAC, API à jetons à portée limitée, OAuth minimal |
| 4 — Widget iframe | **Reporté** | Priorité basse ; sandbox sans `allow-same-origin` si un jour ouvert |
| 5 — Code serveur tiers | **Refusé** | Aucune exécution de code non fiable dans le processus |

### 2.2 Périmètre de la première version (Phases 2 à 4)

- SDK `shared/plugin-sdk` : `definePlugin`, schéma de manifeste, types
  d’événements, `ctx.store/http/log/settings/actor`.
- Registre **généré** avec imports statiques ; manifeste invalide ou cycle =
  build en échec. Aucun `eval`, aucun `import()` construit.
- `plugin_state` + garde de capacités (refus par défaut, vérifié à chaque
  appel, pas seulement à l’installation).
- **Cinq slots** : `profile.header.badge`, `profile.tab`,
  `post.card.action`, `settings.section`, `command.palette.command`.
- **Trois événements** : `post.created@1`, `proof.verified@1`,
  `user.registered@1`.
- Boîte d’envoi (`event_outbox`, `event_deliveries`), dispatcheur, reprises,
  file des échecs, disjoncteur.

### 2.3 Sort des slots de niveau 1 déjà livrés

`components/ExtensionSlot.tsx` et `ExtensionManifest.slots` restent en place
pendant la Phase 4. Le composant `<Slot>` du SDK lit les mêmes manifestes ;
une fois les cinq slots ouverts et testés, `ExtensionSlot` est **supprimé** et
les deux emplacements (`discover.sidebar`, `extensions.page`) passent par le
SDK. Interdiction de garder deux chemins de rendu au-delà de la Phase 4.

### 2.4 Stockage : stratégie B par défaut

**B** : tables préfixées `plg_<id>__<nom>` dans `public`, accès uniquement via
`PluginStore` (préfixe et `plugin_id` imposés), `plugin_kv` pour le clé-valeur,
quotas par plugin, secrets chiffrés (HKDF versionné), jamais renvoyés par
l’API.

**A** (schéma par plugin + rôle dédié) n’est activée **que si** Systalink
accorde la création de schémas et de rôles, vérifié sur la base réelle. Aucune
migration ne suppose A aujourd’hui.

Migrations de plugin : exécuteur suivi du cœur, colonne `module` ajoutée à
`schema_migrations` par une migration *expand* en Phase 6 ; jamais d’édition
d’une migration appliquée ; retour arrière testé.

### 2.5 Événements : outbox, pas de bus en mémoire

Le service écrit le changement **et** la ligne d’outbox dans la même
transaction. Le drainage se fait :

- dans `after()` de Next 16 (vérifié dans
  `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`),
  après la réponse ;
- et par une route de drainage protégée, appelable par un planificateur ou un
  déclenchement léger côté client si aucun planificateur n’est disponible.

Garantie **au moins une fois** ; `(event_id, plugin_id)` unique rend les
gestionnaires idempotents. **Latence réelle** : jusqu’au prochain drainage ;
elle sera mesurée et affichée dans la tour de contrôle, pas promise à zéro.
Reprises exponentielles, plafond, file des échecs, quarantaine automatique.

### 2.6 Sécurité (non négociable)

- Capacité demandée par le manifeste, **accordée** par un admin, vérifiée à
  chaque appel ; toute nouvelle capacité à la mise à jour exige une nouvelle
  approbation.
- Aucune capacité sur les messages privés, les sessions, les secrets du cœur,
  le journal d’audit, le RLS ou les migrations du cœur.
- Acteur explicite `plugin:<id>` ; écritures via les services du cœur.
- HTTP sortant limité aux hôtes déclarés, délai et taille bornés, adresses
  privées bloquées (anti-SSRF).
- Un plugin qui lève, boucle ou dépasse son budget ne fait pas tomber le cœur ;
  interrupteur global « tous les plugins hors service » testé.

## 3. Chiffrage (⚠️ estimation, pas une mesure)

| Phase | Livrable | Estimation solo |
|---|---|---|
| 2 | SDK, manifeste, registre, `plugin_state`, garde | 4–6 j |
| 3 | Outbox, dispatcheur, 3 événements | 4–6 j |
| 4 | `<Slot>` + 5 slots, retrait du pont niveau 1 | 4–5 j |
| 5 | Routes `/api/ext`, tâches, `content.filter` | 3–4 j |
| 6 | `PluginStore`, `plugin_kv`, migrations par module | 4–6 j |
| 7 | Revue des capacités, anti-SSRF, webhooks, quarantaine | 3–5 j |
| 8 | Gestionnaire dans la tour de contrôle | 4–6 j |
| 9 | 3 plugins de référence + 1 intégration niveau 3 | 4–6 j |
| 10 | Documentation, API figée, `CODEOWNERS` | 2–3 j |
| **Total** | | **32–47 j** |

**Tranche minimale défendable pour le concours** : Phase 2 + un slot
(`profile.header.badge`) + un événement (`proof.verified@1`) + tests de
sécurité de base ≈ **6–8 j**. Le reste s’ajoute ensuite, sans dette de
mécanisme.

## 4. Conséquences

- Un seul mécanisme d’extension à terme : le SDK. Le pont niveau 1 est
  explicitement temporaire.
- `test:boundaries` doit interdire à un plugin d’importer l’intérieur d’un
  module ou un SDK fournisseur hors `infrastructure/` ; la règle sera ajoutée
  en Phase 2, pas après.
- Le cœur doit rester vert **sans aucun plugin** : l’interrupteur global est
  un test de non-régression, pas une option.
- Les formules du cœur (XP, score, notation, compatibilité) restent hors
  d’atteinte des plugins.

## 5. Hors périmètre

Niveau 4, niveau 5, place de marché publique de plugins tiers, MFA de la
console (traitée par `devnet-refactor` §15), planificateur garanti, exécution
de code distant.

## 6. Validation

Modèle validé le 2026-11-05 : niveaux 1–3 retenus, stockage B par défaut,
outbox avec `after()` + drainage, cinq slots et trois événements en première
version, chiffrage indicatif accepté.

## 7. Phase 2 — livrée le 2026-11-05

- SDK `shared/plugin-sdk` : catalogue (capacités, slots, événements), validation
  stricte du manifeste, compatibilité SemVer, `definePlugin`, types de contexte.
- Registre généré `platform/registry.generated.ts` par `npm run plugins:gen` ;
  `npm run plugins:validate` échoue si un manifeste est invalide, si le graphe
  a un cycle ou si le fichier généré n’est pas à jour.
- Table `public.plugin_state` (migration `042`) : lecture authentifiée,
  écriture fermée, plugin de référence inséré désactivé.
- Runtime `platform/plugin-runtime` : activation pilotée par l’état, refus
  d’une API incompatible, résolution `requires`/`conflicts`, garde de
  capacités, interrupteur global, isolement des hooks en échec.
- Plugin de référence `plugins/hello-devnet` : aucune capacité, seulement le
  cycle de vie.
- Tests `test:plugins` (57 vérifications) et règles de frontières étendues aux
  plugins (177 vérifications).

**Dette assumée** : l’écriture de `plugin_state` n’a pas encore de chemin
d’administration (Phase 8) ; elle se fait par SQL serveur. L’adaptateur Supabase
de l’état est écrit mais non exercé par les tests (il demande une base). Le
store clé-valeur, le client HTTP restreint, les slots et les événements réels
arrivent aux Phases 3 à 6.

## 8. Phase 3 — livrée le 2026-11-05

- Migration `043_event_outbox.sql` : `event_outbox`, `event_deliveries`, trois
  déclencheurs atomiques (`post.created@1`, `proof.verified@1`,
  `user.registered@1`), RLS sans politique et privilèges retirés à `anon` et
  `authenticated`. Les déclencheurs sont `security definer` avec
  `search_path` figé et exécution directe révoquée.
- Port `modules/events/ports/event-outbox-repository.ts`, adaptateurs mémoire
  et PostgreSQL direct. La réclamation utilise
  `FOR UPDATE SKIP LOCKED` ; un événement `processing` périmé est repris.
- Dispatcheur `modules/events/application/dispatcher.ts` : livraison au moins
  une fois, clé `(event_id, plugin_id)` idempotente, reprises exponentielles
  plafonnées, délai par gestionnaire, file des échecs, quarantaine du plugin,
  isolement des pannes.
- Runtime : `contextFor` et `quarantine` ; adaptateur PostgreSQL direct de
  `plugin_state` pour que le drainage ne dépende pas de Supabase.
- Route `POST|GET /api/events/drain` : secret porteur pour un planificateur ou
  session authentifiée ; mode `?background=1` via `after()` ; pompe cliente
  légère toutes les 60 s quand le backend est en ligne.
- Tests `test:events` (**54 vérifications**) ; frontières **192
  vérifications** avec `pg` confiné à l’infrastructure et conteneur serveur
  séparé du conteneur client.

**Vérifié sur PostgreSQL 17 local** (base temporaire, supprimée ensuite) :
migration 043 appliquée, les trois déclencheurs produisent les bons sujets et
ne recopient ni texte de publication ni e-mail ; l’adaptateur PostgreSQL
réclame, livre, consigne et ne rejoue pas un événement déjà consommé.

**Dette assumée** : le drainage exige `DATABASE_URL` et un rôle qui peut lire
et écrire les tables d’outbox (connexion directe, pas PostgREST). Sans
planificateur, la latence dépend de la pompe cliente ou d’un appel manuel. Les
gestionnaires de plugins restent sans store ni HTTP (Phases 6 et 7) ; un
gestionnaire doit donc être idempotent et ne peut pas encore produire d’effet
externe. Aucun plugin de production n’est encore abonné : `hello-devnet` reste
sans capacité, et les abonnements sont prouvés par `test:events` et par la
vérification sur base temporaire. Aucun planificateur n’est configuré dans le
dépôt ; la pompe cliente et l’appel manuel assurent le drainage en attendant.
