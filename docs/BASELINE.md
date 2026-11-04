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

## 2. Compteurs réels (et écarts avec le skill)

| Mesure | Valeur réelle | Ce qu'annonçait le skill §1 |
|---|---|---|
| Suites dans `npm test` | **36** | 33 |
| Fichiers `supabase/NNN_*.sql` | **40** (001 → 040) | 39 |
| Fichiers important `@supabase/*` directement | **4** | 56 |
| Fichiers passant par le client maison `lib/supabase/*` | **51** | — (le chiffre 56 les comptait tous) |
| Occurrences de `.from(` (app, components, lib, hooks) | **304** | 289 |

Le skill surestimait donc l'usage direct du SDK (4 fichiers seulement :
`app/api/admin/accounts/route.ts`, `lib/supabase/client.ts`,
`lib/supabase/server.ts`, `hooks/useSession.ts`) et sous-estimait le nombre
d'appels `.from()`. Conséquence pratique : le point d'étranglement réel est
**le client maison**, pas les imports SDK — c'est lui que les ports devront
remplacer (Phase 4/6). Les compteurs de référence à faire décroître sont
304 `.from()` et 51 fichiers.

## 3. État du dépôt au démarrage (modifications préexistantes)

Ces changements étaient **déjà présents, non commités**, quand la mission a
démarré. Je ne les ai pas écrits ; je les ai vérifiés :

- `lib/github/crypto.ts` + `scripts/test-github-crypto.ts` : dérivation HKDF,
  préfixe de version du jeton chiffré et période de grâce (§2.2 du skill).
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
- `supabase/migrations/` duplique les fichiers `001…040` déjà à la racine de
  `supabase/` : deux sources de vérité pour les migrations.

## 5. Décision de séquence

- **Phase 1 (vérification de la base Systalink) : reportée** à la demande du
  propriétaire (base non achetée). Aucune hypothèse n'est faite sur le SGBD,
  la version ou les droits.
- **Phase 2 (environnement local reproductible) : faisable et vérifiable
  sans Systalink** — l'environnement Compose cible PostgreSQL 17.

## 5.1 Cible Systalink annoncée

- La base **n'est pas encore achetée**.
- La cible envisagée est **PostgreSQL 17, capacité annoncée de 5 Go**. Cette
  information vient du propriétaire ; elle n'a pas été vérifiée auprès de
  Systalink et ne confirme ni le moteur réellement fourni, ni les droits, ni
  l'accès réseau, ni le SSL, ni les extensions.
- Aucun pilote PostgreSQL applicatif et aucune migration distante ne sont
  activés. La configuration locale est conservée ; la stratégie de production
  reste suspendue jusqu'à l'achat et aux vérifications.

## 6. Risques identifiés pour la suite (pré-mortem Phase 2)

1. **Les 40 migrations supposent Supabase** (`auth.uid()`, rôles `anon` /
   `authenticated`, schéma `extensions`, publication `supabase_realtime`).
   Sans la couche de compatibilité `000_compat.sql`, elles échoueront sur un
   PostgreSQL vierge. Mitigation : écrire la couche d'abord, la valider sur un
   conteneur jetable, et n'annoncer « les migrations passent » qu'après
   exécution réelle.
2. **Deux copies des migrations** (`supabase/` et `supabase/migrations/`)
   peuvent diverger silencieusement. Mitigation : choisir une source unique
   avant tout exécuteur suivi, et vérifier l'égalité fichier par fichier.
3. **`npm run db:reset`** peut viser une base distante par erreur de variable.
   Mitigation : refus explicite si l'hôte n'est ni `localhost`, ni `127.0.0.1`,
   ni le conteneur local.
