# Extensibilité — inventaire Phase 0

> Mesuré le 2026-11-05 sur `refactor/independence`, commit `afed373`
> (backend Supabase local, projet `devnet`). Chaque chiffre vient d’une
> commande exécutée pendant cette session ; rien n’est repris du skill sans
> vérification. But de ce document : décrire **ce qui existe déjà** avant
> d’écrire une ligne de plugin, pour ne pas construire un second mécanisme
> à côté du premier.

## 1. État de référence exécuté

| Commande | Résultat | Détail |
|---|---|---|
| `npm test` | ✅ `exit 0` | **44 suites** enchaînées dans `package.json` |
| sommation des compteurs imprimés par les suites | ✅ | **2 628 vérifications** annoncées « passées » |
| `npx tsc --noEmit` | ✅ `exit 0` | aucune erreur |
| `npm run lint` | ✅ `exit 0` | aucun avertissement |
| `npm run build` | ✅ `exit 0` | 51 entrées de routes listées, proxy compilé |

Fichiers de test présents : **45** (`scripts/test-*.ts` + `scripts/db/test-*.ts`).
`scripts/test-wasi-live.ts` existe mais n’est **pas** dans la chaîne `npm test`.

La suite la plus utile à l’extensibilité est `test:boundaries` (**162
vérifications**) : elle impose la séparation ports/adaptateurs et l’absence
d’imports interdits. Tout code de plugin devra passer par elle.

## 2. Mécanisme d’extension déjà en place (déclaratif)

C’est la **place de marché** existante, à réutiliser plutôt qu’à doubler.

| Élément | Fichier / objet | Rôle |
|---|---|---|
| Schéma | `supabase/029_extensions.sql` | tables `extensions` et `extension_installs` (+ RLS auteur / propriétaire) |
| Types | `lib/types.ts` | `Extension`, `ExtensionManifest`, `ExtensionInstall`, `ExtensionSnippet`, `ExtensionCommand` |
| Accès données | `lib/extensions.ts` | lecture, publication, installation, activation, réglages, `fetchActiveContributions` |
| Écran | `app/extensions/` | place de marché, filtres, page d’une extension |
| IDE | Monaco consomme `fetchActiveContributions` | extraits (complétion) et commandes de palette |
| Tests | `test:extensions`, `test:vscode`, `test:connections` | contrat du manifeste et contributions actives |

Propriétés **déjà acquises** et à conserver :

- **Aucune exécution de code tiers.** Une extension est un manifeste JSON :
  `normalizeManifest` valide la forme, ignore ce qu’il ne sait pas lire et
  garde le reste utilisable. Pas de `eval`, pas d’`import()` dynamique, pas
  de code distant — cohérent avec les règles du dépôt.
- **La RLS décide**, pas l’UI : `lib/extensions.ts` ne fait que révéler ce
  que la base autorise (même frontière que `lib/communities.ts`).
- **Activation distincte de l’installation** (`enabled`), avec réglages
  typés (`string` / `boolean` / `number`).
- Le slug est dérivé du nom et rendu unique ; le manifeste est normalisé
  **avant** écriture.

## 3. Composition applicative existante

`platform/container.ts` compose trois domaines extraits :

| Domaine | Port | Adaptateurs |
|---|---|---|
| Fil | `modules/feed/ports/feed-repository.ts` | `supabase/`, `memory/` |
| Signalements | `modules/moderation` | `supabase/` |
| Messages (extras) | `modules/messages` | `supabase/` |

Le reste de l’application appelle encore largement le client maison
`lib/supabase/client.ts` (mesure de la baseline précédente : 304 `.from()`
dans 51 fichiers). **Conséquence pour l’extensibilité** : un slot branché
sur un service de domaine est préférable à un slot qui rappelle `.from()`.

## 4. Ce qui n’existe pas (vérifié par recherche)

Recherche `plugin_state|event_outbox|plugin-sdk` sur `.ts/.tsx/.sql/.md`
hors `node_modules` : **aucun résultat**.

| Attendu par le skill | Réalité |
|---|---|
| table `plugin_state` | absente |
| table `event_outbox` | absente |
| `shared/plugin-sdk/` | absent |
| `plugins/` (dossier de plugins) | absent |
| `docs/extensibility/` | absent avant ce fichier |
| colonne `module` dans `schema_migrations` | absente |
| ADR d’extensibilité | absents (seuls `0001`, `0004`, `0005` existent) |

