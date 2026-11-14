# DevNet — Ordre de mission pour l'IA

> **À qui s'adresse ce document** : à toute IA de code qui travaille sur DevNet (interface, backend, base de données, DevOps).
> **À lire en entier au début de chaque session**, avant de toucher au moindre fichier.
> Propriétaire du projet : **Laudes**. Il travaille **en français** : réponds-lui en français, de façon **directe et honnête** sur les contraintes réelles, avec **une seule question à la fois** quand tu dois en poser une.

---

## 1. Le projet en 60 secondes

**DevNet** est un réseau social pour développeurs africains francophones, créé pour le concours **CADEV de Systalink**. Il **complète GitHub** (GitHub = l'atelier ; DevNet = la place publique) : fil social, profils vivants, preuves et réputation, communautés, messagerie, gamification, et **code exécutable directement dans le fil**.

**Stack actuelle** : Next.js 16 (App Router), React 19, TypeScript strict, Tailwind v4, Monaco. Elle repose aujourd'hui sur **Supabase**, que nous **quittons**.

**État mesuré du dépôt** (à revérifier avant de t'y fier) : ~296 fichiers TS/TSX, 35 pages, 15 routes API, 39 migrations SQL, 33 suites de tests (~2 231 vérifications) toutes vertes, `tsc --noEmit` et ESLint propres. Le client Supabase est appelé depuis 56 fichiers (289 requêtes `.from()`), avec 9 canaux temps réel.

---

## 2. Les contraintes réelles (jamais les oublier)

- **Budget nul.** Tout doit tourner sur des offres gratuites. Aucune dépendance payante sans accord écrit de Laudes. **Ne redimensionne jamais** la base (l'augmentation est facturée, irréversible).
- **Aucun service structurant.** Ni Supabase, ni Vercel, ni GitHub, ni Systalink ne doivent être indispensables : chacun est un **adaptateur remplaçable** derrière un port.
- **Hébergement de l'API : Vercel** (serverless : pas de processus permanent, connexions SQL à ménager, pas de WebSocket durable → temps réel par **polling**).
- **Public** : développeurs d'Afrique francophone, mobiles modestes, réseaux lents : performance et mode « économie de données » sont des exigences.
- **Temps limité (concours)** : tranches verticales fonctionnelles, **jamais de « big bang »**.

---

## 3. Décisions DÉJÀ prises (ne les remets pas en question, ne pose pas la question)

1. **Supabase est abandonné** → PostgreSQL direct + API propre sur Vercel.
2. **Architecture** : monolithe modulaire, ports et adaptateurs, domaine par domaine.
3. **Temps réel** : polling avec curseur (pas de processus permanent).
4. **Extensibilité** : plugins de confiance compilés (niveau 2) + intégrations externes isolées (niveau 3) ; **pas de code serveur tiers exécuté dans l'application**.
5. **DevNet complète GitHub** : il ne l'imite pas et ne le remplace pas.
6. **Le chiffrement de bout en bout, les appels audio/vidéo, la monétisation** sont **hors périmètre** et ne doivent **jamais** être annoncés.
7. **Les formules du cœur** (XP, niveaux, score /1000, notation bayésienne, compatibilité, poids des preuves) **ne se modifient pas** sans test préalable et décision de Laudes.
8. **Stockage des images : Cloudinary**, **derrière un `StoragePort`** (jamais appelé directement par l'interface). Envois **signés** uniquement, secret d'API côté serveur, aucune vidéo, quotas surveillés (voir `devnet-refactor` §4, « Stockage de médias »). Le contenu **privé** (pièces jointes de messages) n'est jamais servi en diffusion publique.

---

## 4. L'état de la base de données Systalink (déclaré, pas vérifié par toi)

Source : console Systalink et courriel du support (8 novembre 2026). **Vérifie chaque point par la mesure.**

- PostgreSQL **15** probable (nœud `pool-postgres-15-instance-0`, sur Kubernetes) ; **1 cœur, ~1 Go de mémoire, ~5 Go de stockage**, **pas d'autoscaling du stockage**, pas de haute disponibilité.
- **Accès public** avec port attribué par le support ; **aucun filtrage IP** (ouvert à `0.0.0.0/0`).
- **TLS** : le support a recréé le certificat ; connexion attendue en **`sslmode=verify-full`** avec le `root.crt` fourni (CA valable jusqu'au **23 octobre 2027**). Le TLS 1.3 a déjà été confirmé côté Laudes.
- **Rôles créés** : `anon`, `authenticated` (`NOLOGIN NOINHERIT`), `service_role` (`NOLOGIN NOINHERIT BYPASSRLS`). L'utilisateur `devnet_u` en est membre et est créé `NOINHERIT`.
- ⚠️ **Risque à traiter avant de brancher l'API** : `devnet_u` peut faire `SET ROLE service_role` (qui contourne le RLS). **L'API ne doit jamais se connecter avec `devnet_u`.** Il faut un rôle de connexion distinct **`devnet_app`** (non propriétaire, membre de `authenticated` mais **pas** de `service_role`). Laudes doit le demander au support.
- **Les identifiants** (mot de passe, URL de connexion) ne sont **jamais** écrits dans le dépôt, les journaux ni tes réponses (voir §6, règle 1).
- **Serveur MCP Systalink** (administration des bases par l'IA) : **outil ponctuel, jamais une dépendance de l'application**. Outils `db_delete`, `db_stop`, `db_create` et `db_connection` **bloqués au niveau du client** ; `db_command`, `db_trigger_backup` et `db_start` **avec confirmation de Laudes à chaque appel** ; lecture seule, sans donnée personnelle ; jeton **court, généré par Laudes, jamais écrit nulle part** (voir `devnet-database-ops` §1, « Accès par MCP »). Si tu n'as **pas** de blocage technique des outils destructifs, **n'utilise pas le MCP**.

---

## 5. Les skills à appliquer (ordre de priorité)

Installe-les (voir §10) et applique-les **ensemble** ; en cas de recouvrement, **la règle la plus stricte gagne**.

| # | Skill | Rôle |
|---|---|---|
| 1 | `code-excellence` | Hygiène de code, boucle de vérification, 7 lois, interdits |
| 2 | `devnet-database-ops` | Secrets, TLS, rôles, migrations sur la base Systalink, sauvegardes, incidents |
| 3 | `devnet-refactor` | Quitter Supabase, ports et adaptateurs, auth, RLS, temps réel, tour de contrôle d'admin |
| 4 | `devnet-extensibility` | Évolution du cœur sans casse, plugins, points d'extension |
| 5 | `devnet-interface` | Catalogue complet des pages, fenêtres, paramètres, modération, admin |
| 6 | `devnet-experience` | **Contrat** d'expérience : design, motion, parité sociale, code exécutable, portes de contrôle |

**Hiérarchie des priorités** : sécurité et vie privée > accessibilité et performance > justesse fonctionnelle > fonctionnalités > beauté.

---

## 6. Les 12 règles qui ne se discutent pas

1. **Secrets** : jamais affichés, répétés, journalisés, committés. Si l'un apparaît en clair (conversation, fichier, capture), **dis-le à Laudes immédiatement** : il est compromis et doit être renouvelé.
2. **TLS** : `sslmode=verify-full` (ou `require` à défaut), **jamais** `disable`/`prefer`/`allow` pour des données réelles.
3. **Aucune écriture sur la base distante** sans : simulation → plan affiché → **confirmation de Laudes** → exécution → vérification.
4. **Interdit** sans confirmation écrite : `DROP`, `TRUNCATE`, `DELETE`/`UPDATE` sans `WHERE`, `db:reset`, redimensionnement, arrêt ou suppression de la base.
5. **Ne modifie jamais une migration déjà appliquée.** Toute correction = nouvelle migration rétro-compatible.
6. **L'application ne se connecte jamais en propriétaire ni avec un rôle pouvant devenir `service_role`.** Identité par requête : `SET LOCAL ROLE` + `set_config(..., true)` dans une transaction, **jamais au niveau de la session** (un pool fuirait l'identité entre utilisateurs).
7. **Les 33 suites, `tsc --noEmit`, ESLint et le build restent verts** à chaque étape. Tu n'affaiblis, ne désactives ni ne contournes **jamais** un test, un lint, un seuil ou une porte de contrôle. Si une règle te semble fausse, **signale-le avec preuve**.
8. **Pas de « big bang »** : une tranche verticale, testée, avec retour arrière, puis la suivante.
9. **Honnêteté** : étiquette chaque affirmation **✅ exécuté et vérifié** (commande + résultat, sans secret) / **🔍 relu** / **⚠️ non vérifié**. Si un chiffre de ce document ne correspond plus au dépôt, dis-le.
10. **Pas de code non fiable** exécuté dans l'application ni avec accès à la base ou aux secrets. L'exécution de code publié se fait dans un bac à sable isolé, **sur clic explicite**.
11. **L'interface n'appelle aucun SDK fournisseur** (ni Supabase, ni `pg`) : elle passe par des services et des ports.
12. **Tu ne promets rien que le produit n'offre pas** (E2EE, conformité légale, disponibilité, absence de faille).

---

## 7. Ce que tu dois faire, dans l'ordre

Chaque vague se termine par un **rapport** (format §9) et, si besoin, **une** question à Laudes. Ne passe pas à la vague suivante si la **définition de terminé** n'est pas satisfaite.

### Vague 0 — Sécurité immédiate et état de référence
- Vérifie qu'**aucun secret** n'est en clair dans le dépôt (`.gitignore` exclut `.env*`, `gitleaks` propre). Rappelle à Laudes de **renouveler le mot de passe de la base** s'il a déjà été partagé hors de son terminal.
- Crée la branche de travail, lance `npm ci`, les 33 suites, `tsc --noEmit`, ESLint, le build : consigne l'**état de référence**. (Si le build échoue hors-ligne à cause de Google Fonts, passe à `next/font/local`.)
- Construis les **portes de contrôle** de `devnet-experience` §14 (`npm run verify:ui`, lints, tests, CI protégée) et **prouve qu'elles échouent** quand on viole une règle.
- *Terminé* : référence documentée, portes actives.

### Vague 1 — Accès à la base (skill `devnet-database-ops`)
1. Donne à Laudes les commandes exactes pour tester `sslmode=verify-full` avec `root.crt` (vérification de l'empreinte du certificat par un **second canal**) et lancer `db-probe.sh` ; **attends son rapport** (tu n'as pas accès à sa base).
2. Fais demander au support : rôle **`devnet_app`**, schémas `auth`/`extensions` si besoin, sauvegardes, `max_connections`.
3. Consigne les capacités dans `docs/ops/db-capabilities.md` (sans secret) et applique l'arbre de décision : **stratégie A** (RLS conservé via compatibilité) si les droits le permettent, sinon **stratégie B** (règles d'accès dans l'API).
4. Crée l'**environnement local miroir** (`postgres:15` en Docker), `db:migrate` en simulation par défaut, garde `DB_TARGET`.
- *Terminé* : TLS vérifié, capacités et stratégie décidées, base locale reproductible en moins de 5 minutes.

### Vague 2 — Migrations et sécurité de la base
- Répète `000_compat.sql` + les 39 migrations en local sur `postgres:15` ; compare les objets (référence mesurée en PostgreSQL 16 : **46 tables, 160 politiques, 52 fonctions, 32 déclencheurs**) et explique tout écart.
- **Corrige `is_admin()`** (migration 037 : renvoie vrai sans identité) avec des **tests d'abord** ; écris les **tests RLS sur un vrai PostgreSQL** (isolation entre utilisateurs, anonyme refusé, élévation refusée, `devnet_app` ne peut pas devenir `service_role`).
- Applique sur la base distante **après confirmation de Laudes**.
- *Terminé* : migrations appliquées, tests RLS verts, `schema_migrations` à jour.

### Vague 3 — Indépendance vis-à-vis des services (skill `devnet-refactor`)
- Crée les **ports** et le conteneur de composition ; adaptateurs `memory` (réutilise le mode démo existant), `postgres` et `legacy-supabase` (transitoire).
- Migre **un domaine à la fois** (posts d'abord), puis l'**authentification** (remplace les ~6 appels Supabase), puis profils, messages, notifications, projets/preuves, notes, forks, fichiers git. Compteur à suivre : **289 appels `.from()` → 0**.
- Remplace les 9 canaux temps réel par du **polling** avec filtrage d'autorisation côté serveur.
- Corrige les points de sécurité listés dans `devnet-refactor` §2 (clé de chiffrement du cookie GitHub, `authorize`, `seed.sql`, fichiers parasites…).
- *Terminé* : plus aucun import `@supabase/*`, l'application fonctionne sur PostgreSQL direct et en mode démo.

### Vague 4 — Interface et expérience (skills `devnet-interface` + `devnet-experience`)
> Peut démarrer **en parallèle** de la vague 3 une fois la vague 0 terminée, avec l'**adaptateur mémoire** pour les données.
- Inventaire, **matrice de couverture** `docs/ui/coverage.md` (toutes les surfaces, priorités P0–P3).
- **Trois directions artistiques** présentées à Laudes ; **il choisit** avant la production en masse.
- Système de design et de mouvement (niveaux N0–N3), gestionnaire de fenêtres, puis surfaces **P0 d'abord** : accès, fil, compositeur, **code exécutable dans le fil**, profil, messagerie, notifications, paramètres, signalement/blocage, pages légales et d'erreur.
- **Avant de toucher au code d'exécution** : établis où le code s'exécute réellement aujourd'hui (`docs/ui/code-runner.md`) ; si c'est dans le processus de l'application, **alerte Laudes** : faille critique.
- *Terminé* : P0 complet, `verify:ui` vert, captures clair/sombre/mobile/bureau.

### Vague 5 — Tour de contrôle et modération
- Instrumentation d'abord (`security_events`, journal d'audit chaîné, honeytokens), puis modules : **Radar, Comptes, Sécurité, Audit**, ensuite Contenu et Données/stockage. MFA obligatoire, 404 pour les non-admins.
- Surveillance du **stockage de 5 Go** (seuils proposés à valider avec Laudes), passage en lecture seule automatique avant saturation.
- *Terminé* : un admin avec MFA suspend un compte, l'action est dans l'audit, tests de la matrice route × rôle verts.

### Vague 6 — Extensibilité (skill `devnet-extensibility`)
- ADR du modèle d'extension, SDK minimal, registre généré, bus d'événements fiable (outbox), premier slot et premier plugin de démonstration, gestionnaire d'extensions dans la tour de contrôle.
- Applique le **protocole en 12 étapes** à toute modification du cœur.

### Vague 7 — Finition, sauvegardes, déploiement
- Sauvegardes chiffrées **avec restauration testée**, passe de performance (Lighthouse sur profil lent), passe d'accessibilité, déploiement Vercel (variables séparées par environnement, retour arrière documenté), documentation à jour et **conforme au code** (README corrigé).

---

## 8. Coordination si plusieurs IA travaillent en parallèle

| Zone | Propriétaire |
|---|---|
| `app/`, `components/`, `docs/ui/` | IA **interface** |
| `lib/adapters/`, `db/`, migrations, `docs/ops/` | IA **backend / base de données** |
| `lib/ports/`, contrats `docs/ui-contracts/` | **Négociés par contrat écrit** : l'IA interface écrit le besoin, l'IA backend livre la migration et l'adaptateur |
| Fonctions pures de `lib/` (XP, score, notation…) | **Personne ne les modifie** sans test préalable et accord de Laudes |

Chacune travaille sur **sa propre branche** (`feat/ui-…`, `refactor/db-…`), relit un fichier avant de l'écrire s'il a changé, et ne fusionne que si tout est vert.

---

### Répartition entre les deux outils gratuits (OpenCode et Freebuff)

| Outil | Rôle | Accès | Interdit |
|---|---|---|---|
| **OpenCode** | Base de données, backend, migrations, configuration Vercel, **MCP Systalink** | MCP avec la politique d'outils de `devnet-database-ops` ; jeton **uniquement** dans la variable d'environnement `SYSTALINK_TOKEN` ; `bash` en confirmation | Lire ou afficher un secret ; outils `db_delete`/`db_stop`/`db_create`/`db_connection` ; écrire via `db_command` |
| **Freebuff** | **Interface seulement** (`devnet-experience`, `devnet-ux-repair`, `devnet-interface`) | **Aucun MCP, aucun identifiant**, aucune base ; travaille en **mode démo** (`NEXT_PUBLIC_FORCE_DEMO=true`) | Toucher à `db/`, aux migrations, à `lib/adapters/`, aux fichiers `.env*` |

- **Fichier de contexte** : OpenCode lit `AGENTS.md` ; Freebuff lit `knowledge.md`. Dans les deux, mets seulement le bloc d'obligation de §10 et le chemin de `docs/MISSION.md`.
- **Modèles gratuits = contexte limité** : charge `MISSION.md` **plus UN seul skill** par tâche, jamais les six d'un coup ; travaille par petites tâches ; **les portes de contrôle** (`verify:ui`, `ux:check`, tests, CI) servent de filet, car un modèle gratuit se trompe plus souvent.
- Freebuff peut limiter la durée des sessions selon le pays : termine chaque session par le **rapport de fin** (§9) et commit, pour reprendre sans perte.
- Ce que l'un des deux outils change n'est **jamais fusionné sans que tout soit vert**.

## 9. Rituel de chaque session

**Au début** : (1) lis ce document et les skills ; (2) affiche « Contrat actif : N règles BLOQUANTES, M MAJEURES » ; (3) lance l'état de référence ; (4) dis à Laudes **en trois lignes** ce que tu vas faire.

**À la fin de chaque vague**, rends ce rapport :
```
✅ Fait        : ce qui est en place (fichiers, migrations, surfaces), sans secret
🧪 Vérifié     : commandes et résultats (✅ / 🔍 / ⚠️), tests, tsc, lint, build, verify:ui
📋 Règles      : identifiants des règles concernées + preuves
📊 Compteurs   : appels .from() restants, imports @supabase restants, tests verts/total, surfaces P0 complètes
⚠️ Risques     : ouverts (TLS, exposition publique, stockage, HA, coûts) + décisions en attente
👉 Suite       : prochaine étape + UNE seule question pour Laudes
```

---

## 10. Installation des skills

Dans le dépôt DevNet, place chaque dossier de skill (avec son `SKILL.md`) ainsi, **si tu utilises Claude Code** :
```
.claude/skills/code-excellence/SKILL.md
.claude/skills/devnet-database-ops/SKILL.md   (+ db-probe.sh)
.claude/skills/devnet-refactor/SKILL.md
.claude/skills/devnet-extensibility/SKILL.md
.claude/skills/devnet-interface/SKILL.md
.claude/skills/devnet-experience/SKILL.md
```
Avec un autre outil, mets-les dans `docs/skills/` et ajoute ce bloc à **`AGENTS.md`** et **`CLAUDE.md`** (pour qu'il soit relu à chaque session) :

```md
## Mission DevNet — OBLIGATOIRE
Avant toute action, lis `docs/MISSION.md` puis les skills de `docs/skills/`.
Applique-les ensemble ; la règle la plus stricte gagne.
Ne contourne jamais une règle, un test ou une porte de contrôle.
Aucun secret en clair. Aucune écriture distante sans confirmation de Laudes.
Réponds en français. Une seule question à la fois.
```

---

## 11. Décisions qui attendent Laudes (ne les prends pas à sa place)

1. Choix de la **direction artistique** parmi les trois propositions.
2. Création du rôle **`devnet_app`** par le support, et confirmation que le **mot de passe a été renouvelé**.
3. **Nombre d'utilisateurs visé** pour le concours (dimensionnement des 5 Go) et **durées de rétention** des journaux.
4. **Textes légaux** (CGU, confidentialité) : relecture par un professionnel ; l'IA ne les déclare jamais « conformes ».
5. Toute **écriture sur la base distante** et toute opération irréversible ou coûteuse.
6. Ouverture éventuelle aux **plugins tiers** (niveaux 3 et 4) en production.

---

## 12. Ta toute première action

1. Lis ce document. 2. Affiche « Contrat actif… ». 3. Lance l'état de référence (`npm ci`, 33 suites, `tsc --noEmit`, ESLint, build) et vérifie l'absence de secrets dans le dépôt. 4. Écris `docs/ops/db-capabilities.md` à partir de §4 en marquant chaque fait **⚠️ non vérifié**, et donne à Laudes la commande exacte du test `verify-full` et `db-probe.sh`. 5. Pose **une** question : « As-tu renouvelé le mot de passe de la base ? »

---

## Annexe — MCP Systalink pour OpenCode

Le serveur MCP est déjà déclaré dans `opencode.json` pour OpenCode, avec le jeton lu depuis `SYSTALINK_TOKEN` et les outils destructifs bloqués.

```json
{
  "mcp": {
    "systalink": {
      "type": "remote",
      "url": "https://api.systalink.com/mcp",
      "enabled": true,
      "oauth": false,
      "headers": {
        "Authorization": "Bearer {env:SYSTALINK_TOKEN}"
      }
    }
  }
}
```

Freebuff ne reçoit **aucun** MCP, aucun jeton, aucun accès base.
