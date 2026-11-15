# DEVNET — matrice de validation

> Chaque ligne relie une exigence à une preuve réellement observée.
>
> Dernière mise à jour : 2026-11-14, après la passe d’exécution.

## 1. Contrôles statiques

| Contrôle | Commande | Résultat observé | Date |
|---|---|---|---|
| Types | `npx tsc --noEmit` | **0 erreur** | 2026-11-14 |
| Lint | `npm run lint` | **0 erreur**, 2 avertissements préexistants | 2026-11-14 |
| Contraintes UI | `npm run ui:lint` | **0 régression** | 2026-11-14 |
| Cliquet valeurs | `npm run ux:check` | **0 tiny**, **494 arbitraires** (577 → 494 par conversion `h/w/size` px→espacement), cliquet tenu | 2026-11-15 |
| Tests média | `npm run test:media-security` | **34/34** | 2026-11-15 |
| Stories audience | `npm run test:stories-audience` | refusé hors base locale (script écrit des lignes) : non exécuté | 2026-11-15 |
| Layout | `npm run test:layout` | **6/6** au second passage ; **1 échec** (360 px) au premier passage, non reproduit, à surveiller | 2026-11-15 |
| Mouvement | `npm run ui:motion` | non relancé dans cette passe | — |
| Build | `npm run build` | **succès**, 43 pages | 2026-11-14 |

## 2. Sécurité et médias

| ID | Preuve | Commande / méthode | Résultat | Statut |
|---|---|---|---|---|
| SEC-002 | `service_role` retiré du rôle runtime | lecture de `db/bootstrap/roles.sql` | `grant anon, authenticated` + `revoke service_role` | `FIXED_UNVERIFIED` (application distante) |
| SEC-004 | média privé | `npm run test:db-rls` | 17/17 sur base neuve ; pas de test préprod | `FIXED_UNVERIFIED` |
| SEC-005 | cache story | inspection des en-têtes | `private, no-store` | `VERIFIED` |
| SEC-006 | URL story | `npm run test:media-security` | 34/34 | `VERIFIED` |
| SEC-007 | signature média | `npm run test:media-security` | 34/34 | `VERIFIED` |
| SEC-012 | multipart assemblé | revue + `test:media-security` | taille + signature + suppression codées ; pas de R2 réel | `FIXED_UNVERIFIED` |
| MEDIA-003 | purge | SQL sur `devnet_ci` | 1 supprimée, puis 0, 0 restante | `VERIFIED` |
| MEDIA-001 | octets hors base | architecture documentée | credentials R2 absents | `BLOCKED_EXTERNAL` |

## 3. Stories

| ID | Preuve | Commande / méthode | Résultat | Statut |
|---|---|---|---|---|
| STORY-001 | lecteur | `npm run test:api-stories` + revue | vert | `VERIFIED` |
| STORY-003 | audience public/followers/private | `npm run test:stories-audience` | **12/12** | `VERIFIED` |
| STORY-004 | panne ≠ vide | `tsc` + revue des appelants | `null` / `[]` distincts | `VERIFIED` |
| STORY-005 | pagination | `npm run test:stories-audience` | 61 stories, 2 pages, 0 doublon | `VERIFIED` |
| STORY-002 | machine d’état `lib/story-playback.ts` | `npm run test:story-playback` | 8 transitions vertes | `VERIFIED` |

## 4. UI/UX et responsive

| ID | Preuve | Commande / méthode | Résultat | Statut |
|---|---|---|---|---|
| UI-001 | avertissements lecteur | `npm run lint` | 4 → 0 dans `StoryViewerLive` ; 2 avertissements hors périmètre | `VERIFIED` |
| UI-003 | textes/tokens | `npm run ux:check` | 0 tiny / 494 arbitraires (plafond `docs/ui/ratchet.json` = 494, cliquet tenu) | `IN_PROGRESS` |
| UI-007 | accessibilité (scanner) | `npm run ux:check` | boutons sans type 0, clics non sémantiques 0, autoFocus 0, couleurs en dur 1 (logo) ; cliquet tenu | `FIXED_UNVERIFIED` |
| UI-004 | 5 destinations | `npm run test:navigation` | 173/173 | `VERIFIED` |
| UI-005 | PWA | `npm run test:pwa` | 175/175 (Chromium émulé) | `VERIFIED` (émulation) |
| UI-006 | 320→1024 | `npm run test:layout` | **6/6**, 12 écrans | `VERIFIED` |
| UI-007 | focus/cibles | `test:layout` + revue | partiel | `IN_PROGRESS` |

## 5. Base de données et CI

| ID | Preuve | Commande / méthode | Résultat | Statut |
|---|---|---|---|---|
| QA-002 | PostgreSQL CI | `.github/workflows/ci.yml` | job `database` ajouté ; équivalent local vert | `FIXED_UNVERIFIED` (GitHub non lancé) |
| QA-004 | migrations | `npm run test:db-migrate` | toutes les vérifications passent | `VERIFIED` |
| Migrations | base neuve | `npm run db:migrate -- --apply` | 69 + 070 = 70 appliquées | `VERIFIED` |
| RLS | base neuve | `npm run test:db-rls` | 17/17 | `VERIFIED` |
| Stories PG | base neuve | `npm run test:stories-postgres` | 47/47 | `VERIFIED` |
| Audience | base neuve | `npm run test:stories-audience` | 12/12 | `VERIFIED` |

