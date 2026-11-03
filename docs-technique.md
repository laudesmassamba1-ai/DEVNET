# DevNet — Documentation Technique Complète

## 1. Vue d'ensemble
DevNet est un réseau social pour développeurs africains (Next.js 16, Supabase, Tailwind v4).

## 2. Pages (routes UI)
- / : accueil
- /feed : fil
- /decouvrir : découverte
- /communities, /communities/[slug]
- /groups, /groups/[id]
- /messages
- /notifications
- /search
- /signets
- /projects, /projects/[id]
- /ide/[project]
- /extensions
- /github, /github/[owner]/[repo]
- /preview-code
- /post/[id]
- /u/[pseudo], /u/[pseudo]/followers
- /profile
- /settings
- /admin, /moderation
- /login, /register, /auth/confirmer, /mot-de-passe-oublie, /reinitialiser-mot-de-passe
- /setup, /aide, /a-propos, /cgu, /confidentialite

## 3. API Routes
- /api/admin/accounts
- /api/backend-check
- /api/github/authorize, callback, session, identity, repos, repo, tree, file, commits, branches, users/[login]/repos, import, sync

## 4. Librairies clés
- lib/backend.ts : sonde API REST, fallback démo
- lib/demo/* : backend local simulé PostgREST
- lib/supabase/client.ts, server.ts
- lib/* scoring, gamification, etc.

## 5. Formules / logique
- Scoring corpus, scoring self, bands (voir scripts/score-*.ts)
- Gamification achievements, challenges, rating

## 6. Environnement
- NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
EOF