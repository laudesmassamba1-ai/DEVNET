# DEVNET — point de reprise documentaire

> Dernière mise à jour : 2026-11-15.
> Ne remplace pas le registre d'exécution central : il le complète pour la
> passe documentation/contenu.

## 1. État Git

- Branche : `feature/status-editor-liquid-glass`
- `HEAD` : `1916a48` — `pwa: laisser la sonde de secours écrire son empreinte après la réponse`.
- Code déployé : `1916a48`, déploiement `devnet-289pyzuvu`, alias
  `https://devnet-brown.vercel.app`. Le commit `203fd1a` est documentaire.
- La migration `081_story_media_audience.sql` est appliquée sur une base neuve
  (81/81) et sur Neon (81/81). Le défaut P1 d'audience des médias de story est
  fermé et couvert par 26 vérifications d'audience et 36 de sécurité média.

## 2. Phases

### Terminé

- Les cinq skills d'ingénierie ont été lus, dont le skill documentaire et le
  skill Trust & Safety.
- Inventaire initial des pages, routes API et documents Markdown.
- Première liste d'écarts factuels entre README, contenu visible et code.
- Création des quatre registres `docs/maintenance/`.
- `README.md`, `.env.local.example`, `app/settings/page.tsx`, `lib/stories.ts`
  et `docs/ops/failover.md` corrigés.
- `docs-technique.md`, `docs/FONDATIONS.md`, `docs/ARCHITECTURE.md`,
  `ROADMAP.md` et `docs/engineering/DEVNET_STORIES_SPEC.md` réécrits.
- Registres centraux réconciliés avec `1916a48` et UI-003 à 491 mesurés
  (plafond 493).
- Validations lot 1 : `tsc`, `build`, `ux:check`, `test:push-notify`, liens.
- Réconciliation des registres d'exécution avec `1916a48`.
- Documents média, sécurité et release corrigés : audience `081`, TLS
  `verify-full`, `service_role` refusé, bucket public encore ouvert.

### En cours

- Audit page par page des textes visibles : une seule page corrigée à ce jour.
- Audit route par route des textes visibles.

### P1 média/Stories — corrigé

Le chemin `/api/media/<path>` d'une story vérifie désormais l'audience :
`can_read_media_file` n'autorise une story vivante qu'à son public, à ses
abonnés ou à son auteur. La migration `081` applique aussi l'extraction exacte
du chemin et le contrôle de propriété aux stories. Preuves :
`test:stories-audience` 26/26, `test:media-security` 36/36,
`test:stories-postgres` 47/47, base neuve 81/81, Neon 81/81.

### Non commencé

- Réduire les 8 fichiers de plus de 800 lignes (le cliquet empêche seulement
  la régression).
- Tests de charge à 100 ou 1 000 navigations simultanées.
- File d'écriture hors-ligne (IndexedDB) et téléchargement explicite des vidéos.

## 3. Fichiers modifiés dans le lot documentaire

- `.env.local.example`
- `README.md`
- `app/settings/page.tsx`
- `docs-technique.md`
- `docs/FONDATIONS.md`
- `docs/ARCHITECTURE.md`
- `ROADMAP.md`
- `docs/engineering/DEVNET_STORIES_SPEC.md`
- `docs/engineering/DEVNET_MEDIA_ARCHITECTURE.md`
- `docs/engineering/DEVNET_SECURITY_MODEL.md`
- `docs/engineering/DEVNET_RELEASE_CHECKLIST.md`
- `docs/ops/failover.md`
- `lib/stories.ts`
- `docs/maintenance/DEVNET-DOCS-INVENTORY.md`
- `docs/maintenance/DEVNET-CONTENT-AUDIT.md`
- `docs/maintenance/DEVNET-DOCS-CHANGELOG.md`
- `docs/maintenance/DEVNET-DOCS-CHECKPOINT.md`

Note : `npm run ux:scan` a aussi réécrit `docs/ui/ux-details.json` et
`docs/ui/ux-metrics.json`. Ces fichiers doivent être relus avant tout commit.

## 4. Commandes exécutées

| Commande | Résultat |
|---|---|
| `git status --short` | État sale attendu, fichiers listés ci-dessus |
| `git rev-parse --short HEAD` | `1916a48` |
| `ls db/migrations \| wc -l` | 80 fichiers ; `029` absent |
| `npm run ux:scan` | 491 valeurs arbitraires ; 1 couleur en dur ; 8 fichiers > 800 lignes |
| `npm run ux:check` | Cliquet tenu ; 491 valeurs arbitraires pour un plafond de 493 |
| `npx tsc --noEmit` | 0 erreur |
| `npx eslint app/settings/page.tsx lib/stories.ts` | 0 erreur |
| `npm run build` | Exit 0 ; 44 pages générées |
| `npm run test:push-notify` | 34 vérifications réussies |
| `npm run test:pwa` | 215 vérifications réussies |
| `npm run test:stories-audience` | 26/26 |
| `npm run test:media-security` | 36/36 |
| `npm run test:trust-safety-http` | 75/75 |
| `npm run test:boundaries` | 349/349 |
| `npm run test:pages` | 30/30 |
| `npm run test:experience` | 57/57 |
| Vérification locale des liens Markdown | 25 liens vérifiés, 0 manquant |
| Vérification des scripts `npm run` cités | Tous présents dans `package.json` |
| Lecture de `README.md`, `.env.local.example`, `docs/ops/failover.md` | Écarts confirmés |
| Lecture de `app/settings/page.tsx` et des routes push | Contradiction confirmée |
| Lecture de `lib/stories.ts` et migrations `018`/`070` | Stories média/audience confirmées |

## 5. Validations encore dues

- Tests de charge (100 / 1 000 navigations simultanées).
- Push et bannière sur un téléphone physique (Android Chrome, Safari iOS).
- Téléchargement explicite des vidéos et file d'écriture hors-ligne.
- Éditeur de politique T&S (lecture seule aujourd'hui).

## 6. Blocages

- Secrets R2 absents : le parcours média objet réel reste non prouvé.
- Le P1 média/Stories exige une correction SQL/HTTP et un test multi-comptes.
- L'état de production doit être affirmé à partir de preuves fraîches, sans
  recopier d'URL contenant un secret.
- Aucun commit/push sans instruction explicite.
- Ne pas modifier `docs/ui/ratchet.json` sans décision écrite.

## 7. Prochaine action exacte

1. Auditer `DEVNET_MEDIA_ARCHITECTURE.md`, `DEVNET_SECURITY_MODEL.md` et
   `DEVNET_RELEASE_CHECKLIST.md`, puis les ADR encore cités.
2. Poursuivre l'audit des 37 pages, en commençant par celles qui parlent de
   Stories, médias ou sécurité.
3. Corriger le P1 média/Stories (SQL et/ou route), puis exécuter le test
   multi-comptes sur les deux chemins de média.
4. Terminer les validations encore dues et consigner les résultats réels.