## 6. Sauvegarde Systalink

| Élément | Valeur observée |
|---|---|
| Commande | `npm run db:backup:remote` |
| Cible | distante, base `devnet`, hôte masqué |
| Archive | `devnet-remote-20261114T013251Z.dump.gpg` |
| Taille | 68 765 octets |
| Chiffrement | GPG AES-256 |
| SHA-256 | `8691356c9cd7ef9614d6930afcccc1ef45aa9b4bfe1c1c4cfb4f4eecc5cb4402` |
| Écriture distante | aucune |

## 7. Limites

- Pas d’iPhone/Safari physique ; mesures Chromium émulées.
- Pas de clés R2/Blob ; le chemin multipart est revu par lecture, pas exécuté
  contre le fournisseur.
- Pas de base de production migrée ; aucune migration distante appliquée.
- Le job CI PostgreSQL n’a pas été exécuté sur GitHub dans cette passe.
- Les 2 avertissements lint restants sont hors du périmètre corrigé
  (`<img>` du fil, export anonyme du proxy Cloudflare).

## Statuts (2026-11-15)

| Contrôle | Résultat |
|---|---|
| `npx tsc --noEmit` | 0 |
| `npm run test:status-editor` | 25/25 |
| `npm run test:story-transcode` | 2/2 |
| `npm run test:liquid-glass` | 4/4 |
| `npm run ux:check` (cliquet) | tenu, 493 arbitraires, 9 fichiers > 800 lignes |
| `npm run verify:ui` | 0 (cliquet 493) |
| `npm run build` | 0 |
| Déploiement prod `devnet-brown.vercel.app` | 200 sur `/api/health` et `/feed` |
| Visionneuse (appui maintenu, zones) | NON VERIFIED : pas de compte de test |
| Éditeur `StatusComposer` / export photo | NON VERIFIED : pas de rendu navigateur |

## 8. Trust & Safety (2026-11-15)

| Contrôle | Commande / méthode | Résultat | Statut |
|---|---|---|---|
| Migrations 075 à 079 | `db:migrate --apply` sur `devnet_migtest` puis Neon | appliquées, 079 incluse | `VERIFIED` |
| Intégration base | `TS_DATABASE_URL=… npm run test:trust-safety` | 31/31 | `VERIFIED` |
| Moteurs et politique | `npm run test:trust-safety-engines` | 13/13 | `VERIFIED` |
| Routes réelles | `npm run test:trust-safety-http` | 59/59 | `VERIFIED` |
| Auth et passerelle | `npm run test:auth-postgres`, `npm run test:rest-gateway` | 35/35, 51/51 | `VERIFIED` |
| Admin | `npm run test:admin-modules` | 18/18 | `VERIFIED` |
| Frontières | `npm run test:boundaries` | 342/342 | `VERIFIED` |
| Signalements | `npm run test:reports` | 32/32 | `VERIFIED` |
| Modération | `npm run test:moderation` | 29/29 | `VERIFIED` |
| Médias | `npm run test:media-security` | 34/34 | `VERIFIED` |
| Chaîne d'audit distante | `verify_admin_audit_chain()` avec identité admin | `ok`, 14 lignes | `VERIFIED` |
| Revue visuelle des écrans T&S | navigateur, compte de test | non faite | `FIXED_UNVERIFIED` |
| IA image/audio, notifications email/push T&S | fournisseur externe | absentes ; email de réinitialisation existant | `BLOCKED_EXTERNAL` |

La connexion reste volontairement possible pour un compte suspendu ou
banni : les triggers refusent l'écriture, la personne peut lire et
déposer un recours. Aucune session restreinte n'est inventée.

## 9. Assurance maison (2026-11-15)

| Contrôle | Commande | Résultat | Statut |
|---|---|---|---|
| Environnements | `npm run assurance` | cible distante distincte, `.env.remote` neutralisé, cliquet tenu | `VERIFIED` |
| Contrat actif | `npm run db:schema-contract` | `devnet_migtest` ok | `VERIFIED` |
| Contrat Neon | `npm run db:schema-contract:remote` | `neondb` ok | `VERIFIED` |
| TLS et rôle | `npm run db:tls-audit:remote` | `verify-full` vérifié, `SET ROLE service_role` refusé | `VERIFIED` |
| Navigateur | `npm run test:trust-safety-http` | 59/59, axe desktop/mobile | `VERIFIED` |
| Capacités | `npm run assurance` | local/in-app/absent déclarés, aucune simulation | `VERIFIED` |
| Dette UI | `npm run assurance` | 489 arbitraires, 9 fichiers, cliquet tenu | `VERIFIED` (dette non résorbée) |