La place de marché de la §2 est donc **le seul** mécanisme d’extension. Elle
ne persiste aucun état d’exécution, n’émet aucun événement et ne fournit
aucun point d’accroche dans l’UI : c’est exactement le périmètre que la
Phase 1 doit décider d’étendre ou non.

## 5. Migrations : une vérité, deux dossiers

- `supabase/*.sql` : **51 migrations** (`001` →
  `051_story_media.sql`) plus `seed.sql`, soit 52 fichiers.
  `test:db-migrate` vérifie l’ordre, les sommes de contrôle et les refus.
- `supabase/migrations/` : **42** entrées, dont trois fichiers horodatés
  (`20261013…`, `20261026…`, `20261102…`) qui **dupliquent** des migrations
  déjà présentes à la racine, plus `037`/`039`. L’exécuteur ne lit pas ce
  dossier.

Deux sources de vérité pour un même schéma : toute nouvelle migration
d’extensibilité doit être ajoutée **une seule fois** dans `supabase/`, et
l’ambiguïté des dossiers doit être tranchée avant la Phase 2 (sinon
`test:db-migrate` finira par compter faux).

## 6. Contraintes mesurées qui pèsent sur la conception

1. **Pas de clé de service dans l’environnement réel.** La création d’un
   compte admin passe par la session de l’administrateur, `withUser`, la RLS
   et le déclencheur `guard_account_roles` ; aucune clé de service n’est
   requise.
2. **Session partagée navigateur/serveur** (`modules/auth/http/session-cookie.ts`) :
   le cookie httpOnly `devnet_session` porte le jeton, le serveur le hache et
   le compare à `public.sessions`. Un slot rendu côté serveur doit utiliser
   `currentUserId()` et la même source.
3. **Frontières testées** : les nouvelles dépendances (SDK de plugin, bus
   d’événements) doivent entrer par `platform/container.ts` et un port, ou
   `test:boundaries` échouera.
4. **Accessibilité et mobile** déjà contractualisés (`docs/ui-contracts/`) :
   un slot doit rester AA, cibles ≥ 44 px, `prefers-reduced-motion`.

## 7. Écarts entre le skill et le dépôt

| Le skill annonce | Réel |
|---|---|
| 33 suites | **46** |
| 39 migrations | **51** (racine) |
| `plugin_state`, `event_outbox`, `shared/plugin-sdk`, `plugins/` | inexistants |
| ADR d’extensibilité | inexistants |

Ces écarts ne sont pas des bugs : le skill décrit une cible. Ils interdisent
en revanche de présenter comme « existant » ce qui reste à créer.

## 8. Décisions laissées à la Phase 1 (ADR, pas encore écrites)

1. **Niveaux** : 1 = manifeste déclaratif (slots de rendu, réglages) ;
   2 = contributions outillées (commandes, extraits, hooks internes) ;
   3 = code tiers sandboxé. Le dépôt interdit déjà `eval` et l’import
   dynamique : le niveau 3 demanderait une décision explicite.
2. **Premiers slots** : où l’UI accepterait une contribution sans casser
   les contrats existants (fil, barre latérale, page d’extension, IDE).
3. **Stockage A/B** : réutiliser `extensions.manifest` ou introduire
   `plugin_state` ; dans les deux cas, une seule migration.
4. **Événements** : `event_outbox` est absente ; faut-il un bus persistant
   ou des hooks synchrones suffisent-ils au niveau 1 ?

Aucun code de plugin n’est écrit avant validation de l’ADR.

## 9. Addendum — 2026-11-05, après validation orale « on continue »

Une tranche de **niveau 1** a été livrée depuis cet inventaire, sur accord
explicite de Laudes : section `slots` du manifeste, validation des liens,
`contributionsForSlot`, `components/ExtensionSlot.tsx` et deux emplacements
(`discover.sidebar`, `extensions.page`). Décision consignée dans l’**ADR
0006**. Aucune migration : `029` suffit.

Mesures après livraison : `test:extensions` compte **63 vérifications**,
`npm test` reste à **44 suites** et `exit 0`, `tsc`, ESLint et le build
restent verts. Les cartes sont visibles en démonstration à 1440 px et
375 px, sans débordement.

Ce pont de niveau 1 est **temporaire** : l’ADR 0010 prévoit son retrait en
Phase 4 au profit du composant `<Slot>` du SDK, pour ne pas entretenir deux
mécanismes de rendu.

## 10. Addendum — 2026-11-05, Phase 2 livrée

