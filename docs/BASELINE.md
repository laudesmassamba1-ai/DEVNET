> **Note 2026-11-09** : ce document est un instantané historique. Le miroir local est PostgreSQL 18.3, les migrations vont jusqu’à 051 (52 entrées avec `000_compat.sql`), et la cible Systalink a été migrée le 2026-11-09. L’exploitation est décrite dans `docs/ops/` et l’ADR 0011.

# État de référence — Phase 0

> Mesuré le 2026-11-04 sur `refactor/independence` (commit `4b0a81f`), Node
> v22.23.2, npm 10.9.8, Next.js 16.3.8. **Chaque chiffre ci-dessous vient
> d'une commande exécutée**, pas d'une note antérieure.

## 1. Résultats des vérifications

| Commande | Résultat | Sortie |
|---|---|---|
| `npm ci --no-audit --no-fund` | ✅ | 521 paquets, 2 min |
| `npm test` (36 suites enchaînées) | ✅ `exit 0` | aucune suite en échec |
| `npx tsc --noEmit` | ✅ `exit 0` | aucune erreur |
| `npm run lint` | ✅ `exit 0` | aucune erreur |
| `npm run build` | ✅ `exit 0` | 35 routes construites (statiques + dynamiques) |

Le build était le point de fragilité connu (`next/font/google` → échec hors
ligne). Il est **déjà corrigé** : `app/layout.tsx` utilise `next/font/local`
avec les fichiers de `app/fonts/` (Inter variable + IBM Plex Mono 400/500/600/700).
Le build passe donc sans accès réseau. ✅ vérifié, pas seulement relu.

## 2. Compteurs réels (et écarts avec l'estimation initiale)

| Mesure | Valeur réelle | Estimation initiale |
|---|---|---|
| Suites dans `npm test` | **36** | 33 |
| Fichiers `supabase/NNN_*.sql` | **40** (001 → 040) | 39 |
| Fichiers important `@supabase/*` directement | **0** | 56 |
| Fichiers passant par le client maison `lib/supabase/*` | **51** | — (le chiffre 56 les comptait tous) |
| Occurrences de `.from(` (app, components, lib, hooks) | **304** | 289 |

Le SDK Supabase a depuis été retiré : plus aucun fichier n'importe
`@supabase/*`. Le point d'étranglement reste **le client maison** :
`lib/rest/client.ts` conserve la surface `from`/`auth`/`channel` au-dessus de
`/api/rest`, `/api/auth` et `/api/media`. Les compteurs à faire décroître sont
les appels `.from()` et le nombre de fichiers qui passent par cette façade.

## 3. État du dépôt au démarrage (modifications préexistantes)

Ces changements étaient **déjà présents, non commités**, quand la mission a
démarré. Je ne les ai pas écrits ; je les ai vérifiés :

- `lib/github/crypto.ts` + `scripts/test-github-crypto.ts` : dérivation HKDF,
  préfixe de version du jeton chiffré et période de grâce.
- `lib/github/oauth.ts` + `scripts/test-public-origin.ts` : origine publique
  explicite en production via variable d'environnement (§2.5).
- `package.json`, `.gitignore`, `.env.local.example`.

Couverture : `test:github-crypto` et `test:public-origin` sont dans
`npm test` et passent ✅. Ces deux points de §2 sont donc traités dans le
code, mais **non commités** — à relire puis commiter avant la Phase 8.

## 4. Dette visible dès la Phase 0 (à traiter en Phase 12)

- `goose-x86_64-unknown-linux-gnu.tar.bz2` (~29 Mo), `tunnel-url.txt`,
  `tunnel*.log`, `tunnel.pid`, `.dev.pid`, `dev-server.log`, captures d'écran
  et `docs-technique.pdf` à la racine du dépôt.
- `supabase/seed.sql` (hachages bcrypt de comptes de test) toujours présent.
- `supabase/migrations/` duplique des fichiers déjà à la racine de `supabase/`
  (héritage `001…040`) : deux sources de vérité pour les migrations.

## 5. Décision de séquence

- **Phase 1 (vérification de la base Systalink) : reportée** à la demande du
  propriétaire (base non achetée). Aucune hypothèse n'est faite sur le SGBD,
  la version ou les droits.
- **Phase 2 (environnement local reproductible) : faisable et vérifiable
  sans Systalink** — l'environnement Compose cible PostgreSQL 17.

## 5.1 Cible Systalink annoncée

> **Dépassé le 2026-11-09** : la cible est mesurée, migrée et décrite dans
> `docs/ops/db-capabilities.md`. Ce paragraphe conserve la décision initiale.

- La base **n'est pas encore achetée**.
- La cible envisagée est **PostgreSQL 17, capacité annoncée de 5 Go**. Cette
  information vient du propriétaire ; elle n'a pas été vérifiée auprès de
  Systalink et ne confirme ni le moteur réellement fourni, ni les droits, ni
  l'accès réseau, ni le SSL, ni les extensions.
- Aucun pilote PostgreSQL applicatif et aucune migration distante ne sont
  activés. La configuration locale est conservée ; la stratégie de production
  reste suspendue jusqu'à l'achat et aux vérifications.

## 6. Risques identifiés pour la suite (pré-mortem Phase 2)

1. **Les 51 migrations supposent Supabase** (`auth.uid()`, rôles `anon` /
   `authenticated`, schéma `extensions`, publication `supabase_realtime`).
   Sans la couche de compatibilité `000_compat.sql`, elles échoueront sur un
   PostgreSQL vierge. Mitigation : la couche a été écrite et validée sur un
   conteneur jetable, puis les 52 entrées ont été appliquées en local et en
   distant.
2. **Deux copies des migrations** (`supabase/` et `supabase/migrations/`)
   peuvent diverger silencieusement. Mitigation : choisir une source unique
   avant tout exécuteur suivi, et vérifier l'égalité fichier par fichier.
3. **`npm run db:reset`** peut viser une base distante par erreur de variable.
   Mitigation : refus explicite si l'hôte n'est ni `localhost`, ni `127.0.0.1`,
   ni le conteneur local.

## 7. Mise à jour — 2026-11-09

- Cible Systalink mesurée : PostgreSQL 18.3, TLS 1.3, `max_connections = 100`.
- 52 migrations appliquées (`000_compat.sql` + `001…051`) ; simulation
  « Rien à appliquer ».
- Rôles `anon`, `authenticated`, `service_role` créés et accordés ; `devnet_u`
  n'a toujours pas `CREATEROLE`, ce qui est attendu.
- Compteurs distants : 58 tables, 178 politiques, 92 fonctions `public`
  (dont 2 fournies par `pgaudit`), 35 déclencheurs, 14 tables temps réel.
- Mot de passe exposé le 2026-11-08 renouvelé ; l'ancien est invalide.
- Sauvegarde distante chiffrée GPG effectuée et restaurée dans une base locale
  vide ; compteurs, RLS (17) et stories (41) vérifiés. Clé encore locale, copie
  hors site et planification à faire.
- L'application n'est pas encore basculée : `.env.local` ne pointe pas vers la
  base distante.
