# DevNet — carte technique

> Point d'entrée court. Les sources de vérité détaillées sont
> [`README.md`](README.md), [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) et
> [`docs/FONDATIONS.md`](docs/FONDATIONS.md).

## 1. Vue d'ensemble

DevNet est un réseau social pour développeurs africains construit avec
Next.js 16, TypeScript, Tailwind CSS v4 et PostgreSQL direct. La production
utilise Neon ; le développement local utilise PostgreSQL 18.3 via
`docker-compose.yml`. Supabase n'est plus la cible d'exécution.

## 2. Pages

- `/` : accueil
- `/feed`, `/decouvrir`, `/search`, `/signets`, `/notifications`
- `/communities`, `/communities/[slug]`, `/groups`, `/groups/[id]`
- `/messages`, `/post/[id]`, `/u/[pseudo]`, `/u/[pseudo]/followers`
- `/projects`, `/projects/[id]`, `/ide/[project]`, `/github`,
  `/github/[owner]/[repo]`, `/preview-code`, `/stickers`
- `/profile`, `/settings`, `/settings/protection`
- `/admin`, `/admin/[section]`, `/moderation`
- `/login`, `/register`, `/auth/confirmer`, `/mot-de-passe-oublie`,
  `/reinitialiser-mot-de-passe`
- `/setup`, `/aide`, `/a-propos`, `/cgu`, `/confidentialite`

## 3. API

- `/api/rest/[...path]` : passerelle PostgREST-compatible vers PostgreSQL
- `/api/auth/*` : session, inscription, connexion, OAuth, mot de passe
- `/api/stories/*`, `/api/media/*` : stories, médias et confidentialité
- `/api/github/*` : OAuth de liaison, import, synchronisation et fichiers
- `/api/admin/*` : console d'administration et données de plateforme
- `/api/protection/*`, `/api/sanctions/*`, `/api/push/*`
- `/api/ready`, `/api/health`, `/api/backend-check`

## 4. Bibliothèques clés

- `lib/backend.ts` : détection du backend et repli en démonstration
- `lib/demo/*` : backend local simulé
- `lib/rest/client.ts` : client HTTP maison compatible avec les appels PostgREST
- `platform/infrastructure/postgres/*` : pool, TLS, bascule et contrat de schéma
- `lib/scoring/*`, `lib/gamification.ts`, `lib/reputation.ts`

## 5. Logique métier

- Scoring de corpus et de projets, bandes de progression, réputation
- Gamification : achievements, défis, séries et classements
- Stories : texte, média optionnel, audience et expiration à 24 h
- Trust & Safety : moteurs de détection, signalements, sanctions et recours

## 6. Environnement

La référence complète est [`.env.example`](.env.example). Les variables
principales sont `DATABASE_URL`, `DATABASE_URL_STANDBY`, `DATABASE_CA_CERT`,
`AUTH_OAUTH_SECRET`, les identifiants OAuth Google/GitHub, les clés VAPID et,
si le stockage objet est activé, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_BUCKET` et `R2_PUBLIC_URL`.

Ne jamais placer de secret dans un document, un journal ou un commit.