- `shared/plugin-sdk/` : catalogue, manifeste strict, SemVer, `definePlugin`.
- `plugins/hello-devnet/` : plugin de référence sans capacité.
- `platform/registry.generated.ts` : généré, imports statiques.
- `platform/plugin-runtime/` : port d’état, adaptateur mémoire, runtime,
  garde de capacités, interrupteur global.
- `supabase/042_plugin_state.sql` : nouvelle migration (42 au total).
- `scripts/test-plugins.ts` : **57 vérifications**.
- `test:boundaries` : **177 vérifications** après ajout des règles plugins/SDK.

Mesures après livraison (exécutées) : `npm test` passe à **45 suites** et
`exit 0` ; `npx tsc --noEmit`, `npm run lint`, `npm run plugins:validate` et
`npm run build` passent. L’écriture de `plugin_state` reste réservée au serveur
(Phase 8). Les événements réels sont livrés en Phase 3 (voir §11) ; les
slots arrivent en Phase 4, le store et le HTTP en Phases 6–7.

## 11. Addendum — 2026-11-05, Phase 3 livrée

- `supabase/043_event_outbox.sql` : outbox, livraisons, trois déclencheurs
  atomiques, RLS fermée. Migration 43 au total.
- `modules/events/` : port, adaptateurs mémoire et PostgreSQL, dispatcheur
  (reprises, délai par gestionnaire, quarantaine, reprise après péremption).
- `platform/server-container.ts` : composition serveur séparée du conteneur
  client, pour que `pg` n’entre jamais dans le bundle navigateur.
- `platform/plugin-runtime/infrastructure/postgres/` : état des plugins en
  PostgreSQL direct.
- `app/api/events/drain/route.ts` + `components/EventPump.tsx` : drainage par
  planificateur, session ou pompe légère, avec `after()`.
- `scripts/test-events.ts` : **54 vérifications**.
- `test:boundaries` : **196 vérifications** (dont `pg` confiné).
- `test:db-migrate` : attend **44 migrations**, dernière
  `044_is_admin_requires_identity.sql`.

Mesures après livraison (exécutées) : `npm test` passe à **46 suites** et
`exit 0` ; `tsc`, ESLint, le build et les vérifications sur une base
PostgreSQL 18.3 locale passent. Les trois événements réels sont branchés.
Les slots restent en Phase 4 ; le store et le HTTP des plugins en Phases 6–7.

## 12. Addendum — 2026-11-08, socle base de données

- `supabase/044_is_admin_requires_identity.sql` : `is_admin()` ne s'élève plus
  sans identité ; le contournement migration/serveur se lit sur
  `current_user = session_user` ou `service_role`.
- `scripts/db/guard.ts` + `scripts/db-guard.ts` : cible masquée, refus des
  opérations destructrices distantes, `DB_TARGET` et `CONFIRM_REMOTE`.
- `db:migrate` est en simulation par défaut ; `--apply` écrit.
- `platform/infrastructure/postgres/with-user.ts` : identité locale à la
  transaction, rôle et claims posés puis annulés au commit.
- `app/api/health` et `app/api/ready` : vivacité et `select 1` borné.
- `gitleaks` en local et en CI ; `docs/ops/` documente capacités, runbook,
  incidents, sauvegardes et sortie.
- Mesures locales après 044 : 45 entrées de migration, 50 tables `public`,
  161 politiques, 88 fonctions, 35 déclencheurs `public`.

`test:db-migrate` attend désormais **44 migrations**, dernière
`044_is_admin_requires_identity.sql`. `test:db-rls` vérifie la RLS et
`withUser` sur une base locale migrée.

## 13. Addendum — 2026-11-09, migration distante appliquée

- `supabase/045…051` ajoutent les sessions d’authentification, les interactions
  de stories, les stickers personnalisés, les gestes sticker, la carte story en
  message privé et les médias de story.
- Les **52 entrées** (`000_compat.sql` + `001…051`) sont appliquées en local et
  chez Systalink ; `db:migrate:remote` répond « Rien à appliquer ».
- Compteurs locaux : 58 tables `public`, 178 politiques, 90 fonctions `public`,
  35 déclencheurs, 14 tables temps réel. Côté distant : 92 fonctions `public`,
  les 2 supplémentaires venant de `pgaudit`.
- `test:db-migrate` attend **51 migrations**, dernière
  `051_story_media.sql`. `test:db-rls` et `test:stories-postgres` passent.
- Aucune nouvelle surface d’extensibilité n’a été ajoutée par ces migrations :
  le runtime de plugins reste au niveau 1 décrit plus haut.
